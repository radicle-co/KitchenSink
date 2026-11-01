/**
 * Native component tests for the recipe-list LOAD ERROR (react-native-web under jsdom). Mirrors
 * `RecipeListLoadError.test.tsx`; moved from the retired `RecipeList.native.test.tsx` ("error state", and the error
 * half of "create FAB (L1)").
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { FAB_RESERVED_BOTTOM_PX } from '@commise/ui/create-fab';
import { render } from '@commise/ui/testing/tamagui';

import { RecipeListLoadError } from '../RecipeListLoadError.native.js';

afterEach(cleanup);

const noop = () => undefined;

/**
 * Whether the element sits in a SCROLLER whose content ends with the floating button's room: some ancestor pads its foot
 * by `FAB_RESERVED_BOTTOM_PX` AND is the direct child of an element that scrolls. Room on a view that does not scroll
 * moves nothing, so the room alone is not enough.
 */
function endsInScrollerWithFabRoom(element: HTMLElement): boolean {
    for (let node = element.parentElement; node?.parentElement; node = node.parentElement) {
        const scrolls = ['auto', 'scroll'].includes(getComputedStyle(node.parentElement).overflowY);

        if (scrolls && getComputedStyle(node).paddingBottom === `${String(FAB_RESERVED_BOTTOM_PX)}px`) {
            return true;
        }
    }

    return false;
}

describe('RecipeListLoadError (native)', () => {
    it('shows an alert with a retry action that reports upward', () => {
        const onRetry = vi.fn();
        render(<RecipeListLoadError onRetry={onRetry} />);

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load your recipes.');

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    // ⚠️ REWRITTEN. This test pinned that the error body keeps the create button. That need is unchanged, but the button
    // now lives in the FRAME (outside the read boundary, so it also shows offline, where this body never renders):
    // `RecipeListFrame.native.test.tsx` pins it there, and `RecipeListScreen.native.test.tsx` pins that a failed read
    // still shows it. Two buttons would be the defect.
    it('draws no create button of its own: the frame owns the one floating control', () => {
        render(<RecipeListLoadError onRetry={noop} />);

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
    });

    it('offers no first-run CTA — the library has not said it is empty', () => {
        render(<RecipeListLoadError onRetry={noop} />);

        expect(screen.queryByRole('button', { name: 'Add a recipe' })).toBeNull();
        expect(screen.queryByText('Your recipe box is empty')).toBeNull();
    });

    // Designer ruling 2026-11-01 (`nativeBoards/designAnswers.md`, Recipes tab): the error state gets the same 88 end
    // room as the cards, so the floating button the frame keeps here never covers its end. It used to sit in a view that
    // did not scroll. ⚠️ That the end clears the button shows only on a device.
    it('scrolls, and ends with the floating button’s room', () => {
        render(<RecipeListLoadError onRetry={noop} />);

        expect(endsInScrollerWithFabRoom(screen.getByText('We couldn’t load your recipes.'))).toBe(true);
    });
});
