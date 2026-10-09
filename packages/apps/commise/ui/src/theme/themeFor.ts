/**
 * @module @commise/ui/theme — a colour scheme's theme: the role colours, cover tints, canvas wash and status tones one
 * scheme paints (`docs/design/uiOverhaul/darkTheme.md` §7). Native components read colour ONLY from here, at render,
 * and keep their `StyleSheet`s to layout: a colour in a static sheet is baked into one theme at import.
 *
 * @pattern Registry — one frozen theme per scheme, keyed by the scheme name
 */
import { role, roleDark, tint, type Role } from '../tokens/colors.js';
import { coverTint, coverTintDark, type CoverTintName } from '../tokens/covers.js';
import { gradient, heroDark, type GradientSpec } from '../tokens/gradients.js';
import { statusTone, statusToneDark, type RecipeStatus, type StatusTone } from '../tokens/tones.js';

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
    /** The press (and fine-pointer hover) wash: `ink` at 6% (`darkTheme.md` §1), the native twin of `bg-ink/6`. */
    readonly wash: string;
}

const THEMES: Readonly<Record<ColorSchemeName, Theme>> = {
    light: {
        scheme: 'light',
        colors: role,
        covers: coverTint,
        hero: gradient.hero,
        status: statusTone,
        wash: tint(role.ink, 0.06),
    },
    dark: {
        scheme: 'dark',
        colors: roleDark,
        covers: coverTintDark,
        hero: heroDark,
        status: statusToneDark,
        wash: tint(roleDark.ink, 0.06),
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
