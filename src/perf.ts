/** Measures rendering FPS and incoming data rate, displayed in the app header. */
export class Perf {
    private frames = 0
    private points = 0
    private tLast = performance.now()
    private fps = 0
    private pps = 0
    /** Startup (data loading, first renders) is not representative - nothing is reported until warm-up is over. */
    private warmFrames = 0
    private warmUntil = performance.now() + 1000
    private listeners: Array<(fps: number, pps: number) => void> = []

    addPoints(count: number) {
        this.points += count
    }

    frame(now: number) {
        if (this.warmFrames < 5 || now < this.warmUntil) {
            this.warmFrames += 1
            this.frames = 0
            this.points = 0
            this.tLast = now
            return
        }
        this.frames += 1
        const dt = now - this.tLast
        if (dt >= 1000) {
            this.fps = (this.frames * 1000) / dt
            this.pps = (this.points * 1000) / dt
            this.frames = 0
            this.points = 0
            this.tLast = now
            this.listeners.forEach((l) => l(this.fps, this.pps))
        }
    }

    reset() {
        this.warmFrames = 0
        this.warmUntil = performance.now() + 1000
        this.frames = 0
        this.points = 0
        this.tLast = performance.now()
    }

    subscribe(listener: (fps: number, pps: number) => void) {
        this.listeners.push(listener)
    }
}

export const formatRate = (n: number) => {
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M`
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)} k`
    return `${Math.round(n)}`
}
