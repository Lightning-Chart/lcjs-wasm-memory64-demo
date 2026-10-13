import './styles.css'
import {
    AxisTickStrategies,
    ColorHEX,
    DataSet,
    emptyTick,
    SolidFill,
    SolidLine,
    synchronizeAxisIntervals,
    type Axis,
    type ChartXY,
    type Color,
} from '@lightningchart/lcjs'
import { contextBar, el, panel } from './dom'
import { ICONS } from './icons'
import { createLC, THEME } from './lc'
import { loadSeason } from './loader'
import { Perf, formatRate } from './perf'
import { BYTES_PER_SAMPLE, CH, CHANNELS, CHANNEL_COUNT, ROUND_COUNT, ROUND_NAMES, channelKey, getRound, roundLengthForGiB } from './telemetry'

const params = new URLSearchParams(location.search)
const TARGET_GIB = Number(params.get('gb') ?? 28)
const ROUND_LENGTH = roundLengthForGiB(TARGET_GIB)
const TOTAL = ROUND_LENGTH * ROUND_COUNT
const DATASET_GB = (TOTAL * BYTES_PER_SAMPLE) / 1024 ** 3

const line = (color: Color, thickness = 1) => new SolidLine({ thickness, fillStyle: new SolidFill({ color }) })
const fill = (color: Color) => new SolidFill({ color })
const fmtBig = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n.toLocaleString('en-US'))
const fmtDuration = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(0)} ms`
    if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`
    const total = Math.round(ms / 1000)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const sec = total % 60
    if (h > 0) return `${h} h ${m} min`
    if (m > 0) return `${m} min ${sec} s`
    return `${sec} s`
}
const fmtLap = (ms: number) => {
    const m = Math.floor(ms / 60000)
    return `${m}:${((ms - m * 60000) / 1000).toFixed(3).padStart(6, '0')}`
}

const C = {
    speed: ColorHEX('#3fd4ff'),
    rpm: ColorHEX('#ffc53d'),
    throttle: ColorHEX('#3ddc84'),
    brake: ColorHEX('#ff4d4f'),
    steer: ColorHEX('#e8e2d0'),
    lat: ColorHEX('#b388ff'),
}
const CORNER_COLORS = [ColorHEX('#3fd4ff'), ColorHEX('#b388ff'), ColorHEX('#3ddc84'), ColorHEX('#ff9f1c')]

// ------------------------------------------------------------------ Shell
const app = document.getElementById('app')!
const header = el('header', { className: 'app-header' }, app)
el('span', {
    className: 'app-title',
    html: `<span class="ico">${ICONS.motorsports}</span><b>Season Telemetry Archive</b><i>2026 · 12 rounds · every lap, every channel, 1 kHz</i>`,
}, header)
el('div', { className: 'header-spacer' }, header)
const perfEl = el('div', { className: 'perf' }, header)
const loadCell = el('div', { className: 'pps', html: '<b>–</b><span>loading</span>' }, perfEl)
const loadSub = loadCell.querySelector('span')!
const lagEl = el('div', { className: 'lag-status' }, perfEl)
const lagTitle = el('span', { className: 'lag-title', text: 'Measuring…' }, lagEl)
const lagSub = el('span', { className: 'lag-sub', text: 'screen updates / s' }, lagEl)
const progress = el('div', { className: 'load-progress' }, header)
const progressBar = el('div', {}, progress)

const host = el('main', { className: 'dashboard-host' }, app)
const banner = el('footer', { className: 'tech-bar' }, app)
el('span', { className: 'tb-badge', text: 'LightningChart JS' }, banner)
el('span', { className: 'tb-title', text: `${DATASET_GB.toFixed(0)} GB of telemetry in one shared dataset, held in WebAssembly Memory64` }, banner)
el('span', { className: 'header-spacer' }, banner)
const hint = el('div', { className: 'tb-hint' }, banner)
el('span', { className: 'tb-hand', html: ICONS.pointer }, hint)
el('span', { className: 'tb-hint-text', html: '<b>Try it:</b> scroll to zoom · drag to pan · drag the zoom band · click a round or lap' }, hint)

const perf = new Perf()
perf.subscribe((fps) => {
    const level = fps >= 45 ? 'ok' : fps >= 25 ? 'warn' : 'bad'
    lagEl.dataset.level = level
    lagTitle.textContent = level === 'ok' ? 'Smooth' : level === 'warn' ? 'Slight lag' : 'LAGGING'
    lagSub.textContent = `${fps.toFixed(0)} screen updates / s`
})
const rafLoop = (now: number) => {
    perf.frame(now)
    requestAnimationFrame(rafLoop)
}
requestAnimationFrame(rafLoop)

// ------------------------------------------------------------------ Dashboard
const root = el('div', { className: 'dashboard' }, host)
Object.assign(root.style, {
    gridTemplateColumns: '1fr 1fr 1fr 0.62fr',
    gridTemplateRows: '38px 1.7fr 0.8fr 136px',
    gridTemplateAreas: `
        "ctx ctx ctx ctx"
        "ts ts ts browser"
        "tyre susp brake browser"
        "zoom zoom zoom zoom"`,
})

