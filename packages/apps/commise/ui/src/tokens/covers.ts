/**
 * @module tokens/covers — the six typographic cover tints (`docs/design/uiOverhaul/darkTheme.md` §4, "Typographic
 * recipe covers"), in both themes.
 *
 * A cover names its tint ({@link CoverTintName}); the theme picks the value. Web reads `bg-cover-{name}`, whose
 * custom property the dark block overrides (`themeCss.ts`); native reads `useTheme().covers[name]`. The values are
 * the designer's (the redesign's): pale washes in light, dusk versions in dark, each under `ink` lettering. They never
 * mean anything: a cover's colour is decoration.
 *
 * @pattern Registry — a closed set of tint names over two value tables
 */

/** The tint names, in the order the cover hash indexes them. */
export const COVER_TINT_NAMES = ['steel', 'cream', 'sky', 'peach', 'success', 'warning'] as const;

/** A cover tint's name. */
export type CoverTintName = (typeof COVER_TINT_NAMES)[number];

/** The pale cream wash, light. `warning` is this same wash, so both read this one constant. */
const CREAM = '#F7E9D7';
/** The pale cream wash, dark. */
const CREAM_DARK = '#342817';

/** The light cover tints. */
export const coverTint: Readonly<Record<CoverTintName, string>> = {
    steel: '#E1EDFA',
    cream: CREAM,
    sky: '#DDEEFC',
    peach: '#F5E9DF',
    success: '#E4EDF2',
    warning: CREAM,
};

/** The dark cover tints. */
export const coverTintDark: Readonly<Record<CoverTintName, string>> = {
    steel: '#202B37',
    cream: CREAM_DARK,
    sky: '#1C2C38',
    peach: '#32281F',
    success: '#232B30',
    warning: CREAM_DARK,
};
