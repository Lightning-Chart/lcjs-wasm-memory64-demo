/**
 * Synthetic-but-physically-plausible race car telemetry. Entirely deterministic and stateless per sample index,
 * so any number of workers can generate any chunk of the season independently.
 *
 * Season layout: ROUND_COUNT rounds of continuous on-track logging, each a sequence of laps with pit stops.
 */

export const CHANNEL_COUNT = 120
export const SAMPLE_RATE_HZ = 1000
export const ROUND_COUNT = 12
export const BYTES_PER_SAMPLE = 8 + CHANNEL_COUNT * 4

export const ROUND_NAMES = [
    'Sakhir',
    'Jeddah',
    'Melbourne',
    'Suzuka',
    'Imola',
    'Monaco',
    'Barcelona',
    'Spielberg',
    'Silverstone',
    'Spa',
    'Monza',
    'Interlagos',
]

/** Samples per round for a given RAM target; the dataset holds ROUND_COUNT * this. */
export const roundLengthForGiB = (gib: number) => Math.floor((gib * 1024 ** 3) / BYTES_PER_SAMPLE / ROUND_COUNT)

// ------------------------------------------------------------------ Signals
// Base signals evaluated per sample; every channel is a cheap affine mix of two of them (plus noise).
export const SIG = {
    SPEED: 0,
    THR: 1,
    BRK: 2,
    STR: 3,
    RPM: 4,
    GEAR: 5,
    LAT: 6,
    LON: 7,
    LOADL: 8,
    LOADR: 9,
    BRKTHERM: 10,
    TYREHEAT: 11,
    SPEED2: 12,
    DEG: 13,
    ROUNDFRAC: 14,
    SLOW: 15,
} as const
export const SIGNAL_COUNT = 16
/** Number of signals stored in the per-lap profile tables (SPEED..TYREHEAT). */
const TABLE_SIGNALS = 12

export interface ChannelDef {
    name: string
    unit: string
    group: string
    min: number
    max: number
    off: number
    a: number
    ga: number
    b: number
    gb: number
    noise: number
}

const defs: ChannelDef[] = []
const ch = (
    name: string,
    unit: string,
    group: string,
    min: number,
    max: number,
    off: number,
    a: number,
    ga: number,
    b = 0,
    gb = 0,
    noise = 0,
) => defs.push({ name, unit, group, min, max, off, a, ga, b, gb, noise })

