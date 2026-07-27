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
