/**
 * Native component tests for the browse-rail RESULTS (react-native-web under jsdom). Mirrors
 * `RecipeBrowseRailResults.test.tsx`; moved from `RecipeBrowseRails.native.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
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

/**
 * The rail's scroll hint (`docs/design/uiOverhaul/horizontalScrollHint.md`): the strip is the design-system
 * `HorizontalScroller`, so a chevron on a gradient into the canvas hints at the cards beyond while the strip rests at its
 * start. The scroller's own suite owns the behaviour; this pins that the rail is wired to it and to the platform's own
 * scroll indicator, which the strip used to switch off.
 */
describe('RecipeBrowseRailResults (native) — the scroll hint', () => {
    const FADE = '[data-commise-stub="linear-gradient"]';

    /** Report a laid-out size to a view, the way react-native-web's ResizeObserver does. */
    function layOut(element: Element, width: number): void {
        const handler = (element as Element & { __reactLayoutHandler?: (event: unknown) => void }).__reactLayoutHandler;

        act(() => handler?.({ nativeEvent: { layout: { x: 0, y: 0, width, height: 224 } } }));
    }

    const measured = (container: HTMLElement): Element[] =>
        [...container.querySelectorAll('*')].filter(
            (node) => (node as Element & { __reactLayoutHandler?: unknown }).__reactLayoutHandler !== undefined,
        );

    it('hints at the cards beyond with the chevron while the strip rests at its start', () => {
        const { container } = render(
            <RecipeBrowseRailResults results={twoResults} saveCopy={SAVE_COPY} onSelectRecipe={noop} />,
        );
        const [scroller, content] = measured(container);

        expect(container.querySelector(FADE)).toBeNull();

        layOut(scroller as Element, 320);
        layOut(content as Element, 560);

        expect(container.querySelector(FADE)).not.toBeNull();
        expect(container.querySelector('[data-icon-name="chevron-right"]')).not.toBeNull();
    });

    it('leaves the platform’s scroll indicator on', () => {
        const { container } = render(
            <RecipeBrowseRailResults results={twoResults} saveCopy={SAVE_COPY} onSelectRecipe={noop} />,
        );

        // react-native-web marks a ScrollView whose indicator is switched off with a `scrollbarWidth` class.
        expect((measured(container)[0] as Element).className).not.toMatch(/scrollbarWidth/u);
    });
});