const ctxBar = contextBar(
    root,
    'ctx',
    'Prototype #4',
    [
        ['Season', '2026 · 12 rounds'],
        ['Archive', `${DATASET_GB.toFixed(1)} GB`],
        ['Samples', fmtBig(TOTAL)],
        ['Channels', String(CHANNEL_COUNT)],
        ['Data points', fmtBig(TOTAL * CHANNEL_COUNT)],
        ['View', '–'],
    ],
    [{ text: 'LOADING', kind: 'warn' }],
)
const pTs = panel(root, { title: 'Driver, Powertrain & Dynamics', sub: 'Speed · RPM · Throttle · Brake · Steering · Lateral G', area: 'ts' })
const pTyre = panel(root, { title: 'Tyre Surface Temperature', sub: '°C', area: 'tyre' })
const pSusp = panel(root, { title: 'Damper Travel', sub: 'mm', area: 'susp' })
const pBrake = panel(root, { title: 'Brake Disc Temperature', sub: '°C', area: 'brake' })
const pBrowser = panel(root, { title: 'Session Browser', sub: 'rounds · laps', area: 'browser' })
const pZoom = panel(root, {
    title: 'Full Season Overview',
    sub: `${fmtBig(TOTAL)} samples, drag the band to navigate`,
    area: 'zoom',
    badges: [{ text: 'MEMORY64', kind: 'live' }],
})

// ------------------------------------------------------------------ Shared dataset (one copy of the data for ALL charts)
const dataSet = new DataSet({
    // Column storage allocated as WebAssembly.Memory with 64-bit addressing: breaks the 4 GB-per-ArrayBuffer ceiling
        useWasmMemory64: true,
    // Shared memory: chart worker threads read the data directly, enabling async / multi-threaded rendering
    useSharedArrayBuffers: true,
    schema: {
        x: { storage: Float64Array, pattern: 'progressive' },
        ...Object.fromEntries(CHANNELS.map((_, i) => [channelKey(i), { storage: Float32Array, pattern: null }])),
    },
}).setMaxSampleCount(TOTAL)

const lc = createLC()

const baseXY = (container: HTMLDivElement) =>
    lc
        .ChartXY({ container, theme: THEME, legend: { visible: false }, animationsEnabled: false })
        .setTitle('')
        .setPadding({ top: 6, right: 12, bottom: 4, left: 4 })
        .setCursorMode('show-all')

const setupTimeAxis = (chart: ChartXY) =>
    chart.axisX.setTickStrategy(AxisTickStrategies.Time).setScrollStrategy(undefined).setInterval({ start: 0, end: TOTAL, stopAxisAfter: false })

// Stacked time series lanes
const tsChart = baseXY(pTs.host)
const tsAxisX = setupTimeAxis(tsChart)
tsChart.axisY.dispose()
const lanes: Array<{ ch: number; title: string; color: Color; start: number; end: number }> = [
    { ch: CH.SPEED, title: 'km/h', color: C.speed, start: 0, end: 320 },
    { ch: CH.RPM, title: 'rpm', color: C.rpm, start: 4000, end: 13000 },
    { ch: CH.THROTTLE, title: 'Thr %', color: C.throttle, start: 0, end: 100 },
    { ch: CH.BRAKE, title: 'Brk bar', color: C.brake, start: 0, end: 130 },
    { ch: CH.STEER, title: 'Steer °', color: C.steer, start: -250, end: 250 },
    { ch: CH.LAT_G, title: 'Lat G', color: C.lat, start: -6, end: 6 },
]
const laneAxes: Axis[] = lanes.map((l, i) =>
    tsChart
        .addAxisY({ iStack: lanes.length - 1 - i })
        .setMargins(i < lanes.length - 1 ? 6 : 0, i > 0 ? 6 : 0)
        .setTitle(l.title)
        .setTitleFillStyle(fill(l.color))
        .setInterval({ start: l.start, end: l.end })
        .setScrollStrategy(undefined)
        .setTickStrategy(AxisTickStrategies.Numeric, (t) => t.setMinorTickStyle(emptyTick)),
)
const laneSeries = lanes.map((l, i) =>
    tsChart
        .addLineSeries({ axisY: laneAxes[i] })
        .setName(CHANNELS[l.ch].name)
        .setDataSet(dataSet, { x: 'x', y: channelKey(l.ch) })
        .setStrokeStyle(line(l.color, 1.5)),
)

