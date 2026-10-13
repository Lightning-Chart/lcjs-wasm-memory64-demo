const { app, BrowserWindow, protocol, net } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

// Serve the built renderer from a privileged scheme so that COOP/COEP headers can be applied.
// Cross-origin isolation is required for SharedArrayBuffer (and shared WebAssembly.Memory).
protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

// Memory64 is on by default in current Chromium, flag kept for older Electron versions.
app.commandLine.appendSwitch('js-flags', '--experimental-wasm-memory64')
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')

const distDir = path.join(__dirname, '..', 'dist')

app.whenReady().then(() => {
    protocol.handle('app', async (request) => {
        const url = new URL(request.url)
        const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
        const res = await net.fetch(pathToFileURL(path.join(distDir, rel)).toString())
        const headers = new Headers(res.headers)
        headers.set('Cross-Origin-Opener-Policy', 'same-origin')
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
        headers.set('Cross-Origin-Resource-Policy', 'same-origin')
        return new Response(res.body, { status: res.status, headers })
    })
    const win = new BrowserWindow({
        width: 2560,
        height: 1440,
        backgroundColor: '#0d0d0d',
        autoHideMenuBar: true,
        webPreferences: { backgroundThrottling: false },
    })
    const query = process.argv.find((a) => a.startsWith('--gb='))
    win.loadURL('app://local/index.html' + (query ? `?gb=${query.slice(5)}` : ''))
})

app.on('window-all-closed', () => app.quit())
