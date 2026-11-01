/**
 * The serving stepper's room, now that it sits beside the Ingredients heading (build spec §6.1) instead of in the stat
 * strip. REPLACES `statStripServings.native.test.tsx`, whose subject — the stepper's reserved width in a four-up strip
 * — no longer exists. The defect class it was written for stands: the stepper's intrinsic width is set by two 44 pt
 * targets and a value box (`SERVING_STEPPER_MIN_WIDTH`), and a row that cannot give it that width slices a button at
 * the screen edge. So the heading row WRAPS, and the stepper never shrinks below its own width.
 *
 * The wrap is read through `resolvedStyle`, not from react-native-web's `r-*` atomic rules: the row is the design
 * system's Tamagui heading-row frame (ADR-0080), whose classes are Tamagui's, so the old reader would find nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
// The detail leaves draw through the design system's Tamagui components (ADR-0080), so the tree renders in its provider.
import { render, resolvedStyle } from '@commise/ui/testing/tamagui';

import { idleUnreachableRetry, makeRecipeDetail } from '../../__fixtures__/index.js';
import { CookMarksTestProvider } from '../../__fixtures__/cookMarks.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDetailView } from '../RecipeDetailView.native.js';

afterEach(cleanup);

describe('the Ingredients heading row (native)', () => {
    it('holds the heading and the serving stepper, and wraps rather than clipping the stepper', () => {
        render(
            <CookMarksTestProvider>
                <RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={makeRecipeDetail({ servings: 8 })} />
            </CookMarksTestProvider>,
        );

        const heading = screen.getByRole('heading', { name: 'Ingredients' });
        const row = heading.parentElement as Element;

        expect(row.contains(screen.getByRole('button', { name: 'More servings' }))).toBe(true);
        expect(resolvedStyle(row, 'flexWrap')).toBe('wrap');
    });
});
