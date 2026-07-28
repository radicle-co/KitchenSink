/**
 * @module test-utils/cssColor — normalize a design token colour to the form `getComputedStyle` reports.
 *
 * The palette stores opaque colours as hex (`#E8917A`) while jsdom's computed style always reports the
 * functional form (`rgb(232, 145, 122)`), so a token-vs-computed comparison fails on notation alone — which
 * would tempt a test author to hardcode the rgb triple and thereby stop asserting the TOKEN at all. Converting
 * here keeps the assertion pointed at the token, so re-theming the palette still moves the tests with it.
 *
 * Colours already in functional form (`rgba(255, 255, 255, 0.3)`) pass through unchanged: jsdom preserves that
 * spacing exactly, so they compare directly.
 *
 * It lives under `src/__tests__/` (not the package's `test-utils/`, which holds the vitest module ALIASES) for
 * two reasons: `tsconfig`'s `rootDir` is `src`, so a helper imported by a spec must sit under it; and
 * `tsconfig.build.json` already excludes every `__tests__` directory under `src`, so test-only code stays out
 * of the built package.
 */

/** Matches an opaque 6-digit hex colour. */
const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/**
 * Convert a design-token colour to the notation `getComputedStyle` returns. Pure.
 *
 * @param token - A palette colour, either `#RRGGBB` or an already-functional `rgb()`/`rgba()` string.
 * @returns The computed-style notation for that colour.
 */
export function cssColor(token: string): string {
    const match = HEX_COLOR.exec(token);

    if (match === null) {
        return token;
    }

    const [red, green, blue] = [match[1], match[2], match[3]].map((part) => Number.parseInt(part!, 16));

    return `rgb(${red}, ${green}, ${blue})`;
}

/**
 * Convert a design-token colour to the ALPHA-TINTED notation `getComputedStyle` returns.
 *
 * React Native has no alpha-suffix colour syntax (the web's `bg-error/10`), so native leaves spell a tint out
 * as an `rgba(...)` literal — which is precisely how a tint ends up on the wrong hue without anyone noticing.
 * Deriving the expected value from the token here means such a literal cannot pass by coincidence, and a
 * re-theme of the palette moves the test with it. Pure.
 *
 * @param token - An opaque `#RRGGBB` palette colour.
 * @param alpha - The tint's alpha, 0..1.
 * @returns The computed-style notation for that colour at that alpha.
 * @throws Error when the token is not an opaque hex colour (a tint of a tint is not a meaningful assertion).
 */
export function tintOf(token: string, alpha: number): string {
    const match = HEX_COLOR.exec(token);

    if (match === null) {
        throw new Error(`tintOf expects an opaque #RRGGBB token, received "${token}".`);
    }

    const [red, green, blue] = [match[1], match[2], match[3]].map((part) => Number.parseInt(part!, 16));

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