const S = SIG
// 0-7 driver / vehicle dynamics
ch('Speed', 'km/h', 'Dynamics', 0, 320, 0, S.SPEED, 1, 0, 0, 0.15)
ch('Engine RPM', 'rpm', 'Powertrain', 0, 13000, 0, S.RPM, 1, 0, 0, 18)
ch('Throttle', '%', 'Driver', 0, 100, 0, S.THR, 100, 0, 0, 0.2)
ch('Brake pressure', 'bar', 'Driver', 0, 130, 0, S.BRK, 120, 0, 0, 0.3)
ch('Steering angle', '°', 'Driver', -200, 200, 0, S.STR, 1, 0, 0, 0.3)
ch('Gear', '', 'Powertrain', 0, 9, 0, S.GEAR, 1)
ch('Lateral accel', 'g', 'Dynamics', -5, 5, 0, S.LAT, 1, 0, 0, 0.02)
ch('Longitudinal accel', 'g', 'Dynamics', -6, 4, 0, S.LON, 1, 0, 0, 0.02)
// 8-11 tyre surface temperature (mid), 12-15 brake disc temperature
const corners = ['FL', 'FR', 'RL', 'RR']
corners.forEach((c, i) => {
    const load = i % 2 === 0 ? S.LOADL : S.LOADR
    ch(`Tyre temp ${c}`, '°C', 'Tyres', 60, 135, 78, S.TYREHEAT, 42 + i * 2, load, 1.2, 0.12)
})
corners.forEach((c, i) => ch(`Brake disc ${c}`, '°C', 'Brakes', 200, 950, 260, S.BRKTHERM, i < 2 ? 640 : 430, 0, 0, 1.5))
// 16-19 damper travel, 20-23 wheel speed
corners.forEach((c, i) => {
    const load = i % 2 === 0 ? S.LOADL : S.LOADR
    ch(`Damper ${c}`, 'mm', 'Suspension', 0, 90, 38, load, 9, S.LON, i < 2 ? -3.5 : 3.5, 1.1)
})
corners.forEach((c) => ch(`Wheel speed ${c}`, 'km/h', 'Dynamics', 0, 320, 0, S.SPEED, 1.002, S.BRK, -4, 0.3))
// 24-35 powertrain + fluids
ch('Oil temp', '°C', 'Powertrain', 80, 150, 104, S.SLOW, 2.5, S.RPM, 0.0012, 0.08)
ch('Water temp', '°C', 'Powertrain', 70, 120, 90, S.SLOW, 1.5, S.THR, 3, 0.06)
ch('Oil pressure', 'bar', 'Powertrain', 0, 8, 1.8, S.RPM, 0.00045, 0, 0, 0.01)
ch('Fuel pressure', 'bar', 'Powertrain', 0, 8, 5.1, S.THR, 0.4, 0, 0, 0.01)
ch('Boost pressure', 'bar', 'Powertrain', 0, 3, 0.3, S.THR, 1.6, 0, 0, 0.01)
ch('Lambda', '', 'Powertrain', 0.7, 1.2, 1.0, S.THR, -0.12, 0, 0, 0.004)
ch('Fuel level', 'kg', 'Powertrain', 0, 110, 100, S.ROUNDFRAC, -85, 0, 0, 0.01)
ch('Battery', 'V', 'Powertrain', 10, 15, 13.1, S.THR, -0.4, 0, 0, 0.01)
ch('Engine torque', 'Nm', 'Powertrain', 0, 600, 0, S.THR, 520, 0, 0, 2)
ch('Exhaust temp', '°C', 'Powertrain', 500, 1000, 580, S.THR, 330, S.SLOW, 8, 1.5)
ch('ERS deploy', 'kW', 'Powertrain', 0, 120, 0, S.THR, 110, S.BRK, -50, 0.4)
ch('Diff temp', '°C', 'Powertrain', 60, 140, 82, S.SLOW, 5, S.LOADL, 3, 0.05)
// 36-43 tyre inner / outer, 44-47 tyre pressure
corners.forEach((c, i) => ch(`Tyre temp ${c} inner`, '°C', 'Tyres', 60, 135, 80, S.TYREHEAT, 46, S.DEG, 5, 0.14))
corners.forEach((c, i) => ch(`Tyre temp ${c} outer`, '°C', 'Tyres', 60, 135, 74, S.TYREHEAT, 38, S.DEG, 2, 0.14))
corners.forEach((c) => ch(`Tyre pressure ${c}`, 'psi', 'Tyres', 18, 30, 21.5, S.TYREHEAT, 2.2, S.SLOW, 0.2, 0.01))
// 48-59 ride height, brake duct, wheel load
corners.forEach((c) => ch(`Ride height ${c}`, 'mm', 'Aero', 10, 60, 32, S.SPEED2, -9, S.LON, 1.5, 0.3))
corners.forEach((c) => ch(`Brake duct temp ${c}`, '°C', 'Brakes', 40, 300, 70, S.BRKTHERM, 150, 0, 0, 0.6))
corners.forEach((c, i) => ch(`Wheel load ${c}`, 'N', 'Suspension', 0, 9000, 2800, S.SPEED2, 900, i % 2 === 0 ? S.LOADL : S.LOADR, 1400, 18))
// 60-83 aero pressure taps, 84-107 strain gauges, 108-119 chassis accelerometers
for (let i = 0; i < 24; i += 1) ch(`Aero pressure P${String(i + 1).padStart(2, '0')}`, 'kPa', 'Aero', -4, 4, ((i % 6) - 3) * 0.2, S.SPEED2, 0.35 * (i % 2 ? -1 : 1) * (1 + (i % 5) * 0.12), 0, 0, 0.012)
for (let i = 0; i < 24; i += 1) ch(`Strain gauge S${String(i + 1).padStart(2, '0')}`, 'µε', 'Chassis', -900, 900, (i - 12) * 6, i % 2 ? S.LOADL : S.LOADR, 120 + i * 4, S.LON, 40, 3)
for (let i = 0; i < 12; i += 1) ch(`Chassis accel A${String(i + 1).padStart(2, '0')}`, 'g', 'Chassis', -8, 8, 0, i % 2 ? S.LAT : S.LON, 0.9, S.SPEED2, 0.04, 0.35)