// 4-channel overlay charts (FL / FR / RL / RR), all reading the very same dataset
const quadChart = (container: HTMLDivElement, firstCh: number, start: number, end: number) => {
    const chart = baseXY(container)
    chart.axisY.setInterval({ start, end }).setScrollStrategy(undefined).setTickStrategy(AxisTickStrategies.Numeric, (t) => t.setMinorTickStyle(emptyTick))
    const axisX = setupTimeAxis(chart)
    ;['FL', 'FR', 'RL', 'RR'].forEach((n, i) =>
        chart
            .addLineSeries()
            .setName(n)
            .setDataSet(dataSet, { x: 'x', y: channelKey(firstCh + i) })
            .setStrokeStyle(line(CORNER_COLORS[i], 1.25)),
    )
    chart.legend.setOptions({ visible: true })
    return { chart, axisX }
}
const tyre = quadChart(pTyre.host, CH.TYRE_TEMP, 60, 135)
const susp = quadChart(pSusp.host, CH.DAMPER, 0, 90)
const brake = quadChart(pBrake.host, CH.BRAKE_DISC, 200, 950)

synchronizeAxisIntervals(tsAxisX, tyre.axisX, susp.axisX, brake.axisX)

// Full-season overview: a zoom band over the speed series, controls the (synchronized) X axes
const zoomBand = lc.ZoomBandChart({ container: pZoom.host, theme: THEME, useSharedValueAxis: true }).setTitle('')
zoomBand.add(laneSeries[0])

// ------------------------------------------------------------------ View readout
const updateView = () => {
    const { start, end } = tsAxisX.getInterval()
    const visible = Math.max(0, Math.min(end, TOTAL) - Math.max(start, 0))
    ctxBar.set('View', `${fmtDuration(end - start)} · ${fmtBig(visible * CHANNEL_COUNT)} pts`)
}
tsAxisX.addEventListener('intervalchange', updateView)
updateView()

// ------------------------------------------------------------------ Session browser
const browserBody = el('div', { className: 'browser' }, pBrowser.host)
const roundList = el('div', { className: 'browser-rounds' }, browserBody)
const lapHead = el('div', { className: 'browser-head', text: 'Laps' }, browserBody)
const lapList = el('div', { className: 'browser-laps' }, browserBody)

const zoomTo = (start: number, end: number) => tsAxisX.setInterval({ start, end, stopAxisAfter: false, animate: 700 })

const bestLapMs = (r: number) => {
    const model = getRound(r, ROUND_LENGTH)
    const complete = model.laps.filter((l) => !l.pit && l.lap > 1 && l.startMs + l.durMs <= model.lengthMs)
    return Math.min(...(complete.length ? complete : model.laps).map((l) => l.durMs))
}

const selectRound = (r: number, zoom = true) => {
    const model = getRound(r, ROUND_LENGTH)
    ;Array.from(roundList.children).forEach((c, i) => c.classList.toggle('active', i === r))
    lapHead.textContent = `${model.name} · ${model.laps.length} laps`
    const best = bestLapMs(r)
    lapList.replaceChildren(
        ...model.laps.map((l) => {
            const row = el('div', { className: `lap-row${l.durMs === best ? ' best' : ''}` })
            el('span', { text: `L${l.lap}` }, row)
            el('span', { className: 'lap-time', text: fmtLap(l.durMs) }, row)
            el('span', { className: 'lap-tag', text: l.pit ? 'PIT' : l.durMs === best ? 'BEST' : '' }, row)
            row.addEventListener('click', () => {
                const base = r * ROUND_LENGTH + l.startMs
                zoomTo(base, base + l.durMs)
            })
            return row
        }),
    )
    if (zoom) zoomTo(r * ROUND_LENGTH, (r + 1) * ROUND_LENGTH)
}
ROUND_NAMES.forEach((name, r) => {
    const row = el('div', { className: 'round-row' }, roundList)
    el('span', { className: 'round-no', text: `R${r + 1}` }, row)
    el('span', { className: 'round-name', text: name }, row)
    el('span', { className: 'lap-time', text: fmtLap(bestLapMs(r)) }, row)
    row.addEventListener('click', () => selectRound(r))
})
selectRound(5, false)

// ------------------------------------------------------------------ Load the data
const t0 = performance.now()
loadSeason(dataSet, TOTAL, ROUND_LENGTH, (p) => {
    progressBar.style.width = `${((p.samples / p.totalSamples) * 100).toFixed(1)}%`
    const gb = p.bytes / 1024 ** 3
    const sec = p.elapsedMs / 1000
    loadCell.firstElementChild!.textContent = `${gb.toFixed(1)} / ${DATASET_GB.toFixed(1)} GB`
    loadSub.textContent = `${(gb / sec).toFixed(2)} GB/s · ${formatRate((p.samples * CHANNEL_COUNT) / sec)} pts/s`
})
    .then(() => {
        const sec = (performance.now() - t0) / 1000
        progress.style.opacity = '0'
        loadCell.firstElementChild!.textContent = `${DATASET_GB.toFixed(1)} GB`
        loadSub.textContent = `loaded in ${sec.toFixed(0)} s`
        ctxBar.setStatus([{ text: 'READY', kind: 'live' }])
    })
    .catch((e) => {
        console.error(e)
        ctxBar.setStatus([{ text: `ERROR: ${e instanceof Error ? e.message : e}`, kind: 'alarm' }])
    })
