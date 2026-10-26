/**
 * Native component tests for `ImportFlaggedList`, rendered through react-native-web under jsdom. Mirrors
 * `ImportFlaggedList.test.tsx`, plus the native rule that the options pane shows only at the wide container class.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Text } from 'react-native';

const windowWidth = vi.hoisted(() => ({ current: 390 }));

const focusMoved = vi.hoisted(() => vi.fn());

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: focusMoved },
        useWindowDimensions: () => ({ ...actual.useWindowDimensions(), width: windowWidth.current }),
    };
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { ImportFlaggedList } from '../ImportFlaggedList.native.js';
import type { PendingSend } from '../../ingredientMatching/matchLine.js';
import type { ImportFlaggedListProps } from '../props.js';

afterEach(() => {
    cleanup();
    windowWidth.current = 390;
});

function renderList(overrides: Partial<ImportFlaggedListProps> = {}) {
    const onUseSuggestion = vi.fn();
    const onChooseAnother = vi.fn();
    const onRetry = vi.fn();
    render(
        <ImportFlaggedList
            total={23}
            lines={[
                {
                    key: 'milk',
                    text: '1 1/4 cups milk',
                    recipeTitle: 'Pancakes',
                    matchedFood: 'milk crackers',
                    suggestion: { foodId: 'f-whole', name: 'Whole milk' },
                },
            ]}
            pending={new Map()}
            failed={new Set()}
            announcement={{ text: '', occurrence: 0 }}
            onUseSuggestion={onUseSuggestion}
            onChooseAnother={onChooseAnother}
            onRetry={onRetry}
            {...overrides}
        />,
    );

    return { onUseSuggestion, onChooseAnother, onRetry };
}

describe('ImportFlaggedList (native)', () => {
    // REWRITTEN (design session, U7): the second control is "Choose another", named "Choose another food for {line}".
    it('heads “23 to check”; a row’s Use and Choose another report by key', () => {
        const { onUseSuggestion, onChooseAnother } = renderList();

        expect(screen.getByRole('heading', { name: '23 to check' })).toBeTruthy();
        expect(screen.getByText('1 1/4 cups milk · Pancakes')).toBeTruthy();
        expect(screen.getByText('Matched to milk crackers. Our check doubts it.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Use Whole milk for 1 1/4 cups milk' }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose another food for 1 1/4 cups milk' }));

        expect(screen.getByRole('button', { name: 'Choose another food for 1 1/4 cups milk' }).textContent).toBe(
            'Choose another',
        );
        expect(onUseSuggestion).toHaveBeenCalledWith('milk');
        expect(onChooseAnother).toHaveBeenCalledWith('milk');
    });

    it('⛔ M5: Use in flight reads busy; neither it nor Choose another sends again', () => {
        const { onUseSuggestion, onChooseAnother } = renderList({
            pending: new Map([['milk', { kind: 'useProposal' }]]),
        });

        const use = screen.getByRole('button', { name: 'Use Whole milk for 1 1/4 cups milk' });

        expect(use.getAttribute('aria-busy')).toBe('true');
        fireEvent.click(use);
        fireEvent.click(screen.getByRole('button', { name: 'Choose another food for 1 1/4 cups milk' }));

        expect(onUseSuggestion).not.toHaveBeenCalled();
        expect(onChooseAnother).not.toHaveBeenCalled();
    });

    it('shows the options pane only at the wide container class', () => {
        renderList({ detail: <Text>the pane</Text> });
        expect(screen.queryByText('the pane')).toBeNull();
        cleanup();

        windowWidth.current = 1194;
        renderList({ detail: <Text>the pane</Text> });
        expect(screen.getByText('the pane')).toBeTruthy();
    });

    it('⛔ M6: a Use that did not save says so on its row, with Try again naming the line; Try again reports the row to the host', () => {
        const { onUseSuggestion, onRetry } = renderList({ failed: new Set(['milk']) });

        expect(screen.getByText('We couldn’t save that choice.')).toBeTruthy();

        const retry = screen.getByRole('button', { name: 'Try again to save the choice for 1 1/4 cups milk' });

        expect(retry.textContent).toBe('Try again');

        fireEvent.click(retry);

        // The host repeats the action that failed (`sendLedger.retryOf`); Try again is NOT the Use again.
        expect(onRetry).toHaveBeenCalledExactlyOnceWith('milk');
        expect(onUseSuggestion).not.toHaveBeenCalled();
        expect(
            screen.getByRole('button', { name: 'Use Whole milk for 1 1/4 cups milk' }).hasAttribute('disabled'),
        ).toBe(false);
    });

    it('⛔ replay: Try again on each failed row reports THAT row, whatever the failed action was', () => {
        const { onRetry, onUseSuggestion, onChooseAnother } = renderList({
            total: 2,
            failed: new Set(['milk', 'spice']),
            lines: [
                {
                    key: 'milk',
                    text: '1 1/4 cups milk',
                    recipeTitle: 'Pancakes',
                    matchedFood: 'milk crackers',
                    suggestion: { foodId: 'f-whole', name: 'Whole milk' },
                },
                { key: 'spice', text: '1 tsp mixed spice', recipeTitle: 'Hot cross buns', matchedFood: 'Spice cake' },
            ],
        });

        fireEvent.click(screen.getByRole('button', { name: 'Try again to save the choice for 1 tsp mixed spice' }));
        fireEvent.click(screen.getByRole('button', { name: 'Try again to save the choice for 1 1/4 cups milk' }));

        expect(onRetry.mock.calls).toEqual([['spice'], ['milk']]);
        expect(onUseSuggestion).not.toHaveBeenCalled();
        expect(onChooseAnother).not.toHaveBeenCalled();
    });

    it('M6: a retry in flight hides the failure, and no failure shows when nothing failed', () => {
        renderList({ failed: new Set(['milk']), pending: new Map([['milk', { kind: 'useProposal' }]]) });

        expect(screen.queryByText('We couldn’t save that choice.')).toBeNull();
        cleanup();

        renderList();
        expect(screen.queryByText('We couldn’t save that choice.')).toBeNull();
    });

    it('⛔ U9: says what the host announces in ONE polite live region', () => {
        renderList({ announcement: { text: 'We couldn’t save the choice for 1 1/4 cups milk.', occurrence: 1 } });

        expect(screen.getAllByText('We couldn’t save the choice for 1 1/4 cups milk.')).toHaveLength(1);
    });
});

/**
 * WCAG 2.2 SC 2.4.3 (Focus Order), native: the flagged list's Try again unmounts while its retry is in flight, so the
 * screen-reader cursor must not be lost. It moves to the row's Use (busy), or to Choose another when the row has no
 * Use, and back to the new Try again if the retry fails again. A first failure moves nothing.
 */
