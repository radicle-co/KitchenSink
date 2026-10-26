/**
 * Native component tests for `ImportLineOptionsSheet` and `ImportLineOptionsPane`, rendered through react-native-web
 * under jsdom. Mirrors `ImportLineOptionsSheet.test.tsx`: the phone sheet the board does not draw is the 1194 pane's list,
 * search first.
 *
 * REWRITTEN when the paste and import builds were reconciled: both draw the ONE shared `FoodChoiceList` (buttons, never
 * radios), not the import builder's radio list.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

import { makeDefaultLine, makeFoodChoice } from '../../ingredientMatching/__fixtures__/matchLines.js';
// Explicit `.native.js` — tsc and the native config's resolver both map them to the `.native.tsx` leaves.
import { ImportLineOptionsPane } from '../ImportLineOptionsPane.native.js';
import { ImportLineOptionsSheet } from '../ImportLineOptionsSheet.native.js';
import type { ImportLineOptionsPaneProps, ImportLineOptionsSheetProps } from '../props.js';

const LINE = '1 1/4 cups milk';
const MILK_LINE = makeDefaultLine({
    line: { measure: '1 1/4 cups', words: 'milk' },
    candidates: [
        makeFoodChoice({ id: 'f-whole', name: 'Whole milk', isDefault: true }),
        makeFoodChoice({ id: 'f-2', name: 'Milk, 2% fat' }),
    ],
});
const NO_FOCUS = { requested: false, onHandled: vi.fn() };

afterEach(cleanup);

function renderSheet(overrides: Partial<ImportLineOptionsSheetProps> = {}) {
    const onRetryPick = vi.fn();

    render(
        <ImportLineOptionsSheet
            open
            onOpenChange={vi.fn()}
            title="1 1/4 cups milk · Pancakes"
            line={MILK_LINE}
            online
            pending={undefined}
            failed={false}
            announcement={{ text: '', occurrence: 0 }}
            focus={NO_FOCUS}
            onPick={vi.fn()}
            onSearch={vi.fn()}
            onRetryPick={onRetryPick}
            {...overrides}
        />,
    );

    return { onRetryPick };
}

function renderPane(overrides: Partial<ImportLineOptionsPaneProps> = {}) {
    const onRetryPick = vi.fn();

    render(
        <ImportLineOptionsPane
            title="1 1/4 cups milk · Pancakes"
            line={MILK_LINE}
            online
            pending={undefined}
            failed={false}
            focus={NO_FOCUS}
            onPick={vi.fn()}
            onSearch={vi.fn()}
            onRetryPick={onRetryPick}
            {...overrides}
        />,
    );

    return { onRetryPick };
}

describe('ImportLineOptionsSheet (native)', () => {
    it('titled with the line and its recipe: Search first, the options as buttons with nothing chosen', () => {
        const onSearch = vi.fn();
        const onPick = vi.fn();

        renderSheet({ onSearch, onPick });

        expect(screen.getByText('1 1/4 cups milk · Pancakes')).toBeTruthy();

        const search = screen.getByRole('button', { name: `Search for a food for ${LINE}` });
        const whole = screen.getByRole('button', { name: 'Whole milk, Default' });

        expect(search.compareDocumentPosition(whole) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole('radio')).toBeNull();
        expect(screen.queryByRole('button', { name: /, chosen$/ })).toBeNull();

        fireEvent.click(search);
        fireEvent.click(whole);

        expect(onSearch).toHaveBeenCalledTimes(1);
        expect(onPick).toHaveBeenCalledExactlyOnceWith({ kind: 'food', foodId: 'f-whole', name: 'Whole milk' });
    });
});

describe('a pick that did not save (M6), on the sheet (native)', () => {
    it('says so above the list in the shared words, and Try again sends the pick again', () => {
        const { onRetryPick } = renderSheet({ failed: true });

        expect(screen.getByText('We couldn’t save that choice.')).toBeTruthy();

        const retry = screen.getByRole('button', { name: `Try again to save the choice for ${LINE}` });

        expect(retry.textContent).toBe('Try again');
        expect(retry.hasAttribute('disabled')).toBe(false);

        fireEvent.click(retry);

        expect(onRetryPick).toHaveBeenCalledTimes(1);
    });

    it('says nothing when nothing failed, and nothing while a retry is in flight', () => {
        renderSheet();
        expect(screen.queryByText('We couldn’t save that choice.')).toBeNull();
        cleanup();

        renderSheet({ failed: true, pending: { kind: 'searchPick' } });
        expect(screen.queryByText('We couldn’t save that choice.')).toBeNull();
    });

    it('⛔ the sheet speaks the failure itself, in its own polite region', () => {
        renderSheet({ announcement: { text: 'We couldn’t save the choice for 1 1/4 cups milk.', occurrence: 1 } });

        expect(screen.getAllByText('We couldn’t save the choice for 1 1/4 cups milk.')).toHaveLength(1);
    });
});

describe('a pick that did not save (M6), on the pane (native)', () => {
    it('says so under the heading, and Try again sends the pick again', () => {
        const { onRetryPick } = renderPane({ failed: true });

        expect(screen.getByText('We couldn’t save that choice.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: `Try again to save the choice for ${LINE}` }));

        expect(onRetryPick).toHaveBeenCalledTimes(1);
    });

    it('says nothing when nothing failed, and nothing while a retry is in flight', () => {
        renderPane();
        expect(screen.queryByText('We couldn’t save that choice.')).toBeNull();
        cleanup();

        renderPane({ failed: true, pending: { kind: 'searchPick' } });
        expect(screen.queryByText('We couldn’t save that choice.')).toBeNull();
    });
});

describe('ImportLineOptionsPane (native)', () => {
    it('heads the same list with the line and its recipe', () => {
        renderPane();

        expect(screen.getByRole('heading', { name: '1 1/4 cups milk · Pancakes' })).toBeTruthy();
        expect(screen.getByRole('button', { name: `Search for a food for ${LINE}` })).toBeTruthy();
        expect(
            screen.getByRole('button', { name: 'Keep “1 1/4 cups milk” as written\u00A0· no nutrition' }),
        ).toBeTruthy();
    });
});
