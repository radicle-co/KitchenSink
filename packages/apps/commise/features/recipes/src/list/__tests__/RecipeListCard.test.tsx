// @vitest-environment jsdom
/**
 * Component tests for the web recipe-list card — the row rendered per recipe in the list. Covers the
 * visible facets (title, formatted total time) and the interaction contract (an actionable control named
 * by the title that reports the recipe id upward), asserting on role/name so a broken label or a wrong id
 * would fail.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { makeRecipeListItem } from '../../__fixtures__/index.js';
import { RecipeListCard } from '../RecipeListCard.js';

afterEach(cleanup);

describe('RecipeListCard (web)', () => {
    it('renders the recipe title', () => {
        render(<RecipeListCard recipe={makeRecipeListItem({ title: 'Herb Risotto' })} onSelect={vi.fn()} />);

        expect(screen.getByText('Herb Risotto')).toBeTruthy();
    });

    it('renders the total time formatted as minutes', () => {
        render(<RecipeListCard recipe={makeRecipeListItem({ totalTimeMinutes: 45 })} onSelect={vi.fn()} />);

        expect(screen.getByText('45 min')).toBeTruthy();
    });

    it('exposes the card as an article labelled by the recipe title', () => {
        render(<RecipeListCard recipe={makeRecipeListItem({ title: 'Herb Risotto' })} onSelect={vi.fn()} />);

        expect(screen.getByRole('article', { name: 'Herb Risotto' })).toBeTruthy();
    });

    it('activates with the recipe id when its button is pressed', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(
            <RecipeListCard recipe={makeRecipeListItem({ id: 'rec_42', title: 'Herb Risotto' })} onSelect={onSelect} />,
        );

        await user.click(screen.getByRole('button', { name: 'Herb Risotto' }));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('rec_42');
    });

    it('keeps the duration inside the card', () => {
        render(
            <RecipeListCard
                recipe={makeRecipeListItem({ title: 'Herb Risotto', totalTimeMinutes: 35 })}
                onSelect={vi.fn()}
            />,
        );

        const region = screen.getByRole('article', { name: 'Herb Risotto' });
        expect(within(region).getByText('35 min')).toBeTruthy();
    });
});
