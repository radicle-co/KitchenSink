/**
 * The stats strip must RESERVE the room its serving stepper needs.
 *
 * ## The defect this was written for
 *
 * `statStrip` is a four-up row — Serves, Prep, Cook, Total — of `statCell`s at `flex: 1`. On a 375dp phone
 * that is ~85dp each. U9 replaced the Serves cell's plain number with `ServingScaleControl`, whose intrinsic
 * width is fixed by an accessibility floor:
 *
 *     44 (minus, RC-3 touch floor) + 4 (gap) + 40 (value) + 4 (gap) + 44 (plus)  =  136dp
 *
 * 136 in 85 overflows by ~51dp, and the control centres itself, so ~25dp hangs off EACH side. Seen on the
 * CI emulator on 2026-08-22: the `−` button was sliced in half by the screen edge, and the `+` sat under the
 * Prep column.
 *
 * ⚠️ Maestro did NOT catch this and could not have: `serving-scale.yaml` taps the buttons by accessible name
 * and they are present, hittable and correct — the defect is purely that you cannot see one of them. It was
 * found by reading the failure screenshot of a DIFFERENT flow.
 *
 * ## Why the width is declared by the control and consumed by the parent
 *
 * The number that matters is a property of the stepper (two 44pt targets and a value box), not of the strip.
 * Publishing it from the control and reserving it in the parent means raising the touch target — or adding a
 * third button — moves the reservation with it. A literal `136` in the strip would be a second copy that
 * silently stops being true.
 */
import { describe, expect, it } from 'vitest';

import { STAT_CELL_SERVINGS_MIN_WIDTH, STAT_STRIP_WRAPS } from '../RecipeDetailBody.native.js';
import { SERVING_STEPPER_MIN_WIDTH } from '../ServingScaleControl.native.js';

/** What a 375dp phone leaves the strip after the detail body's 16pt each side and the strip's own borders. */
const STRIP_INNER_WIDTH_DP = 375 - 2 * 16 - 2;

describe('stats strip — the serving cell', () => {
    it('reserves at least the stepper’s intrinsic width', () => {
        expect(STAT_CELL_SERVINGS_MIN_WIDTH).toBeGreaterThanOrEqual(SERVING_STEPPER_MIN_WIDTH);
    });

    it('⛔ that width is MORE than an equal quarter share, which is why reserving it is necessary', () => {
        // If this ever stops being true the reservation is inert and the test above proves nothing.
        expect(SERVING_STEPPER_MIN_WIDTH).toBeGreaterThan(STRIP_INNER_WIDTH_DP / 4);
    });

    it('leaves the other three cells a usable share', () => {
        // "30 min" at body-lg is ~55dp. If the reservation squeezed the rest below that, this fix would
        // have moved the clipping rather than removed it.
        expect((STRIP_INNER_WIDTH_DP - STAT_CELL_SERVINGS_MIN_WIDTH) / 3).toBeGreaterThanOrEqual(55);
    });

    it('lets the strip wrap rather than clip if it ever cannot fit', () => {
        // The belt to the reservation's braces: on a narrower device, or after a copy change, wrapping to a
        // second line is legible and a sliced-in-half button is not.
        expect(STAT_STRIP_WRAPS).toBe('wrap');
    });
});
