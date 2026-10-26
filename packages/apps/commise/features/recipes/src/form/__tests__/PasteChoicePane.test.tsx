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
import userEvent from '@testing-library/user-event';

import { recipeMessages } from '../../messages.js';
import {
    makeCheckingLine,
    makeConfidentLine,
    makeDefaultLine,
    makeFoodChoice,
    makeNeedsChoiceLine,
    makeNoMatchLine,
} from '../../ingredientMatching/__fixtures__/matchLines.js';
import type { MatchLine, PendingSend } from '../../ingredientMatching/matchLine.js';
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

/**
 * WCAG 2.2 SC 2.4.3 (Focus Order): Try again unmounts while its retry is in flight. The pane gets the retry only as a
 * new view, so it must tell a retry from a first attempt from the view alone: focus lands on the option being retried
 * (busy, refused, never natively disabled), returns to the new Try again if the retry fails again, and a first failure
 * moves nothing.
 */
describe('PasteChoicePane (web): Try again keeps focus (WCAG 2.4.3)', () => {
    const RETRY = 'Try again to save the choice for 2 cups milk';
    const SKIM_PENDING: PendingSend = { kind: 'pick', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } };
    const handlers = {
        onSearch: vi.fn(),
        onPick: vi.fn(),
        onPrevious: vi.fn(),
        onNext: vi.fn(),
        onRetryPick: vi.fn(),
    };

    const paneWith = (place: { failed: boolean; pending: PendingSend | undefined }) => (
        <>
            <button type="button">Elsewhere</button>
            <PasteChoicePane
                view={pasteMatchPaneViewOf(
                    { lines: RECIPE, shownKey: 'milk', sending: NOTHING_SENT },
                    { online: true, ...place },
                    m,
                    lineCopy,
                )}
                focus={{ requested: false, onHandled: vi.fn() }}
                {...handlers}
            />
        </>
    );

    it('⛔ pressing Try again lands focus on the option being retried, busy and not natively disabled', async () => {
        const user = userEvent.setup();
        const { rerender } = render(paneWith({ failed: true, pending: undefined }));

        await user.click(screen.getByRole('button', { name: RETRY }));
        rerender(paneWith({ failed: true, pending: SKIM_PENDING }));

        const skim = screen.getByRole('button', { name: 'Skim milk' });

        expect(screen.queryByRole('button', { name: RETRY })).toBeNull();
        expect(document.activeElement).toBe(skim);
        expect(skim.getAttribute('aria-busy')).toBe('true');
        expect(skim.hasAttribute('disabled')).toBe(false);
    });

    it('⛔ a retry that fails again returns focus to the new Try again', async () => {
        const user = userEvent.setup();
        const { rerender } = render(paneWith({ failed: true, pending: undefined }));

        await user.click(screen.getByRole('button', { name: RETRY }));
        rerender(paneWith({ failed: true, pending: SKIM_PENDING }));
        rerender(paneWith({ failed: true, pending: undefined }));

        expect(document.activeElement).toBe(screen.getByRole('button', { name: RETRY }));
    });

    it('a retry that succeeds leaves focus on the row, where a successful first pick leaves it', async () => {
        const user = userEvent.setup();
        const { rerender } = render(paneWith({ failed: true, pending: undefined }));

        await user.click(screen.getByRole('button', { name: RETRY }));
        rerender(paneWith({ failed: true, pending: SKIM_PENDING }));
        rerender(paneWith({ failed: false, pending: undefined }));

        expect(screen.queryByRole('button', { name: RETRY })).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Skim milk' }));
    });

    it('a first failure does not pull focus from where the cook has gone', () => {
        const { rerender } = render(paneWith({ failed: false, pending: SKIM_PENDING }));
        const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });

        elsewhere.focus();
        rerender(paneWith({ failed: true, pending: undefined }));

        expect(document.activeElement).toBe(elsewhere);
    });

    it('stepping to another failed line while one is retrying is not a retry of the new line', async () => {
        const user = userEvent.setup();
        const paneFor = (shownKey: string, place: { failed: boolean; pending: PendingSend | undefined }) => (
            <>
                <button type="button">Elsewhere</button>
                <PasteChoicePane
                    view={pasteMatchPaneViewOf(
                        { lines: RECIPE, shownKey, sending: NOTHING_SENT },
                        { online: true, ...place },
                        m,
                        lineCopy,
                    )}
                    focus={{ requested: false, onHandled: vi.fn() }}
                    {...handlers}
                />
            </>
        );
        const { rerender } = render(paneFor('milk', { failed: true, pending: SKIM_PENDING }));

        await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
        rerender(paneFor('bread', { failed: true, pending: undefined }));

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
    });
});

/**
 * The host owns the retry memory (host gap rule 1): the pane takes the shown line's `LineRetryFocus` as a prop, so a
 * retry the cook has left (they went to another line) takes no focus, and the pane and the list share one memory.
 */
describe('PasteChoicePane (web): the host’s retry memory', () => {
    it('⛔ a landing request from the host lands focus on the option being retried, and is lowered once', () => {
        const onLanded = vi.fn();
        const handlers = {
            onSearch: vi.fn(),
            onPick: vi.fn(),
            onPrevious: vi.fn(),
            onNext: vi.fn(),
            onRetryPick: vi.fn(),
        };
        const pending: PendingSend = { kind: 'pick', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } };

        render(
            <PasteChoicePane
                view={pasteMatchPaneViewOf(
                    { lines: RECIPE, shownKey: 'milk', sending: NOTHING_SENT },
                    { online: true, pending, failed: true },
                    m,
                    lineCopy,
                )}
                focus={{ requested: false, onHandled: vi.fn() }}
                retry={{
                    landing: { requested: true, onHandled: onLanded },
                    tryAgain: { requested: false, onHandled: vi.fn() },
                }}
                {...handlers}
            />,
        );

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Skim milk' }));
        expect(onLanded).toHaveBeenCalledTimes(1);
    });

    it('a request that is NOT raised takes no focus: the cook left the line', () => {
        const handlers = {
            onSearch: vi.fn(),
            onPick: vi.fn(),
            onPrevious: vi.fn(),
            onNext: vi.fn(),
            onRetryPick: vi.fn(),
        };

        render(
            <PasteChoicePane
                view={pasteMatchPaneViewOf(
                    { lines: RECIPE, shownKey: 'milk', sending: NOTHING_SENT },
                    { online: true, pending: undefined, failed: true },
                    m,
                    lineCopy,
                )}
                focus={{ requested: false, onHandled: vi.fn() }}
                retry={{
                    landing: { requested: false, onHandled: vi.fn() },
                    tryAgain: { requested: false, onHandled: vi.fn() },
                }}
                {...handlers}
            />,
        );

        expect(document.activeElement).toBe(document.body);
    });
});