describe('ImportFlaggedList (native): Try again keeps the screen-reader cursor (WCAG 2.4.3)', () => {
    const MILK_RETRY = 'Try again to save the choice for 1 1/4 cups milk';
    const USE_MILK = 'Use Whole milk for 1 1/4 cups milk';
    const USING: PendingSend = { kind: 'useProposal' };
    const LINES = [
        {
            key: 'milk',
            text: '1 1/4 cups milk',
            recipeTitle: 'Pancakes',
            matchedFood: 'milk crackers',
            suggestion: { foodId: 'f-whole', name: 'Whole milk' },
        },
        { key: 'spice', text: '1 tsp mixed spice', recipeTitle: 'Hot cross buns', matchedFood: 'Spice cake' },
    ];

    const listWith = (props: Partial<ImportFlaggedListProps>) => (
        <ImportFlaggedList
            total={2}
            lines={LINES}
            pending={new Map()}
            failed={new Set()}
            announcement={{ text: '', occurrence: 0 }}
            onUseSuggestion={vi.fn()}
            onChooseAnother={vi.fn()}
            onRetry={vi.fn()}
            {...props}
        />
    );

    it('⛔ pressing Try again moves the cursor to the Use being retried, shown busy', () => {
        const failed = new Set(['milk']);
        const { rerender } = render(listWith({ failed }));

        fireEvent.click(screen.getByRole('button', { name: MILK_RETRY }));
        focusMoved.mockClear();
        rerender(listWith({ failed, pending: new Map([['milk', USING]]) }));

        const use = screen.getByRole('button', { name: USE_MILK });

        expect(screen.queryByRole('button', { name: MILK_RETRY })).toBeNull();
        expect(use.getAttribute('aria-busy')).toBe('true');
        expect(focusMoved).toHaveBeenCalledExactlyOnceWith(use, 'focus');
    });

    it('⛔ a retry that fails again moves the cursor back to the new Try again', () => {
        const failed = new Set(['milk']);
        const { rerender } = render(listWith({ failed }));

        fireEvent.click(screen.getByRole('button', { name: MILK_RETRY }));
        rerender(listWith({ failed, pending: new Map([['milk', USING]]) }));
        focusMoved.mockClear();
        rerender(listWith({ failed }));

        expect(focusMoved).toHaveBeenCalledExactlyOnceWith(screen.getByRole('button', { name: MILK_RETRY }), 'focus');
    });

    it('a retry that succeeds moves the cursor nowhere else', () => {
        const failed = new Set(['milk']);
        const { rerender } = render(listWith({ failed }));

        fireEvent.click(screen.getByRole('button', { name: MILK_RETRY }));
        rerender(listWith({ failed, pending: new Map([['milk', USING]]) }));
        focusMoved.mockClear();
        rerender(listWith({}));

        expect(focusMoved).not.toHaveBeenCalled();
    });

    it('a row with no Use moves the cursor to its Choose another', () => {
        const failed = new Set(['spice']);
        const { rerender } = render(listWith({ failed }));

        fireEvent.click(screen.getByRole('button', { name: 'Try again to save the choice for 1 tsp mixed spice' }));
        focusMoved.mockClear();
        rerender(listWith({ failed, pending: new Map([['spice', USING]]) }));

        expect(focusMoved).toHaveBeenCalledExactlyOnceWith(
            screen.getByRole('button', { name: 'Choose another food for 1 tsp mixed spice' }),
            'focus',
        );
    });

    it('a first failure does not move the cursor', () => {
        const { rerender } = render(listWith({ pending: new Map([['milk', USING]]) }));

        focusMoved.mockClear();
        rerender(listWith({ failed: new Set(['milk']) }));

        expect(focusMoved).not.toHaveBeenCalled();
    });
});

