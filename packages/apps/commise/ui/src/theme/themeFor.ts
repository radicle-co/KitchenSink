/**
 * @module @commise/ui/theme — a colour scheme's theme: the role colours, cover tints, canvas wash and status tones one
 * scheme paints (`docs/design/uiOverhaul/darkTheme.md` §7). Native components read colour ONLY from here, at render,
 * and keep their `StyleSheet`s to layout: a colour in a static sheet is baked into one theme at import.
 *
 * @pattern Registry — one frozen theme per scheme, keyed by the scheme name
 */
import { pressFillsOf, type SurfaceTone } from '../surfaceTone/surfaceTone.js';
import { role, roleDark, type Role } from '../tokens/colors.js';
import { coverTint, coverTintDark, type CoverTintName } from '../tokens/covers.js';
import { gradient, heroDark, type GradientSpec } from '../tokens/gradients.js';
import {
    proTone,
    proToneDark,
    statusTone,
    statusToneDark,
    type RecipeStatus,
    type StatusTone,
    type Tone,
} from '../tokens/tones.js';

/** A colour scheme. */
export type ColorSchemeName = 'light' | 'dark';

/** What one scheme paints. */
export interface Theme {
    readonly scheme: ColorSchemeName;
    /** Every colour role's value in this scheme. */
    readonly colors: Readonly<Record<Role, string>>;
    /** The cover tints. */
    readonly covers: Readonly<Record<CoverTintName, string>>;
    /** The canvas wash. */
    readonly hero: GradientSpec;
    /** The status badge tones. */
    readonly status: Readonly<Record<RecipeStatus, StatusTone>>;
    /** The PRO badge's fill and label. */
    readonly pro: Tone;
    /**
     * Each surface's press fill: the surface with the theme's ink laid over it (`surfaceTone.ts`, `componentFixes.md`
     * §10a). A control reads the one for the surface it sits on (`usePressFill`), never one of these by hand.
     */
    readonly press: Readonly<Record<SurfaceTone, string>>;
    /**
     * The pressed fill over paper and sheets: `surfaceMuted` (`componentFixes` issue 3, 2026-10-26), the native twin of
     * the web `bg-surface-muted` press. It replaced the `ink` 6% wash. Over a `surfaceMuted` fill (a chip) it would not
     * show, so a chip presses to `lineDivider` instead (`chipStyle.ts`).
     */
    readonly wash: string;
}

const THEMES: Readonly<Record<ColorSchemeName, Theme>> = {
    light: {
        scheme: 'light',
        colors: role,
        covers: coverTint,
        hero: gradient.hero,
        status: statusTone,
        pro: proTone,
        press: pressFillsOf(role, 'light'),
        wash: role.surfaceMuted,
    },
    dark: {
        scheme: 'dark',
        colors: roleDark,
        covers: coverTintDark,
        hero: heroDark,
        status: statusToneDark,
        pro: proToneDark,
        press: pressFillsOf(roleDark, 'dark'),
        wash: roleDark.surfaceMuted,
    },
};

/**
 * The theme for a scheme: one stable object per scheme. Pure.
 *
 * @param scheme - The scheme.
 * @returns Its theme.
 */
export function themeFor(scheme: ColorSchemeName): Theme {
    return THEMES[scheme];
}
