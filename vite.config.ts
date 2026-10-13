import { defineConfig } from 'vite'

export default defineConfig({
    base: './',
    worker: { format: 'es' },
    build: { target: 'esnext', outDir: 'dist', chunkSizeWarningLimit: 10000 },
})