/**
 * Focus after a Use SAVES, native (host gap rule 3, WCAG 2.4.3): the saved row leaves and its Use unmounts with it, so the
 * screen-reader cursor goes where the host says (`flaggedFocusAfterSave`): the next row's landing control, or the heading.
 */
describe('ImportFlaggedList (native): the cursor after a Use saves (WCAG 2.4.3)', () => {
    const LINES = [
        {
            key: 'milk',
            text: '1 1/4 cups milk',
            recipeTitle: 'Pancakes',
            matchedFood: 'milk crackers',
            suggestion: { foodId: 'f-whole', name: 'Whole milk' },
        },
        { key: 'spice', text: '1 tsp mixed spice', recipeTitle: 'Hot cross buns', matchedFood: 'Spice cake' },
    ];

    const listWith = (props: Partial<ImportFlaggedListProps>) => (
        <ImportFlaggedList
            total={2}
            lines={LINES}
            pending={new Map()}
            failed={new Set()}
            announcement={{ text: '', occurrence: 0 }}
            onUseSuggestion={vi.fn()}
            onChooseAnother={vi.fn()}
            onRetry={vi.fn()}
            {...props}
        />
    );

    it('⛔ moves the cursor to the next row’s Use and reports it handled once', () => {
        const onHandled = vi.fn();

        focusMoved.mockClear();
        render(listWith({ rowFocus: { key: 'milk', landing: 'use', onHandled } }));

        expect(focusMoved).toHaveBeenCalledExactlyOnceWith(
            screen.getByRole('button', { name: 'Use Whole milk for 1 1/4 cups milk' }),
            'focus',
        );
        expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('⛔ moves the cursor to Choose another for a row with no Use', () => {
        focusMoved.mockClear();
        render(listWith({ rowFocus: { key: 'spice', landing: 'chooseAnother', onHandled: vi.fn() } }));

        expect(focusMoved).toHaveBeenCalledExactlyOnceWith(
            screen.getByRole('button', { name: 'Choose another food for 1 tsp mixed spice' }),
            'focus',
        );
    });

    it('moves the cursor nowhere when the host asked for nothing', () => {
        focusMoved.mockClear();
        render(listWith({}));

        expect(focusMoved).not.toHaveBeenCalled();
    });

    it('⛔ moves the cursor to the heading when no row is left', () => {
        const { rerender } = render(listWith({ total: 0, lines: [], headingFocusSignal: 0 }));

        focusMoved.mockClear();
        rerender(listWith({ total: 0, lines: [], headingFocusSignal: 1 }));

        expect(focusMoved).toHaveBeenCalledExactlyOnceWith(
            screen.getByRole('heading', { name: '0 to check' }),
            'focus',
        );
    });
});
