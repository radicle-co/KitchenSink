// @vitest-environment jsdom
/**
 * Component tests for the web browse-rail RESULTS — what one rail's read boundary renders once that rail has settled: a
 * horizontal strip of discovery cards, or the rail's empty note. Moved from `RecipeBrowseRails.test.tsx` ("rails" card
 * cases and the empty case of "rail states"), which now composes rails from bodies.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Recipe, RecipeSearchResult } from '@kitchensink/recipe-core';

import { makeRecipe } from '../../__fixtures__/index.js';
import { RecipeBrowseRailResults } from '../RecipeBrowseRailResults.js';

afterEach(cleanup);

const noop = () => undefined;

function result(recipe: Partial<Recipe> = {}): RecipeSearchResult {
    return { recipe: makeRecipe(recipe) };
}

const twoResults = [result({ id: 'rec_t', title: 'Viral Pad Thai' }), result({ id: 'rec_n', title: 'Fresh Ceviche' })];

describe('RecipeBrowseRailResults (web)', () => {
    it('renders one card per result in a list', () => {
        render(<RecipeBrowseRailResults results={twoResults} onSelectRecipe={noop} onClone={noop} />);

        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByRole('button', { name: 'Viral Pad Thai' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Fresh Ceviche' })).toBeTruthy();
    });

    it('reports a selected recipe and a clone upward, busying only the cloning card', async () => {
        const user = userEvent.setup();
        const onSelectRecipe = vi.fn();
        const onClone = vi.fn();
        render(
            <RecipeBrowseRailResults
                results={twoResults}
                cloningId="rec_t"
                onSelectRecipe={onSelectRecipe}
                onClone={onClone}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Fresh Ceviche' }));
        await user.click(screen.getByRole('button', { name: 'Clone Fresh Ceviche' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_n');
        expect(onClone).toHaveBeenCalledWith('rec_n');
        expect(screen.getByRole('button', { name: 'Cloning Viral Pad Thai' }).getAttribute('aria-busy')).toBe('true');
    });

    it('renders each card’s nutrition from the host’s renderer, keyed by recipe id', () => {
        render(
            <RecipeBrowseRailResults
                results={twoResults}
                onSelectRecipe={noop}
                onClone={noop}
                renderNutrition={(id) => <span>{`kcal for ${id}`}</span>}
            />,
        );

        expect(screen.getByText('kcal for rec_t')).toBeTruthy();
        expect(screen.getByText('kcal for rec_n')).toBeTruthy();
    });

    it('shows the empty note, and no list, for a rail that settled with no recipes', () => {
        render(<RecipeBrowseRailResults results={[]} onSelectRecipe={noop} onClone={noop} />);

        expect(screen.getByText('Nothing here yet.')).toBeTruthy();
        expect(screen.queryByRole('list')).toBeNull();
    });
});
