/**
 * Native component tests for the browse-rail RESULTS (react-native-web under jsdom). Mirrors
 * `RecipeBrowseRailResults.test.tsx`; moved from `RecipeBrowseRails.native.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import type { Recipe, RecipeSearchResult } from '@kitchensink/recipe-core';
import { Text } from 'react-native';

import { makeRecipe } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeBrowseRailResults } from '../RecipeBrowseRailResults.native.js';

afterEach(cleanup);

const noop = () => undefined;

function result(recipe: Partial<Recipe> = {}): RecipeSearchResult {
    return { recipe: makeRecipe(recipe) };
}

const twoResults = [result({ id: 'rec_t', title: 'Viral Pad Thai' }), result({ id: 'rec_n', title: 'Fresh Ceviche' })];

describe('RecipeBrowseRailResults (native)', () => {
    it('renders a card per result, and reports a selection and a clone upward', () => {
        const onSelectRecipe = vi.fn();
        const onClone = vi.fn();
        render(<RecipeBrowseRailResults results={twoResults} onSelectRecipe={onSelectRecipe} onClone={onClone} />);

        fireEvent.click(screen.getByRole('button', { name: 'Fresh Ceviche' }));
        fireEvent.click(screen.getByRole('button', { name: 'Clone Viral Pad Thai' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_n');
        expect(onClone).toHaveBeenCalledWith('rec_t');
    });

    it('busies only the cloning card', () => {
        render(<RecipeBrowseRailResults results={twoResults} cloningId="rec_t" onSelectRecipe={noop} onClone={noop} />);

        expect(screen.getByRole('button', { name: 'Cloning Viral Pad Thai' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Clone Fresh Ceviche' })).toBeTruthy();
    });

    it('renders each card’s nutrition from the host’s renderer, keyed by recipe id', () => {
        render(
            <RecipeBrowseRailResults
                results={twoResults}
                onSelectRecipe={noop}
                onClone={noop}
                renderNutrition={(id) => <Text>{`kcal for ${id}`}</Text>}
            />,
        );

        expect(screen.getByText('kcal for rec_n')).toBeTruthy();
    });

    it('shows the empty note for a rail that settled with no recipes', () => {
        render(<RecipeBrowseRailResults results={[]} onSelectRecipe={noop} onClone={noop} />);

        expect(screen.getByText('Nothing here yet.')).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });
});