export const CHANNELS: readonly ChannelDef[] = defs
if (CHANNELS.length !== CHANNEL_COUNT) throw new Error(`Expected ${CHANNEL_COUNT} channels, got ${CHANNELS.length}`)

export const channelKey = (i: number) => `c${i}`
export const CH = {
    SPEED: 0,
    RPM: 1,
    THROTTLE: 2,
    BRAKE: 3,
    STEER: 4,
    GEAR: 5,
    LAT_G: 6,
    LON_G: 7,
    TYRE_TEMP: 8,
    BRAKE_DISC: 12,
    DAMPER: 16,
} as const

// ------------------------------------------------------------------ Per-round structure
const mulberry32 = (seed: number) => {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const PROFILE_RES = 16384

export interface Lap {
    /** Start offset from round start, ms. */
    startMs: number
    durMs: number
    /** Lap number, 1-based. */
    lap: number
    /** Tyre degradation 0..1 within the stint. */
    deg: number
    pit: boolean
}

export interface RoundModel {
    index: number
    name: string
    lengthMs: number
    laps: Lap[]
    /** PROFILE_RES * TABLE_SIGNALS interleaved profile of one nominal lap. */
    profile: Float32Array
    nominalLapMs: number
}

const buildProfile = (rand: () => number, lapSeconds: number): Float32Array => {
    const cornerCount = 9 + Math.floor(rand() * 4)
    const vmax = 285 + rand() * 40
    const cs: Array<{ c: number; v: number; w: number; dir: number }> = []
    for (let k = 0; k < cornerCount; k += 1) {
        cs.push({ c: (k + 0.3 + rand() * 0.4) / cornerCount, v: 55 + rand() * rand() * 170, w: 0.012 + rand() * 0.02, dir: rand() < 0.5 ? -1 : 1 })
    }
    const M = PROFILE_RES
    const speed = new Float64Array(M)
    const curvature = new Float64Array(M)
    for (let j = 0; j < M; j += 1) {
        const p = j / M
        let v = vmax
        let curv = 0
        for (const k of cs) {
            let d = p - k.c
            if (d > 0.5) d -= 1
            if (d < -0.5) d += 1
            const w = d < 0 ? k.w * 2.2 : k.w * 3.2
            const vk = vmax - (vmax - k.v) * Math.exp(-((d / w) ** 2))
            if (vk < v) v = vk
            const kc = (2.6 * 9.81 * (0.75 + 0.25 * ((k.c * 7) % 1))) / (k.v / 3.6) ** 2
            curv += k.dir * kc * Math.exp(-((d / (k.w * 1.5)) ** 2))
        }
        speed[j] = v
        curvature[j] = curv
    }
    // light smoothing of speed
    const sm = new Float64Array(M)
    for (let j = 0; j < M; j += 1) {
        let s = 0
        for (let o = -6; o <= 6; o += 1) s += speed[(j + o + M) % M]
        sm[j] = s / 13
    }
    const dt = lapSeconds / M
    const out = new Float32Array(M * TABLE_SIGNALS)
    let brkTherm = 0
    let tyreHeat = 0
    const lowpass = (prev: number, x: number, tau: number) => prev + (x - prev) * (1 - Math.exp(-dt / tau))
    // two passes: first to warm up the thermal states so the lap is cyclic
    for (let pass = 0; pass < 2; pass += 1) {
        for (let j = 0; j < M; j += 1) {
            const v = sm[j]
            const vNext = sm[(j + 1) % M]
            const lon = ((vNext - v) / 3.6 / dt) / 9.81
            const brk = lon < -0.12 ? Math.min(1, -lon / 4.2) : 0
            const thr = brk > 0 ? 0 : Math.min(1, Math.max(0, 0.32 + lon * 1.6 + 0.75 * (v / vmax) ** 10))
            const lat = (v / 3.6) ** 2 * curvature[j] / 9.81
            const steer = Math.max(-250, Math.min(250, curvature[j] * 2600))
            const gear = Math.max(1, Math.min(8, 1 + Math.floor(v / 38)))
            const rpm = 5200 + 7000 * Math.min(1, Math.max(0, (v - (gear - 1) * 38) / 38))
            brkTherm = lowpass(brkTherm, brk, 2.4)
            tyreHeat = lowpass(tyreHeat, Math.min(1.4, Math.abs(lat) / 3), 9)
            if (pass === 1) {
                const o = j * TABLE_SIGNALS
                out[o + SIG.SPEED] = v
                out[o + SIG.THR] = thr
                out[o + SIG.BRK] = brk
                out[o + SIG.STR] = steer
                out[o + SIG.RPM] = rpm
                out[o + SIG.GEAR] = gear
                out[o + SIG.LAT] = lat
                out[o + SIG.LON] = lon
                out[o + SIG.LOADL] = Math.max(0, lat)
                out[o + SIG.LOADR] = Math.max(0, -lat)
                out[o + SIG.BRKTHERM] = brkTherm
                out[o + SIG.TYREHEAT] = tyreHeat
            }
        }
    }
    return out
}

const roundCache = new Map<string, RoundModel>()

export const getRound = (index: number, lengthMs: number): RoundModel => {
    const key = `${index}:${lengthMs}`
    const cached = roundCache.get(key)
    if (cached) return cached
    const rand = mulberry32(1000 + index * 7919)
    const nominalLapMs = Math.round((78 + rand() * 30) * 1000)
    const profile = buildProfile(rand, nominalLapMs / 1000)
    const estLaps = Math.max(3, Math.floor(lengthMs / (nominalLapMs * 1.03)))
    const pitLaps = [Math.floor(estLaps / 3), Math.floor((2 * estLaps) / 3)]
    const laps: Lap[] = []
    let t = 0
    let lapNo = 1
    let stintStart = 1
    while (t < lengthMs) {
        const stintLen = Math.max(3, Math.floor(estLaps / 3))
        const deg = Math.min(1, (lapNo - stintStart) / stintLen)
        const pit = pitLaps.includes(lapNo)
        let pace = 1 + 0.035 * deg + 0.007 * (rand() - 0.5) * 2
        if (lapNo === 1) pace += 0.09
        if (pit) pace += 0.24
        if (laps.length > 0 && laps[laps.length - 1].pit) pace += 0.06
        const durMs = Math.round(nominalLapMs * pace)
        laps.push({ startMs: t, durMs, lap: lapNo, deg, pit })
        t += durMs
        if (pit) stintStart = lapNo + 1
        lapNo += 1
    }
    const model: RoundModel = { index, name: ROUND_NAMES[index], lengthMs, laps, profile, nominalLapMs }
    roundCache.set(key, model)
    return model
}

// ------------------------------------------------------------------ Chunk generation
const chOff = new Float32Array(CHANNEL_COUNT)
const chA = new Uint8Array(CHANNEL_COUNT)
const chGa = new Float32Array(CHANNEL_COUNT)
const chB = new Uint8Array(CHANNEL_COUNT)
const chGb = new Float32Array(CHANNEL_COUNT)
const chNoise = new Float32Array(CHANNEL_COUNT)
CHANNELS.forEach((d, i) => {
    chOff[i] = d.off
    chA[i] = d.a
    chGa[i] = d.ga
    chB[i] = d.b
    chGb[i] = d.gb
    chNoise[i] = d.noise
})

/**
 * Fills `x` (timestamps in ms from season start) and one Float32Array per channel for samples [start, start + count).
 * `scratch` must hold SIGNAL_COUNT * count floats.
 */
export const fillChunk = (
    start: number,
    count: number,
    roundLengthMs: number,
    x: Float64Array,
    cols: Float32Array[],
    scratch: Float32Array,
) => {
    const sig = (s: number) => scratch.subarray(s * count, (s + 1) * count)
    const sigArrays: Float32Array[] = []
    for (let s = 0; s < SIGNAL_COUNT; s += 1) sigArrays.push(sig(s))

    let k = 0
    while (k < count) {
        const i = start + k
        const r = Math.min(ROUND_COUNT - 1, Math.floor(i / roundLengthMs))
        const round = getRound(r, roundLengthMs)
        const local = i - r * roundLengthMs
        // find lap
        let lo = 0
        let hi = round.laps.length - 1
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1
            if (round.laps[mid].startMs <= local) lo = mid
            else hi = mid - 1
        }
        const lap = round.laps[lo]
        const lapEnd = Math.min(lap.startMs + lap.durMs, roundLengthMs)
        const segLen = Math.min(count - k, r * roundLengthMs + lapEnd - i)
        const prof = round.profile
        const speedScale = round.nominalLapMs / lap.durMs
        for (let n = 0; n < segLen; n += 1) {
            const phase = (local + n - lap.startMs) / lap.durMs
            const pf = phase * PROFILE_RES
            const j0 = Math.min(PROFILE_RES - 1, Math.floor(pf))
            const j1 = (j0 + 1) % PROFILE_RES
            const fr = pf - j0
            const o0 = j0 * TABLE_SIGNALS
            const o1 = j1 * TABLE_SIGNALS
            const idx = k + n
            for (let s = 0; s < TABLE_SIGNALS; s += 1) {
                sigArrays[s][idx] = prof[o0 + s] + (prof[o1 + s] - prof[o0 + s]) * fr
            }
            const v = sigArrays[SIG.SPEED][idx] * speedScale
            sigArrays[SIG.SPEED][idx] = v
            sigArrays[SIG.SPEED2][idx] = (v * v) / 1e5
            sigArrays[SIG.DEG][idx] = lap.deg
            sigArrays[SIG.ROUNDFRAC][idx] = (local + n) / roundLengthMs
            sigArrays[SIG.SLOW][idx] = Math.sin(((i + n) / 1000) * 0.045 + r)
            x[idx] = i + n
        }
        k += segLen
    }

    let seed = (start * 2654435761) >>> 0 || 1
    for (let c = 0; c < CHANNEL_COUNT; c += 1) {
        const out = cols[c]
        const A = sigArrays[chA[c]]
        const B = sigArrays[chB[c]]
        const off = chOff[c]
        const ga = chGa[c]
        const gb = chGb[c]
        const noise = chNoise[c]
        if (noise === 0) {
            for (let n = 0; n < count; n += 1) out[n] = off + ga * A[n] + gb * B[n]
        } else {
            let s = (seed + c * 40503) >>> 0 || 1
            for (let n = 0; n < count; n += 1) {
                s ^= s << 13
                s ^= s >>> 17
                s ^= s << 5
                out[n] = off + ga * A[n] + gb * B[n] + noise * (((s >>> 0) * 2.3283064365386963e-10) * 2 - 1)
            }
        }
    }
}
