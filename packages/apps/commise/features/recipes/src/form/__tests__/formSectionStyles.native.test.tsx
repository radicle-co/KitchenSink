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
 * The row width the narrowest supported phone leaves, in dp.
 *
 * 375 (the viewport `recipeHomeResponsive.spec.ts` already treats as the floor) minus the scroll content's
 * 16pt each side and the card's 16pt each side — the two paddings the row actually sits inside.
 */
const NARROWEST_ROW_WIDTH_DP = 375 - 2 * 16 - 2 * 16;

/** Rough width of the en-dash separator at its 13pt size. Over-estimated on purpose. */
const SEPARATOR_DP = 16;

describe('ingredient row geometry', () => {
    it('gives the name its OWN line', () => {
        // At 60% the name shared line 1 with the low bound and the dash, which both crushed the name AND
        // split the range across two lines. A full basis puts the name above and the whole quantity group
        // below, which is the only wrap position that reads correctly.
        expect(styles.rowGrow.flexBasis).toBe('100%');
    });

    it('lets the row wrap, which is what the full basis turns the overflow into', () => {
        expect(styles.listRow.flexWrap).toBe('wrap');
    });

    it('⛔ keeps the whole quantity group on ONE line at the narrowest supported width', () => {
        // The group is `[low][–][high][unit]`. If it cannot fit even at the boxes' minimum, the unit wraps
        // onto a third line and a range reads as two unrelated numbers. This is the arithmetic that makes
        // `flexShrink` on `rowNarrow` load-bearing rather than decorative.
        const compressed = 3 * styles.rowNarrow.minWidth + 3 * styles.listRow.gap + SEPARATOR_DP;

        expect(compressed).toBeLessThanOrEqual(NARROWEST_ROW_WIDTH_DP);
    });

    it('⛔ lets the quantity boxes compress at all — React Native does not shrink by default', () => {
        // `flexShrink` defaults to 0 in React Native (unlike the web), so `width: 88` is otherwise rigid.
        // At their full width the group needs 3×88 + 3×8 + ~16 = ~304dp against the 311 available here —
        // seven points of margin, which is inside the error bar on the separator glyph's real width and
        // gone entirely on a 360dp device. The shrink is what makes the fit robust rather than lucky.
        expect(styles.rowNarrow.flexShrink).toBeGreaterThan(0);
        expect(styles.rowNarrow.minWidth).toBeLessThan(styles.rowNarrow.width);
    });
});
