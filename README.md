# LightningChart JS · WebAssembly Memory64 demo

A desktop (Electron) showcase of `DataSetOptions.useWasmMemory64` in [LightningChart JS](https://lightningchart.com/js-charts/).

**28 GB of motorsport telemetry — a full 12-round season, 120 channels at 1 kHz, 7.4 billion data points — lives in a single shared `DataSet`, and a whole dashboard of charts renders from it with no data duplication.**

## What it demonstrates

- **`useWasmMemory64: true`** – column storage is allocated as `WebAssembly.Memory` with 64-bit addressing, so a dataset is no longer limited by the ~4 GB per-`ArrayBuffer` ceiling. The amount of data you can load is bounded by the RAM you have.
- **One dataset, many charts** – the six-lane time series, three temperature/suspension charts and the full-season zoom band all read the very same dataset.
- **Fast loading** – worker threads produce column chunks, the main thread hands them to `DataSet.appendSamples`, which copies them straight into the Memory64 store. The dataset is never held twice.
- **Interactive at any scale** – zoom from the whole season (61.6 M samples) to a single lap, in any chart, at screen refresh rate.

```ts
const dataSet = new DataSet({
    useWasmMemory64: true,
    useSharedArrayBuffers: true,
    schema: {
        x: { storage: Float64Array, pattern: 'progressive' },
        c0: { storage: Float32Array, pattern: null },
        // ... 120 channels
    },
}).setMaxSampleCount(totalSamples)

chart.addLineSeries().setDataSet(dataSet, { x: 'x', y: 'c0' })
```

## Requirements

- **RAM:** ~32 GB free for the default 28 GB dataset (use `--gb=N` to scale down; the dataset size is the only thing that changes).
- 64-bit Windows, macOS or Linux, with a recent GPU driver.
- **LightningChart JS ≥ 9.1** (the release that includes `useWasmMemory64`).
- Node.js 20+.

## Run

```bash
npm install
npm start                 # full 28 GB
npm start -- --gb=6       # smaller dataset, quick look
```

Optional: copy `.env.example` to `.env.local` and set `VITE_LCJS_LICENSE` to your LightningChart JS license key.

## Build a portable app

```bash
npm run package           # -> release/Season-Telemetry-Archive-win32-x64
```

Copy the folder to another machine and run `Season-Telemetry-Archive.exe` (add `--gb=N` to change the dataset size).

## How it is put together

| File | Purpose |
| --- | --- |
| `electron/main.cjs` | Electron main process. Serves the build over a privileged `app://` scheme with COOP/COEP headers (cross-origin isolation, required for shared memory). |
| `src/main.ts` | Dashboard: layout, charts, session browser, load progress. |
| `src/loader.ts` | Worker pool + `appendSamples` pipeline. Swap the producer for a Parquet / file reader to load real data. |
| `src/gen.worker.ts`, `src/telemetry.ts` | Deterministic, stateless generator of plausible telemetry (lap profiles, pit stops, tyre/brake thermals, 120 channels). Any chunk of the season can be generated independently. |

The data is **synthetic**. The loader is deliberately the only place that knows where samples come from, so replacing it with a Parquet reader that decodes row groups into column buffers needs no changes on the chart side.

## Notes

- Memory64 behavior and performance can vary by browser / Chromium version. The Electron version pinned here supports it out of the box.

## License

This demo's source is provided as an example. LightningChart JS itself is commercial software and requires a [license](https://lightningchart.com/js-charts/).
