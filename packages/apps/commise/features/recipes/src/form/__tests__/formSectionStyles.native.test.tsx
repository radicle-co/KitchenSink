/**
 * The ingredient row's geometry must leave the NAME field readable (U9/R42 regression).
 *
 * ## The defect this was written for
 *
 * U9 (`77fa3819`) gave each ingredient line a second quantity bound, so `listRow` went from
 * `[name][quantity][unit]` to `[name][low][–][high][unit]`. The three fixed boxes are `rowNarrow` (88 each),
 * and `rowGrow` — the name — carried `flexShrink: 1` with NO floor. On a 393dp-wide phone the card's content
 * box is ~340dp, the fixed children claim ~306 of it, and the name collapses into what is left:
 *
 *     3 × 88 (rowNarrow) + ~10 (separator) + 4 × 8 (gap)  =  ~306dp
 *     340 − 306                                            =  ~34dp for the name
 *
 * Measured on the CI emulator on 2026-08-22: the edit wizard rendered its five ingredient names as
 * "oil", "lic", "no" and "on" — the tails of "Olive oil", "Garlic", "Oregano" and "Lemon". Four Maestro
 * flows failed on that screen. Before U9 the row held two fixed boxes, the name got ~150dp, and it read fine,
 * which is why nothing caught it: the arithmetic only tips once the third box exists.
 *
 * ## What the fix is, and why it is a floor rather than a smaller box
 *
 * `listRow` already sets `flexWrap: 'wrap'`, so the row is ALLOWED to become two lines — it simply never did,
 * because a shrinkable child with no minimum always yields instead of forcing a wrap. Giving the name a
 * `minWidth` is what converts "crush the name" into "wrap the row", which is the behaviour the wrap was there
 * for. Narrowing `rowNarrow` instead would buy ~30dp and reintroduce the same bug on the next narrow device
 * or the next field.
 *
 * ⚠️ These two properties are load-bearing TOGETHER. A floor without `flexWrap` overflows the card instead of
 * wrapping; `flexWrap` without a floor is today's bug. Each assertion below fails on its own.
 */
import { describe, expect, it } from 'vitest';

import { styles } from '../formSectionStyles.native.js';

/**
 * The narrowest phone this app supports, in dp — a 390×844 device (the viewport
 * `recipeHomeResponsive.spec.ts` already uses as the touch-target floor), minus the screen and card padding
 * the row sits inside.
 */
const NARROWEST_ROW_WIDTH_DP = 340;

/** What a name field must be able to show. "Flat-leaf parsley" is the longest seeded ingredient name. */
const NAME_FLOOR_DP = 120;

describe('ingredient row geometry', () => {
    it('gives the name field a floor it cannot shrink below', () => {
        // Without this the name is whatever the fixed boxes leave over — ~34dp, which renders as "oil".
        expect(styles.rowGrow.minWidth).toBeGreaterThanOrEqual(NAME_FLOOR_DP);
    });

    it('lets the row wrap, which is what the floor turns the overflow into', () => {
        expect(styles.listRow.flexWrap).toBe('wrap');
    });

    it('⛔ the fixed boxes plus the name floor EXCEED one line, so the wrap is reached, not decorative', () => {
        // This is the arithmetic that makes the pair meaningful rather than two unrelated constants: on the
        // narrowest supported row the five children cannot co-exist on one line, so `flexWrap` must engage.
        // If a future change made them fit, the wrap would be dead code and this test says so.
        const fixed = 3 * styles.rowNarrow.width + 4 * styles.listRow.gap;

        expect(fixed + NAME_FLOOR_DP).toBeGreaterThan(NARROWEST_ROW_WIDTH_DP);
    });
});
