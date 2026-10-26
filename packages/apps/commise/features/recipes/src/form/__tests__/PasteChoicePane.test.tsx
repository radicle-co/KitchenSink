// @vitest-environment jsdom
/**
 * Component tests for the web `PasteChoicePane`: the side pane at 1194 and on web
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). It names itself, says which open line it
 * shows out of how many, heads the line, and steps with Previous and Next — always drawn, disabled at an end, so
 * nothing moves under the cook.
 *
 * REWRITTEN when the paste and import builds were reconciled: the pane reads the one line model, a choice sends a pick,
 * and the focus request is the house `ControlFocus`.
 *
 * REWRITTEN for M4 (2026-10-25): the pane counts over ALL the recipe's lines ("Line 4 of 5") and steps to the previous
 * and next OPEN line, so a line it shows keeps its place after it is chosen. It said "Open line 2 of 4". M6 adds a
 * failed pick with Try again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { recipeMessages } from '../../messages.js';
import {
    makeCheckingLine,
    makeConfidentLine,
    makeDefaultLine,
    makeFoodChoice,
    makeNeedsChoiceLine,
    makeNoMatchLine,
} from '../../ingredientMatching/__fixtures__/matchLines.js';
import type { MatchLine } from '../../ingredientMatching/matchLine.js';
import { matchLineMessages } from '../../ingredientMatching/messages.js';
import { recipeFormMessages } from '../messages.js';
import { PasteChoicePane } from '../PasteChoicePane.js';
import { pasteMatchPaneViewOf } from '../pasteMatchView.js';

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

/** The recipe the pane steps through: eggs (matched), milk, cream (checking), bread and the spice mix. */
const RECIPE: readonly MatchLine[] = [makeConfidentLine(), MILK_LINE, makeCheckingLine(), BREAD_LINE, SPICE_LINE];
const NOTHING_SENT: ReadonlySet<string> = new Set();

function paneOf(
    shownKey: string,
    options: { failed?: boolean; online?: boolean; focusRequested?: boolean },
    handlers: Record<'onSearch' | 'onPick' | 'onPrevious' | 'onNext' | 'onRetryPick' | 'onHandled', () => void>,
) {
    return (
        <PasteChoicePane
            view={pasteMatchPaneViewOf(
                { lines: RECIPE, shownKey, sending: NOTHING_SENT },
                { online: options.online ?? true, pending: undefined, failed: options.failed ?? false },
                m,
                lineCopy,
            )}
            focus={{ requested: options.focusRequested ?? false, onHandled: handlers.onHandled }}
            {...handlers}
        />
    );
}

function renderPane(shownKey: string, options: { failed?: boolean; online?: boolean; focusRequested?: boolean } = {}) {
    const handlers = {
        onSearch: vi.fn(),
        onPick: vi.fn(),
        onPrevious: vi.fn(),
        onNext: vi.fn(),
        onRetryPick: vi.fn(),
        onHandled: vi.fn(),
    };
    const result = render(paneOf(shownKey, options, handlers));

    return { ...handlers, rerender: (key: string) => result.rerender(paneOf(key, options, handlers)) };
}

const disabled = (button: HTMLElement): boolean =>
    button.getAttribute('aria-disabled') === 'true' || button.hasAttribute('disabled');

describe('PasteChoicePane (web)', () => {
    it('names itself, says where it is, and heads the line', () => {
        renderPane('bread');

        expect(screen.getByRole('complementary', { name: 'Choose a food' })).toBeTruthy();
        expect(screen.getByText('Line 4 of 5')).toBeTruthy();
        expect(screen.getByRole('heading', { name: '6 slices day-old bread' })).toBeTruthy();
        expect(screen.getByText('More than one food fits. Nothing is chosen for you.')).toBeTruthy();
    });

    it('offers the line’s list: Search first, the options, Keep as written last', () => {
        renderPane('bread');

        expect(screen.getByRole('button', { name: 'Search for a food for 6 slices day-old bread' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'White bread, sliced, Commercially prepared' })).toBeTruthy();
        expect(
            screen.getByRole('button', { name: 'Keep “6 slices day-old bread” as written\u00A0· no nutrition' }),
        ).toBeTruthy();
    });

    it('in the middle, Previous and Next both step', () => {
        const { onPrevious, onNext } = renderPane('bread');

        fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
        fireEvent.click(screen.getByRole('button', { name: 'Next open line' }));

        expect(onPrevious).toHaveBeenCalledTimes(1);
        expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('on the first open line, Previous is drawn but disabled and does nothing', () => {
        const { onPrevious } = renderPane('milk');

        const previous = screen.getByRole('button', { name: 'Previous' });
        expect(disabled(previous)).toBe(true);
        fireEvent.click(previous);
        expect(onPrevious).not.toHaveBeenCalled();
        expect(disabled(screen.getByRole('button', { name: 'Next open line' }))).toBe(false);
    });

    it('on the last open line, Next is drawn but disabled and does nothing', () => {
        const { onNext } = renderPane('spice');

        const next = screen.getByRole('button', { name: 'Next open line' });
        expect(disabled(next)).toBe(true);
        fireEvent.click(next);
        expect(onNext).not.toHaveBeenCalled();
    });

    it('a choice in the pane is the pick', () => {
        const { onPick } = renderPane('bread');

        fireEvent.click(screen.getByRole('button', { name: 'Brioche' }));

        expect(onPick).toHaveBeenCalledExactlyOnceWith({ kind: 'food', foodId: 'brioche', name: 'Brioche' });
    });

    it('⛔ M6: a pick in the pane that failed says so, and Try again sends it again', () => {
        const { onRetryPick } = renderPane('bread', { failed: true });

        expect(screen.getByText('We couldn’t save that choice.')).toBeTruthy();
        fireEvent.click(
            screen.getByRole('button', { name: 'Try again to save the choice for 6 slices day-old bread' }),
        );
        expect(onRetryPick).toHaveBeenCalledTimes(1);
    });

    it('⛔ H1: offline, a focus request in the pane lands on the first option, and is acknowledged', () => {
        const { onHandled } = renderPane('bread', { online: false, focusRequested: true });

        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'White bread, sliced, Commercially prepared' }),
        );
        expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('⛔ stepping onto the last open line keeps focus on Next: refused, never natively disabled (2.4.3)', () => {
        const { rerender } = renderPane('bread');

        screen.getByRole('button', { name: 'Next open line' }).focus();
        rerender('spice');

        const next = screen.getByRole('button', { name: 'Next open line' });

        expect(next.getAttribute('aria-disabled')).toBe('true');
        expect(next.hasAttribute('disabled')).toBe(false);
        expect(document.activeElement).toBe(next);
    });
});
