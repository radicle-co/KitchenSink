/**
 * Done's two native actions, pinned in the foot where Back and Next were: Back to the recipe (filled), then Cook it again
 * (outlined), each full width. Moved from CookingDone.native.test.tsx when the actions left Done's body for the foot; the
 * second case is rewritten to the outlined Cook it again (it was quiet).
 */
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CookingDoneActions } from '../CookingDoneActions.native.js';
import type { CookingDoneActionsProps } from '../cookingViewProps.js';
import { pillOf } from './utils/buttonPill.js';

afterEach(cleanup);

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

function actionsProps(): CookingDoneActionsProps {
    return {
        backToRecipe: { label: 'Back to the recipe', onPress: vi.fn() },
        cookAgain: { label: 'Cook it again', onPress: vi.fn() },
    };
}

describe('CookingDoneActions (native)', () => {
    it('offers Back to the recipe, then Cook it again, each reporting its press', () => {
        const props = actionsProps();
        render(<CookingDoneActions {...props} />);

        const buttons = screen.getAllByRole('button');
        const back = screen.getByRole('button', { name: 'Back to the recipe' });
        const again = screen.getByRole('button', { name: 'Cook it again' });

        expect(buttons.indexOf(back)).toBeLessThan(buttons.indexOf(again));

        fireEvent.click(back);
        fireEvent.click(again);

        expect(props.backToRecipe.onPress).toHaveBeenCalledTimes(1);
        expect(props.cookAgain.onPress).toHaveBeenCalledTimes(1);
    });

    // Back to the recipe is the one filled action; Cook it again is outlined: a border, and not the action fill.
    it('fills Back to the recipe and outlines Cook it again', () => {
        render(<CookingDoneActions {...actionsProps()} />);

        const back = getComputedStyle(pillOf(screen.getByRole('button', { name: 'Back to the recipe' })));
        const again = getComputedStyle(pillOf(screen.getByRole('button', { name: 'Cook it again' })));

        expect(back.backgroundColor).not.toBe(TRANSPARENT);
        expect(again.backgroundColor).not.toBe(back.backgroundColor);
        expect(Number.parseFloat(again.borderTopWidth)).toBeGreaterThan(0);
        expect(Number.parseFloat(back.borderTopWidth) || 0).toBe(0);
    });
});
