// @vitest-environment jsdom
/**
 * Component tests for the web `PasteChoicePane`: the side pane at 1194 and on web
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). It names itself, says which open line it
 * shows out of how many, heads the line, and steps with Previous and Next — always drawn, disabled at an end, so
 * nothing moves under the cook.
 *
 * REWRITTEN when the paste and import builds were reconciled: the pane reads the one line model, a choice sends a pick,
 * and the focus request is the house `ControlFocus`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { recipeMessages } from '../../messages.js';
import {
    makeDefaultLine,
    makeFoodChoice,
    makeNeedsChoiceLine,
    makeNoMatchLine,
} from '../../ingredientMatching/__fixtures__/matchLines.js';
import type { MatchLine } from '../../ingredientMatching/matchLine.js';
import { matchLineMessages } from '../../ingredientMatching/messages.js';
import { recipeFormMessages } from '../messages.js';
import { PasteChoicePane } from '../PasteChoicePane.js';
import { pasteMatchPaneViewOf, type PanePlace } from '../pasteMatchView.js';

const m = recipeFormMessages.en;
const lineCopy = { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails };
const MILK_LINE = makeDefaultLine();
const BREAD_LINE = makeNeedsChoiceLine({
    candidates: [
        makeFoodChoice({ id: 'white', name: 'White bread, sliced', detailParts: ['Commercially prepared'] }),
        makeFoodChoice({ id: 'wheat', name: 'Whole-wheat bread' }),
        makeFoodChoice({ id: 'sour', name: 'Sourdough bread' }),
        makeFoodChoice({ id: 'brioche', name: 'Brioche' }),
        makeFoodChoice({ id: 'challah', name: 'Challah, egg bread' }),
    ],
});
const SPICE_LINE = makeNoMatchLine({ line: { measure: '1 tsp', words: 'Grandma’s spice mix' } });

afterEach(cleanup);

function renderPane(line: MatchLine, place: PanePlace) {
    const handlers = { onSearch: vi.fn(), onPick: vi.fn(), onPrevious: vi.fn(), onNext: vi.fn() };

    render(
        <PasteChoicePane
            view={pasteMatchPaneViewOf(line, place, { online: true, pending: undefined }, m, lineCopy)}
            searchFocus={{ requested: false, onHandled: vi.fn() }}
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
        const { onPick } = renderPane(BREAD_LINE, { index: 1, count: 4 });

        fireEvent.click(screen.getByRole('button', { name: 'Brioche' }));

        expect(onPick).toHaveBeenCalledExactlyOnceWith({ kind: 'food', foodId: 'brioche', name: 'Brioche' });
    });
});
