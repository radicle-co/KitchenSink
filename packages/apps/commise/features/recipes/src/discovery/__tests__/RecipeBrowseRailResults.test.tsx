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
import type { SaveCopy } from '../../hooks/useSaveCopy.js';
import { RecipeBrowseRailResults } from '../RecipeBrowseRailResults.js';

afterEach(cleanup);

const noop = () => undefined;

function result(recipe: Partial<Recipe> = {}): RecipeSearchResult {
    return { recipe: makeRecipe(recipe) };
}

const SAVE_COPY: SaveCopy = { stateOf: () => ({ kind: 'idle' }), save: noop };

const twoResults = [result({ id: 'rec_t', title: 'Viral Pad Thai' }), result({ id: 'rec_n', title: 'Fresh Ceviche' })];

describe('RecipeBrowseRailResults (web)', () => {
    it('renders one card per result in a list', () => {
        render(<RecipeBrowseRailResults results={twoResults} saveCopy={SAVE_COPY} onSelectRecipe={noop} />);

        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByRole('button', { name: 'Viral Pad Thai' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Fresh Ceviche' })).toBeTruthy();
    });

    it('reports a selected recipe and a saved copy upward, showing each card its own copy state', async () => {
        const user = userEvent.setup();
        const onSelectRecipe = vi.fn();
        const save = vi.fn();
        render(
            <RecipeBrowseRailResults
                results={twoResults}
                saveCopy={{
                    stateOf: (id) => (id === 'rec_t' ? { kind: 'saving' } : { kind: 'idle' }),
                    save,
                }}
                onSelectRecipe={onSelectRecipe}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Fresh Ceviche' }));
        await user.click(screen.getByRole('button', { name: 'Save a copy of Fresh Ceviche' }));

        expect(onSelectRecipe).toHaveBeenCalledWith('rec_n');
        expect(save).toHaveBeenCalledExactlyOnceWith('rec_n');
        expect(screen.getByRole('button', { name: 'Saving a copy of Viral Pad Thai' }).getAttribute('aria-busy')).toBe(
            'true',
        );
    });

    it('draws full grid cards, 78% of the track wide and between 240 and 256 px, that snap to the start', () => {
        render(<RecipeBrowseRailResults results={twoResults} saveCopy={SAVE_COPY} onSelectRecipe={noop} />);

        for (const item of within(screen.getByRole('list')).getAllByRole('listitem')) {
            expect(item.className).toContain('w-[clamp(240px,78%,256px)]');
            expect(item.className).toContain('snap-start');
            expect(item.querySelector('[data-card-variant="grid"]')).not.toBeNull();
        }
    });

    it('renders each card’s nutrition from the host’s renderer, keyed by recipe id', () => {
        render(
            <RecipeBrowseRailResults
                results={twoResults}
                saveCopy={SAVE_COPY}
                onSelectRecipe={noop}
                renderNutrition={(id) => <span>{`kcal for ${id}`}</span>}
            />,
        );

        expect(screen.getByText('kcal for rec_t')).toBeTruthy();
        expect(screen.getByText('kcal for rec_n')).toBeTruthy();
    });

    it('shows the empty note, and no list, for a rail that settled with no recipes', () => {
        render(<RecipeBrowseRailResults results={[]} saveCopy={SAVE_COPY} onSelectRecipe={noop} />);

        expect(screen.getByText('Nothing here yet.')).toBeTruthy();
        expect(screen.queryByRole('list')).toBeNull();
    });
});
