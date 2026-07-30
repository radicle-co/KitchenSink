/**
 * Native component tests for the recipe-list card (rendered via react-native-web under jsdom). Mirrors the
 * web leaf's contract: the title as visible text, the formatted total time, a button named by the title,
 * and selection reporting the recipe id upward.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { makeRecipeListItem } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeListCard } from '../RecipeListCard.native.js';

afterEach(cleanup);

describe('RecipeListCard (native)', () => {
    it('renders the recipe title as visible text', () => {
        render(<RecipeListCard recipe={makeRecipeListItem({ title: 'Herb Risotto' })} onSelect={vi.fn()} />);

        expect(screen.getByText('Herb Risotto')).toBeTruthy();
    });

    it('renders the total time formatted as minutes', () => {
        render(<RecipeListCard recipe={makeRecipeListItem({ totalTimeMinutes: 45 })} onSelect={vi.fn()} />);

        expect(screen.getByText('45 min')).toBeTruthy();
    });

    it('exposes a button named by the recipe title', () => {
        render(<RecipeListCard recipe={makeRecipeListItem({ title: 'Herb Risotto' })} onSelect={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Herb Risotto' })).toBeTruthy();
    });

    it('reports the recipe id upward when pressed', () => {
        const onSelect = vi.fn();
        render(
            <RecipeListCard recipe={makeRecipeListItem({ id: 'rec_42', title: 'Herb Risotto' })} onSelect={onSelect} />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Herb Risotto' }));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('rec_42');
    });
});
