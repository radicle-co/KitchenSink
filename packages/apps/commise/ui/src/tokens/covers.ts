/**
 * @module tokens/covers — the six typographic cover tints (`docs/design/uiOverhaul/darkTheme.md` §4, "Typographic
 * recipe covers"), in both themes.
 *
 * A cover names its tint ({@link CoverTintName}); the theme picks the value. Web reads `bg-cover-{name}`, whose
 * custom property the dark block overrides (`themeCss.ts`); native reads `useTheme().covers[name]`. The values are
 * the designer's: light from the build spec, dark the hue at 22% over dark `paper`, each under `ink` lettering.
 *
 * @pattern Registry — a closed set of tint names over two value tables
 */

/** The tint names, in the order the cover hash indexes them. */
export const COVER_TINT_NAMES = ['seafoam', 'coral', 'sky', 'premium', 'success', 'warning'] as const;

/** A cover tint's name. */
export type CoverTintName = (typeof COVER_TINT_NAMES)[number];

/** The light cover tints. */
export const coverTint: Readonly<Record<CoverTintName, string>> = {
    seafoam: '#E6F0EF',
    coral: '#FAE9E4',
    sky: '#DFF0F8',
    premium: '#F6EBE0',
    success: '#E2F2EA',
    warning: '#FDEFD9',
};

/** The dark cover tints. */
export const coverTintDark: Readonly<Record<CoverTintName, string>> = {
    seafoam: '#22312E',
    coral: '#4A352E',
    sky: '#374245',
    premium: '#46392C',
    success: '#283C2E',
    warning: '#4D3C21',
};
