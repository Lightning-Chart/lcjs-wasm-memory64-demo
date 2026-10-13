import { CHANNEL_COUNT, SIGNAL_COUNT, fillChunk } from './telemetry'

export interface GenJob {
    id: number
    /** Shared slot: [x: Float64 * count][channels: Float32 * count each] */
    slot: SharedArrayBuffer
    start: number
    count: number
    roundLengthMs: number
}

let scratch: Float32Array | undefined

self.onmessage = (e: MessageEvent<GenJob>) => {
    const { id, slot, start, count, roundLengthMs } = e.data
    const x = new Float64Array(slot, 0, count)
    const cols: Float32Array[] = []
    for (let c = 0; c < CHANNEL_COUNT; c += 1) cols.push(new Float32Array(slot, count * 8 + c * count * 4, count))
    if (!scratch || scratch.length < SIGNAL_COUNT * count) scratch = new Float32Array(SIGNAL_COUNT * count)
    fillChunk(start, count, roundLengthMs, x, cols, scratch)
    ;(self as unknown as Worker).postMessage({ id })
}
