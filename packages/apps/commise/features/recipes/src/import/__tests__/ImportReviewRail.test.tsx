// @vitest-environment jsdom
/**
 * Component tests for the web `ImportReviewRail` (board WizardStep at 1194 and web): a navigation landmark over a window
 * of the recipes to review, the current one marked, a skipped one saying so in its name, and the recipes added without
 * a step counted under it.
 *
 * The skipped row's name keeps a no-break space before its dot, and every count has its count-1 case (review finding
 * M2).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ImportReviewRail } from '../ImportReviewRail.js';
import { importMessages } from '../messages.js';
import type { ImportReviewRailProps } from '../props.js';

const r = importMessages.en.wizard.rail;

afterEach(cleanup);

const RECIPES = [
    { id: 'beef', title: 'Beef stew', skipped: false },
    { id: 'blondies', title: 'Blondies', skipped: true },
    { id: 'lemon', title: 'Lemon drizzle cake', skipped: false },
];

function renderRail(overrides: Partial<ImportReviewRailProps> = {}) {
    const onOpenRecipe = vi.fn();
    render(
        <ImportReviewRail
            total={309}
            recipes={RECIPES}
            currentId="lemon"
            addedWithoutStep={546}
            onOpenRecipe={onOpenRecipe}
            {...overrides}
        />,
    );

    return { onOpenRecipe, nav: screen.getByRole('navigation', { name: r.label }) };
}

describe('ImportReviewRail (web)', () => {
    it('titles the rail with the number of recipes to review', () => {
        const { nav } = renderRail();

        expect(within(nav).getByText('309 recipes to review')).toBeTruthy();
    });

    it('lists the window of recipes in order, the current one marked as the step, a skipped one saying so', () => {
        const { nav } = renderRail();

        const buttons = within(nav).getAllByRole('button');

        expect(buttons).toEqual([
            within(nav).getByRole('button', { name: 'Beef stew' }),
            within(nav).getByRole('button', { name: 'Blondies\u00A0· skipped' }),
            within(nav).getByRole('button', { name: 'Lemon drizzle cake' }),
        ]);
        expect(buttons.map((button) => button.getAttribute('aria-current'))).toEqual([null, null, 'step']);
    });

    it('opens a recipe by its id', async () => {
        const user = userEvent.setup();
        const { onOpenRecipe } = renderRail();

        await user.click(screen.getByRole('button', { name: 'Beef stew' }));

        expect(onOpenRecipe).toHaveBeenCalledWith('beef');
    });

    it('counts the recipes added without a step, and says nothing of them when there are none', () => {
        renderRail();
        expect(screen.getByText('546 more needed nothing from you and are already in.')).toBeTruthy();
        cleanup();

        renderRail({ addedWithoutStep: 0 });
        expect(screen.queryByText(/needed nothing from you/u)).toBeNull();
    });

    it('one recipe of each reads in the singular', () => {
        renderRail({ total: 1, addedWithoutStep: 1 });

        expect(screen.getByText('1 recipe to review')).toBeTruthy();
        expect(screen.getByText('1 more needed nothing from you and is already in.')).toBeTruthy();
    });

    // U10: the fill alone is 1.2:1 on the paper; the selected-edge ring is 3.9:1 on it, and 5.1:1 in the dark theme.
    it('marks the current recipe with the selected-edge ring as well as the fill', () => {
        renderRail();

        const current = screen.getAllByRole('button').find((button) => button.getAttribute('aria-current') === 'step');

        expect(current?.className.split(' ')).toEqual(
            expect.arrayContaining(['bg-selected-fill', 'ring-2', 'ring-inset', 'ring-selected-edge']),
        );
    });
});
