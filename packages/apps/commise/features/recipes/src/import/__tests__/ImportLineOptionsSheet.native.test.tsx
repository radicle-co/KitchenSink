/**
 * Native component tests for `ImportLineOptionsSheet` and `ImportLineOptionsPane`, rendered through react-native-web
 * under jsdom. Mirrors `ImportLineOptionsSheet.test.tsx`: the phone sheet the board does not draw is the 1194 pane's list,
 * search first.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

import type { ImportCandidate } from '../importLine.js';
// Explicit `.native.js` — tsc and the native config's resolver both map them to the `.native.tsx` leaves.
import { ImportLineOptionsPane } from '../ImportLineOptionsPane.native.js';
import { ImportLineOptionsSheet } from '../ImportLineOptionsSheet.native.js';

const LINE = '1 1/4 cups milk';
const MILK: readonly ImportCandidate[] = [
    { id: 'f-whole', name: 'Whole milk', isDefault: true },
    { id: 'f-2', name: 'Milk, 2% fat', isDefault: false },
];

afterEach(cleanup);

describe('ImportLineOptionsSheet (native)', () => {
    it('titled with the line and its recipe: Search first, the options with nothing chosen', () => {
        const onSearch = vi.fn();
        const onPick = vi.fn();
        render(
            <ImportLineOptionsSheet
                open
                onOpenChange={vi.fn()}
                title="1 1/4 cups milk · Pancakes"
                lineText={LINE}
                candidates={MILK}
                pick={undefined}
                onPick={onPick}
                onSearch={onSearch}
            />,
        );

        expect(screen.getByText('1 1/4 cups milk · Pancakes')).toBeTruthy();

        const search = screen.getByRole('button', { name: `Search for a food for ${LINE}` });
        const group = screen.getByRole('radiogroup', { name: `Food for ${LINE}` });

        expect(search.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole('radio', { checked: true })).toBeNull();

        fireEvent.click(search);
        fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);

        expect(onSearch).toHaveBeenCalledTimes(1);
        expect(onPick).toHaveBeenCalledWith({ kind: 'food', foodId: 'f-whole', name: 'Whole milk' });
    });
});

describe('ImportLineOptionsPane (native)', () => {
    it('heads the same list with the line and its recipe', () => {
        render(
            <ImportLineOptionsPane
                title="1 1/4 cups milk · Pancakes"
                lineText={LINE}
                candidates={MILK}
                pick={undefined}
                onPick={vi.fn()}
                onSearch={vi.fn()}
            />,
        );

        expect(screen.getByRole('heading', { name: '1 1/4 cups milk · Pancakes' })).toBeTruthy();
        expect(screen.getByRole('button', { name: `Search for a food for ${LINE}` })).toBeTruthy();
        expect(screen.getAllByRole('radio')).toHaveLength(3);
    });
});
