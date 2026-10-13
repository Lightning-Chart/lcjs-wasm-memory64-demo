/** Small line icons (16px grid, drawn with `currentColor`). */
const svg = (body: string) => `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`

export const ICONS = {
    medical: svg('<path d="M1 8.5h3l1.6-5 3 9.5 1.8-4.5H15"/>'),
    motorsports: svg('<path d="M2.2 12.5a6.2 6.2 0 1 1 11.6 0"/><path d="M8 12.5 10.8 7"/><circle cx="8" cy="12.5" r="0.6"/>'),
    aerospace: svg('<path d="M8 1.5c.6 0 1 .6 1 1.4V6l5 3.2v1.4L9 9v3.3l1.5 1.1v1.1L8 14l-2.5.5v-1.1L7 12.3V9l-5 1.6V9.2L7 6V2.9c0-.8.4-1.4 1-1.4z"/>'),
    automation: svg('<path d="M2 4h12M2 8h12M2 12h12"/><circle cx="5" cy="4" r="1.6"/><circle cx="11" cy="8" r="1.6"/><circle cx="7" cy="12" r="1.6"/>'),
    lightning: svg('<path d="M9.2 1.5 3.5 9H8l-1 5.5L12.5 7H8z"/>'),
    package: svg('<path d="M8 1.5l6 3v7l-6 3-6-3v-7z"/><path d="M2 4.5l6 3 6-3M8 7.5v7"/>'),
    pointer: svg('<path d="M3 2l9.5 4.4-4.2 1.4L6.4 12z"/>'),
}
