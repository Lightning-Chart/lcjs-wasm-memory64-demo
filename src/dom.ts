export const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: { className?: string; text?: string; html?: string; style?: Partial<CSSStyleDeclaration> } = {},
    parent?: HTMLElement,
): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag)
    if (props.className) e.className = props.className
    if (props.text !== undefined) e.textContent = props.text
    if (props.html !== undefined) e.innerHTML = props.html
    if (props.style) Object.assign(e.style, props.style)
    parent?.appendChild(e)
    return e
}

export interface Badge {
    text: string
    kind?: 'live' | 'warn' | 'alarm'
}

/** Status badge. A leading warning glyph in the text is dropped - alarm badges are marked by styling instead. */
const badgeEl = (b: Badge) => el('span', { className: `badge ${b.kind ?? ''}`, text: b.text.replace(/^⚠\s*/, '') })

export interface Panel {
    root: HTMLDivElement
    body: HTMLDivElement
    /** Absolutely positioned container filling the panel body - pass this to LCJS charts. */
    host: HTMLDivElement
    badges: HTMLDivElement
    sub: HTMLSpanElement
    setBadges(badges: Badge[]): void
}

/** Dashboard panel with a header (title, subtitle, status badges) and a body that hosts a chart. */
export const panel = (
    parent: HTMLElement,
    opts: { title: string; sub?: string; area: string; badges?: Badge[]; noHead?: boolean },
): Panel => {
    const root = el('div', { className: 'panel', style: { gridArea: opts.area } }, parent)
    const head = el('div', { className: 'panel-head' }, root)
    if (opts.noHead) head.style.display = 'none'
    el('span', { className: 'panel-title', text: opts.title }, head)
    const sub = el('span', { className: 'panel-sub', text: opts.sub ?? '' }, head)
    el('span', { className: 'spacer' }, head)
    const badges = el('div', { className: 'panel-badges' }, head)
    const body = el('div', { className: 'panel-body' }, root)
    const host = el('div', { className: 'chart-host' }, body)
    function setBadges(list: Badge[]) {
        badges.replaceChildren(...list.map(badgeEl))
    }
    const fit = fitHide(head, () => (badges.querySelector('.chip') ? [sub] : [sub, badges]))
    setBadges(opts.badges ?? [])
    return { root, body, host, badges, sub, setBadges: (list) => { setBadges(list); fit() } }
}

export const contextBar = (parent: HTMLElement, area: string, title: string, items: Array<[string, string]>, status: Badge[] = []) => {
    const bar = el('div', { className: 'context-bar', style: { gridArea: area } }, parent)
    el('span', { className: 'ctx-title', text: title }, bar)
    const values = new Map<string, HTMLElement>()
    const itemEls: HTMLElement[] = []
    for (const [label, value] of items) {
        const item = el('span', { className: 'ctx-item', text: label }, bar)
        itemEls.push(item)
        values.set(label, el('b', { text: value }, item))
    }
    // On narrow windows the least important (last) items drop out instead of being clipped
    const fit = fitHide(bar, () => itemEls.slice().reverse())
    const statusEl = el('span', { className: 'ctx-status' }, bar)
    const setStatus = (list: Badge[]) => statusEl.replaceChildren(...list.map(badgeEl))
    setStatus(status)
    return {
        bar,
        set: (label: string, value: string) => {
            const v = values.get(label)
            if (v && v.textContent !== value) {
                v.textContent = value
                fit()
            }
        },
        setStatus: (list: Badge[]) => {
            setStatus(list)
            fit()
        },
    }
}

/** Sets textContent only when changed (avoids needless DOM work in per-frame updates). */
export const setText = (e: HTMLElement, text: string) => {
    if (e.textContent !== text) e.textContent = text
}

export interface TableCell {
    text: string
    color?: string
}

/** Plain HTML data table (header + body rows), updated in place. Cells may be plain strings or `{ text, color }`. */
export const dataTable = (host: HTMLElement, columns: string[], opts: { align?: Array<'left' | 'right'> } = {}) => {
    const wrap = el('div', { className: 'data-table-wrap' }, host)
    const table = el('table', { className: 'data-table' }, wrap)
    const headRow = el('tr', {}, el('thead', {}, table))
    columns.forEach((c, i) => el('th', { text: c, style: { textAlign: opts.align?.[i] ?? 'left' } }, headRow))
    const tbody = el('tbody', {}, table)
    return {
        table,
        setRows(rows: Array<{ cells: Array<string | TableCell>; color?: string }>) {
            while (tbody.rows.length > rows.length) tbody.deleteRow(-1)
            while (tbody.rows.length < rows.length) {
                const tr = tbody.insertRow()
                columns.forEach((_, i) => {
                    const td = tr.insertCell()
                    td.style.textAlign = opts.align?.[i] ?? 'left'
                })
            }
            rows.forEach((row, r) => {
                const tr = tbody.rows[r]
                tr.style.display = ''
                tr.style.color = row.color ?? ''
                row.cells.forEach((cell, c) => {
                    const td = tr.cells[c]
                    const { text, color } = typeof cell === 'string' ? { text: cell, color: undefined } : cell
                    if (td.textContent !== text) td.textContent = text
                    td.style.color = color ?? ''
                })
            })
            // Hide rows that would be cut off at the bottom (no scrollbars)
            const rowH = tbody.rows[0]?.offsetHeight ?? 0
            if (rowH > 0) {
                const room = Math.floor((wrap.clientHeight - (table.tHead?.offsetHeight ?? 0)) / rowH)
                for (let r = room; r < tbody.rows.length; r += 1) tbody.rows[r].style.display = 'none'
            }
        },
    }
}

/**
 * Keeps `container` free of overflow by hiding the least important children first (given in hiding order).
 * Returns a function that re-evaluates the layout, call it after content changes.
 */
export const fitHide = (container: HTMLElement, candidates: () => HTMLElement[]) => {
    const run = () => {
        const list = candidates()
        list.forEach((e) => (e.style.display = ''))
        for (const e of list) {
            if (container.scrollWidth <= container.clientWidth + 1) break
            e.style.display = 'none'
        }
    }
    const observer = new ResizeObserver(run)
    observer.observe(container)
    // Late web-font swaps change content width without resizing the container
    document.fonts?.ready.then(run)
    return run
}
