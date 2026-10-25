// @vitest-environment jsdom
/**
 * Component tests for the web `PasteChoicePane`: the side pane at 1194 and on web
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). It names itself, says which open line it
 * shows out of how many, heads the line, and steps with Previous and Next — always drawn, disabled at an end, so
 * nothing moves under the cook.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { recipeFormMessages } from '../messages.js';
import type { FoodChoice, OpenLine } from '../pasteMatchLine.js';
import { pasteMatchPaneViewOf, type PanePlace } from '../pasteMatchView.js';
import { PasteChoicePane } from '../PasteChoicePane.js';

const m = recipeFormMessages.en;
const MILKS: readonly FoodChoice[] = [
    { id: 'skim', name: 'Skim milk', isDefault: false },
    { id: 'whole', name: 'Whole milk', isDefault: true },
];
const MILK_LINE: OpenLine = {
    key: 'l1',
    line: { measure: '2 cups', words: 'milk' },
    need: { kind: 'default', noun: 'milk', options: MILKS, chosenId: undefined },
};
const BREAD_LINE: OpenLine = {
    key: 'l3',
    line: { measure: '6 slices', words: 'day-old bread' },
    need: {
        kind: 'needsChoice',
        options: [
            { id: 'white', name: 'White bread, sliced', isDefault: false, detailParts: ['Commercially prepared'] },
            { id: 'wheat', name: 'Whole-wheat bread', isDefault: false },
            { id: 'sour', name: 'Sourdough bread', isDefault: false },
            { id: 'brioche', name: 'Brioche', isDefault: false },
            { id: 'challah', name: 'Challah, egg bread', isDefault: false },
        ],
        chosenId: undefined,
    },
};
const SPICE_LINE: OpenLine = {
    key: 'l9',
    line: { measure: '1 tsp', words: 'Grandma’s spice mix' },
    need: { kind: 'noMatch' },
};

const listHandlers = () => ({
    onSearch: vi.fn(),
    onChoose: vi.fn(),
    onKeepAsWritten: vi.fn(),
    onSearchFocusRequestHandled: vi.fn(),
});

afterEach(cleanup);

function renderPane(line: OpenLine, place: PanePlace) {
    const handlers = { ...listHandlers(), onPrevious: vi.fn(), onNext: vi.fn() };

    render(
        <PasteChoicePane
            view={pasteMatchPaneViewOf(line, place, true, m)}
            searchFocusRequested={false}
            {...handlers}
        />,
    );

    return handlers;
}

const disabled = (button: HTMLElement): boolean =>
    button.getAttribute('aria-disabled') === 'true' || button.hasAttribute('disabled');

describe('PasteChoicePane (web)', () => {
    it('names itself, says where it is, and heads the line', () => {
        renderPane(BREAD_LINE, { index: 1, count: 4 });

        expect(screen.getByRole('complementary', { name: 'Choose a food' })).toBeTruthy();
        expect(screen.getByText('Open line 2 of 4')).toBeTruthy();
        expect(screen.getByRole('heading', { name: '6 slices day-old bread' })).toBeTruthy();
        expect(screen.getByText('More than one food fits. Nothing is chosen for you.')).toBeTruthy();
    });

    it('offers the line’s list: Search first, the options, Keep as written last', () => {
        renderPane(BREAD_LINE, { index: 1, count: 4 });

        expect(screen.getByRole('button', { name: 'Search for a food for 6 slices day-old bread' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'White bread, sliced, Commercially prepared' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Keep “6 slices day-old bread” as written' })).toBeTruthy();
    });

    it('in the middle, Previous and Next both step', () => {
        const { onPrevious, onNext } = renderPane(BREAD_LINE, { index: 1, count: 4 });

        fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
        fireEvent.click(screen.getByRole('button', { name: 'Next open line' }));

        expect(onPrevious).toHaveBeenCalledTimes(1);
        expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('on the first line, Previous is drawn but disabled and does nothing', () => {
        const { onPrevious } = renderPane(MILK_LINE, { index: 0, count: 4 });

        const previous = screen.getByRole('button', { name: 'Previous' });
        expect(disabled(previous)).toBe(true);
        fireEvent.click(previous);
        expect(onPrevious).not.toHaveBeenCalled();
        expect(disabled(screen.getByRole('button', { name: 'Next open line' }))).toBe(false);
    });

    it('on the last line, Next is drawn but disabled and does nothing', () => {
        const { onNext } = renderPane(SPICE_LINE, { index: 3, count: 4 });

        const next = screen.getByRole('button', { name: 'Next open line' });
        expect(disabled(next)).toBe(true);
        fireEvent.click(next);
        expect(onNext).not.toHaveBeenCalled();
    });

    it('a choice in the pane is the pick', () => {
        const { onChoose } = renderPane(BREAD_LINE, { index: 1, count: 4 });

        fireEvent.click(screen.getByRole('button', { name: 'Brioche' }));

        expect(onChoose).toHaveBeenCalledExactlyOnceWith('brioche');
    });
});
