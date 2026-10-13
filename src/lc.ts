import { ColorRGBA, disableThemeEffects, emptyLine, lightningChart, SolidFill, SolidLine, Themes, type Theme } from '@lightningchart/lcjs'

/** darkGold with flat chart surfaces (chart background == HTML panel color), no glow. */
const flatTheme = <T extends Theme>(base: T): T => {
    const panelFill = new SolidFill({ color: ColorRGBA(23, 23, 23) })
    const plotFill = new SolidFill({ color: ColorRGBA(14, 14, 14) })
    const plotFrame = new SolidLine({ thickness: 1, fillStyle: new SolidFill({ color: ColorRGBA(44, 44, 44) }) })
    const theme: Record<string, unknown> = { ...disableThemeEffects(base) }
    for (const key of Object.keys(theme)) {
        const series = /SeriesBackground/.test(key)
        if (
            /^(lcjs|chartXY|zoomBandChart)Background(Fill|Stroke)Style$/.test(key) ||
            /^chartXYSeriesBackground(Fill|Stroke)Style$/.test(key)
        ) {
            const fill = key.endsWith('FillStyle')
            theme[key] = series ? (fill ? plotFill : plotFrame) : fill ? panelFill : emptyLine
        }
    }
    return theme as unknown as T
}

export const THEME = flatTheme(Themes.darkGold)

/** Optional license key from .env.local (VITE_LCJS_LICENSE). Without one LightningChart JS runs in community mode. */
export const createLC = () => lightningChart({ license: import.meta.env.VITE_LCJS_LICENSE })
