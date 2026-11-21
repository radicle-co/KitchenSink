/**
 * @module @commise/ui/dialog-actions — the native row decision of `DialogActions`, in text units (staff D1, D4).
 *
 * The threshold is in text units: `sideBySideFrom` is the box width, in dp at text scale 1, from which two actions
 * fit side by side. At a larger text size the labels are wider, so the same threshold takes more room. The box's own
 * width does not depend on the row direction, so the decision cannot flip itself (no stack, unwrap, row loop).
 *
 * @pattern Specification — one pure predicate the native leaf feeds with its measurement.
 */
import { cappedFontScale } from '../text/fontScaleCap.js';
import type { DialogActionsSideBySideFrom } from './props.js';

/**
 * Whether the actions sit side by side. Pure.
 *
 * The scale is capped at 2 (ADR-0080 §8, the cap the labels draw at) and floored at 1: at iOS Small (0.882) a
 * 400 threshold would fall to 353 and put a 358 dp phone in a row, against "phones stack at every text size" (designer
 * D8). Stacking where a row would fit is the safe direction.
 *
 * @param width - The box's own measured width in dp, or `null` before its first layout.
 * @param sideBySideFrom - The threshold at text scale 1.
 * @param fontScale - The system text scale the labels draw at.
 * @returns `true` when the box is at least `sideBySideFrom` times the clamped scale wide; `false` unmeasured.
 */
export function isSideBySide(
    width: number | null,
    sideBySideFrom: DialogActionsSideBySideFrom,
    fontScale: number,
): boolean {
    return width !== null && width >= sideBySideFrom * Math.max(1, cappedFontScale(fontScale));
}
