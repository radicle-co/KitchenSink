import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CookingDoneActions } from '../CookingDoneActions.js';

/**
 * Done's two actions, pinned in the foot where Back and Next were: "Back to
 * the recipe" filled, then "Cook it again" outlined, each full width.
 */
describe('CookingDoneActions', () => {
    const actions = (back = vi.fn(), again = vi.fn()) => (
        <CookingDoneActions
            backToRecipe={{ label: 'Back to the recipe', onPress: back }}
            cookAgain={{ label: 'Cook it again', onPress: again }}
        />
    );

    it('fills Back to the recipe and outlines Cook it again under it, each full width', () => {
        render(actions());

        const buttons = screen.getAllByRole('button');

        expect(buttons.map((button) => button.textContent)).toEqual(['Back to the recipe', 'Cook it again']);
        expect(buttons[0]?.className).toContain('bg-action');
        expect(buttons[1]?.className).not.toContain('bg-action');
        expect(buttons[1]?.className).toContain('border');

        for (const button of buttons) {
            expect(button.className).toContain('w-full');
        }
    });

    it('calls each action', () => {
        const back = vi.fn();
        const again = vi.fn();
        render(actions(back, again));

        fireEvent.click(screen.getByRole('button', { name: 'Cook it again' }));
        expect(again).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Back to the recipe' }));
        expect(back).toHaveBeenCalledTimes(1);
    });
});
