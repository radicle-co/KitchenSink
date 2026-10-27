/**
 * Contrast arithmetic for the token tests, on `culori` (library-first: WCAG 2.x relative luminance is not hand-rolled).
 * `@commise/test-utils/contrast` wraps the same library but depends on `@commise/ui`, so importing it here would close
 * a workspace cycle.
 */
import { converter, formatHex, wcagContrast } from 'culori';

const toRgb = converter('rgb');

/** A colour, or an `rgba()` with alpha, composited over an opaque surface, as the opaque hex a reader sees. Pure. */
export function over(colour: string, surface: string): string {
    const top = toRgb(colour);
    const bottom = toRgb(surface);

    if (top === undefined || bottom === undefined) {
        throw new Error(`Cannot composite ${colour} over ${surface}.`);
    }

    const alpha = top.alpha ?? 1;

    return formatHex({
        mode: 'rgb',
        r: top.r * alpha + bottom.r * (1 - alpha),
        g: top.g * alpha + bottom.g * (1 - alpha),
        b: top.b * alpha + bottom.b * (1 - alpha),
    });
}

/** The WCAG 2.x contrast ratio of a foreground on an opaque background. Pure. */
export function ratio(foreground: string, background: string): number {
    return wcagContrast(foreground, background);
}
