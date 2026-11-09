//
/**
 * `RecipeVersionsView` (native): when the session reports a restore the server refused for a private food, the view draws the
 * refusal sheet at the restore door (private foods spec section 7): the lines named, "Open food" for each, only the ways
 * that work for a restore (change them, or ask to make each food public), no "publish as private" and no upsell. The
 * session itself (naming the lines from the version) is `useRecipeVersions.test.tsx`; the leaves around the sheet are
 * stubbed here because their own suites cover them.
 */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { render } from '@commise/ui/testing/tamagui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecipeVersionsSession } from '../useRecipeVersions.js';
import { RecipeVersionsView } from '../RecipeVersionsView.js';

const { sessionRef } = vi.hoisted(() => ({ sessionRef: { current: undefined as unknown } }));

vi.mock('../useRecipeVersions.js', () => ({ useRecipeVersions: () => sessionRef.current }));
vi.mock('../RecipeVersionList.js', () => ({ RecipeVersionList: () => null }));
vi.mock('../VersionPreviewModal.js', () => ({ VersionPreviewModal: () => null }));
vi.mock('../VersionCompareView.js', () => ({ VersionCompareView: () => null }));

afterEach(cleanup);

const mount = (privateFoods: RecipeVersionsSession['privateFoods']) => {
    sessionRef.current = {
        list: {},
        preview: {},
        compare: {},
        ...(privateFoods === undefined ? {} : { privateFoods }),
    };

    return render(<RecipeVersionsView recipeId="rec_1" />);
};

describe('RecipeVersionsView — a refused restore', () => {
    it('draws nothing extra when nothing was refused', () => {
        mount(undefined);

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('lists the refused line, offers Open food and Close, and no private or upsell action', () => {
        const onOpenFood = vi.fn();
        const onClose = vi.fn();
        mount({ lines: [{ rowId: '1', foodId: 'food_mix', text: '2 tbsp My spice mix' }], onOpenFood, onClose });
        expect(screen.getByText('This recipe can’t be public yet')).toBeTruthy();
        const dialog = document.body;

        expect(within(dialog).getByText('2 tbsp My spice mix')).toBeTruthy();
        expect(within(dialog).queryByRole('button', { name: /private/iu })).toBeNull();
        expect(within(dialog).queryByText(/upgrade|pro\b/iu)).toBeNull();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Open 2 tbsp My spice mix' }));
        expect(onOpenFood).toHaveBeenCalledWith('food_mix');

        fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalled();
    });
});
