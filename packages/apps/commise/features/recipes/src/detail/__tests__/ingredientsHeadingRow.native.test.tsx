/**
 * The serving stepper's room, now that it sits beside the Ingredients heading (build spec §6.1) instead of in the stat
 * strip. REPLACES `statStripServings.native.test.tsx`, whose subject — the stepper's reserved width in a four-up strip
 * — no longer exists. The defect class it was written for stands: the stepper's intrinsic width is set by two 44 pt
 * targets and a value box (`SERVING_STEPPER_MIN_WIDTH`), and a row that cannot give it that width slices a button at
 * the screen edge. So the heading row WRAPS, and the stepper never shrinks below its own width.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { idleUnreachableRetry, makeRecipeDetail } from '../../__fixtures__/index.js';
import { CookMarksTestProvider } from '../../__fixtures__/cookMarks.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDetailView } from '../RecipeDetailView.native.js';

afterEach(cleanup);

/** The value react-native-web applied for a property, read from its atomic rules. */
function appliedStyle(element: Element, property: string): string | undefined {
    for (const className of element.className.split(' ').filter((name) => name.startsWith('r-'))) {
        for (const sheet of Array.from(document.styleSheets)) {
            for (const rule of Array.from(sheet.cssRules)) {
                if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                    const value = rule.style.getPropertyValue(property);

                    if (value !== '') {
                        return value;
                    }
                }
            }
        }
    }

    return undefined;
}

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
        expect(appliedStyle(row, 'flex-wrap')).toBe('wrap');
    });
});
