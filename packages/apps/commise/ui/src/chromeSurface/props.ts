/**
 * @module @commise/ui/chrome-surface — the shared contract of the design-system `ChromeSurface`: the material behind a
 * bar of the floating navigation layer — the tab bar, the condensed title bar, later the editor's action bar
 * (ownerDecisions D12, D14; `docs/design/uiOverhaul/modernizeA.md` §5, `darkTheme.md` §3.4).
 *
 * It is a BACKDROP, not a container: it fills its parent behind the bar's own content, so the bar keeps its own layout
 * and semantics and the platform decision lives here once.
 *
 * - **iOS 26:** real Liquid Glass (`expo-glass-effect` `GlassView`, regular, `colorScheme="auto"`). The system handles
 *   Reduce Transparency and Increase Contrast for it.
 * - **Android and older iOS:** a solid `paperRaised` surface with a `lineDivider` hairline. No blur: `expo-blur` does
 *   not blur on Android, and frosting on old iOS is the dated look the overhaul removes.
 * - **Web:** the bar material (`paper` 92% / `paperRaised` 94%) under a 12 px blur, readable with the blur off, and
 *   solid under `prefers-reduced-transparency` or `prefers-contrast: more`.
 *
 * Content is never glass: a card, a row, a form, a dialog or the snackbar does not use this.
 */

/** The cross-platform `ChromeSurface` contract. */
export interface ChromeSurfaceProps {
    /** The edge the bar meets content on, which carries the hairline: `top` for a bottom bar, `bottom` for a top bar. */
    readonly edge: 'top' | 'bottom';
    /**
     * Whether the material shows. A condensed title bar fills in only once content scrolls under it. On iOS the glass
     * animates through its own `glassEffectStyle` — never an `opacity`, which stops `GlassView` from rendering at all.
     * Defaults to true.
     */
    readonly visible?: boolean;
}
