/**
 * @module @commise/ui/tokens/barMaterial — the level-2 bar material on web: the surface of the floating navigation
 * layer (the tab bar and the condensed title bar), per ownerDecisions D12 and `docs/design/uiOverhaul/darkTheme.md`
 * §3.4. A translucent fill under a small blur, measured so each bar stays readable with the blur off (the contrast pairs
 * are computed in `darkTheme.md` against pure black and pure white beneath). iOS 26 draws real glass instead
 * (`@commise/ui/chrome-surface`), and Android a solid `paperRaised`.
 */
import { role, roleDark, tint } from './colors.js';

/** The bar's fill in each theme. */
export const barMaterial = {
    light: tint(role.paper, 0.92),
    dark: tint(roleDark.paperRaised, 0.94),
} as const;
