/**
 * Native component tests for `ImportReviewRail`, rendered through react-native-web under jsdom. Mirrors
 * `ImportReviewRail.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { ImportReviewRail } from '../ImportReviewRail.native.js';
import { importMessages } from '../messages.js';

const r = importMessages.en.wizard.rail;

afterEach(cleanup);

const RECIPES = [
    { id: 'beef', title: 'Beef stew', skipped: false },
    { id: 'blondies', title: 'Blondies', skipped: true },
    { id: 'lemon', title: 'Lemon drizzle cake', skipped: false },
];

describe('ImportReviewRail (native)', () => {
    it('lists the recipes, marks the current and the skipped, counts the rest, and opens a recipe', () => {
        const onOpenRecipe = vi.fn();
        render(
            <ImportReviewRail
                total={309}
                recipes={RECIPES}
                currentId="lemon"
                addedWithoutStep={546}
                onOpenRecipe={onOpenRecipe}
            />,
        );

        expect(screen.getByRole('navigation', { name: r.label })).toBeTruthy();
        expect(screen.getByText('309 recipes to review')).toBeTruthy();

        const buttons = screen.getAllByRole('button');

        expect(buttons.map((button) => button.textContent)).toEqual([
            'Beef stew',
            'Blondies · skipped',
            'Lemon drizzle cake',
        ]);
        expect(buttons.map((button) => button.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
        expect(screen.getByText('546 more needed nothing from you and are already in.')).toBeTruthy();

        fireEvent.click(buttons[0] as HTMLElement);

        expect(onOpenRecipe).toHaveBeenCalledWith('beef');
    });
});
