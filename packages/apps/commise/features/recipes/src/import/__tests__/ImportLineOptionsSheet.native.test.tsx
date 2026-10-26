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

describe('ImportLineOptionsSheet (native)', () => {
    it('titled with the line and its recipe: Search first, the options as buttons with nothing chosen', () => {
        const onSearch = vi.fn();
        const onPick = vi.fn();

        render(
            <ImportLineOptionsSheet
                open
                onOpenChange={vi.fn()}
                title="1 1/4 cups milk · Pancakes"
                line={MILK_LINE}
                online
                pending={undefined}
                focus={NO_FOCUS}
                onPick={onPick}
                onSearch={onSearch}
            />,
        );

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

describe('ImportLineOptionsPane (native)', () => {
    it('heads the same list with the line and its recipe', () => {
        render(
            <ImportLineOptionsPane
                title="1 1/4 cups milk · Pancakes"
                line={MILK_LINE}
                online
                pending={undefined}
                focus={NO_FOCUS}
                onPick={vi.fn()}
                onSearch={vi.fn()}
            />,
        );

        expect(screen.getByRole('heading', { name: '1 1/4 cups milk · Pancakes' })).toBeTruthy();
        expect(screen.getByRole('button', { name: `Search for a food for ${LINE}` })).toBeTruthy();
        expect(
            screen.getByRole('button', { name: 'Keep “1 1/4 cups milk” as written\u00A0· no nutrition' }),
        ).toBeTruthy();
    });
});
