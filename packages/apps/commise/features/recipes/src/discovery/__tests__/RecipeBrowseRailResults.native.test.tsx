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
import type { SaveCopy } from '../../hooks/useSaveCopy.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeBrowseRailResults } from '../RecipeBrowseRailResults.native.js';

afterEach(cleanup);

const noop = () => undefined;
const SAVE_COPY: SaveCopy = { stateOf: () => ({ kind: 'idle' }), save: noop };

function result(recipe: Partial<Recipe> = {}): RecipeSearchResult {
    return { recipe: makeRecipe(recipe) };
}

const twoResults = [result({ id: 'rec_t', title: 'Viral Pad Thai' }), result({ id: 'rec_n', title: 'Fresh Ceviche' })];

describe('RecipeBrowseRailResults (native)', () => {
    it('renders a card per result, and reports a selection and a saved copy upward', () => {
        const onSelectRecipe = vi.fn();
        const save = vi.fn();
        render(
            <RecipeBrowseRailResults
                results={twoResults}
                saveCopy={{ stateOf: () => ({ kind: 'idle' }), save }}
                onSelectRecipe={onSelectRecipe}
            />,
        );

        fireEvent.click(screen.getByRole('link', { name: 'Fresh Ceviche' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save a copy of Viral Pad Thai' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_n');
        expect(save).toHaveBeenCalledExactlyOnceWith('rec_t');
    });

    it('shows each card its own copy state', () => {
        render(
            <RecipeBrowseRailResults
                results={twoResults}
                saveCopy={{
                    stateOf: (id) => (id === 'rec_t' ? { kind: 'saved', copyId: 'c' } : { kind: 'idle' }),
                    save: noop,
                }}
                onSelectRecipe={noop}
            />,
        );

        expect(screen.getByRole('button', { name: 'Saved a copy of Viral Pad Thai' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Save a copy of Fresh Ceviche' })).toBeTruthy();
    });

    it('renders each card’s nutrition from the host’s renderer, keyed by recipe id', () => {
        render(
            <RecipeBrowseRailResults
                results={twoResults}
                saveCopy={SAVE_COPY}
                onSelectRecipe={noop}
                renderNutrition={(id) => <Text>{`kcal for ${id}`}</Text>}
            />,
        );

        expect(screen.getByText('kcal for rec_n')).toBeTruthy();
    });

    it('shows the empty note for a rail that settled with no recipes', () => {
        render(<RecipeBrowseRailResults results={[]} saveCopy={SAVE_COPY} onSelectRecipe={noop} />);

        expect(screen.getByText('Nothing here yet.')).toBeTruthy();
        expect(screen.queryByRole('link')).toBeNull();
    });
});
