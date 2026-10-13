import type { DataSet } from '@lightningchart/lcjs'
import { BYTES_PER_SAMPLE, CHANNEL_COUNT, channelKey } from './telemetry'
import type { GenJob } from './gen.worker'

export interface LoadProgress {
    samples: number
    totalSamples: number
    bytes: number
    elapsedMs: number
}

const CHUNK = 200_000

/**
 * Streams the season into the dataset. A pool of workers produces column-major chunks into SharedArrayBuffer slots,
 * the main thread hands each slot's typed-array views straight to `DataSet.appendSamples` (one copy, into the
 * WebAssembly.Memory64 backing store) and recycles the slot. Peak extra RAM = slots, not the dataset.
 *
 * In a real deployment this producer is the parquet reader (row-group -> column buffers); the dataset side is identical.
 */
export const loadSeason = async (
    dataSet: DataSet,
    totalSamples: number,
    roundLengthMs: number,
    onProgress: (p: LoadProgress) => void,
) => {
    const workerCount = Math.max(2, Math.min(10, (navigator.hardwareConcurrency || 8) - 2))
    const workers = Array.from({ length: workerCount }, () => new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' }))
    const slotCount = workerCount + 3
    const slotBytes = CHUNK * BYTES_PER_SAMPLE
    const freeSlots: SharedArrayBuffer[] = Array.from({ length: slotCount }, () => new SharedArrayBuffer(slotBytes))
    const chunkCount = Math.ceil(totalSamples / CHUNK)
    const t0 = performance.now()

    const results = new Map<number, { slot: SharedArrayBuffer; count: number }>()
    const idleWorkers = [...workers]
    let nextToDispatch = 0
    let nextToAppend = 0
    let wake: (() => void) | undefined

    const dispatch = () => {
        while (nextToDispatch < chunkCount && freeSlots.length > 0 && idleWorkers.length > 0) {
            const id = nextToDispatch++
            const slot = freeSlots.pop()!
            const worker = idleWorkers.pop()!
            const start = id * CHUNK
            const count = Math.min(CHUNK, totalSamples - start)
            const job: GenJob = { id, slot, start, count, roundLengthMs }
            worker.onmessage = () => {
                idleWorkers.push(worker)
                results.set(id, { slot, count })
                dispatch()
                wake?.()
            }
            worker.postMessage(job)
        }
    }

    dispatch()
    while (nextToAppend < chunkCount) {
        const r = results.get(nextToAppend)
        if (!r) {
            await new Promise<void>((resolve) => (wake = resolve))
            continue
        }
        results.delete(nextToAppend)
        const { slot, count } = r
        const packet: Record<string, Float64Array | Float32Array> = { x: new Float64Array(slot, 0, count) }
        for (let c = 0; c < CHANNEL_COUNT; c += 1) packet[channelKey(c)] = new Float32Array(slot, count * 8 + c * count * 4, count)
        dataSet.appendSamples(packet)
        freeSlots.push(slot)
        nextToAppend += 1
        dispatch()
        const samples = Math.min(totalSamples, nextToAppend * CHUNK)
        onProgress({ samples, totalSamples, bytes: samples * BYTES_PER_SAMPLE, elapsedMs: performance.now() - t0 })
        // let the browser render the charts while loading
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    workers.forEach((w) => w.terminate())
}
