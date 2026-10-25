// @vitest-environment jsdom
/**
 * Component tests for the web `ImportLineOptionsSheet` and `ImportLineOptionsPane` (board FlaggedLine): a flagged line's
 * options — the same list in a sheet below the wide class and in a pane beside the list at it — titled with the line and
 * its recipe, "Search for a food" first, the default tagged and never chosen.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ImportCandidate } from '../importLine.js';
import { ImportLineOptionsPane } from '../ImportLineOptionsPane.js';
import { ImportLineOptionsSheet } from '../ImportLineOptionsSheet.js';

const LINE = '1 1/4 cups milk';
const MILK: readonly ImportCandidate[] = [
    { id: 'f-whole', name: 'Whole milk', isDefault: true },
    { id: 'f-2', name: 'Milk, 2% fat', isDefault: false },
    { id: 'f-crackers', name: 'Milk crackers', isDefault: false },
];

afterEach(cleanup);

function renderSheet(open = true) {
    const handlers = { onOpenChange: vi.fn(), onPick: vi.fn(), onSearch: vi.fn() };
    render(
        <ImportLineOptionsSheet
            open={open}
            title="1 1/4 cups milk · Pancakes"
            lineText={LINE}
            candidates={MILK}
            pick={undefined}
            {...handlers}
        />,
    );

    return handlers;
}

describe('ImportLineOptionsSheet (web)', () => {
    it('renders nothing while closed', () => {
        renderSheet(false);

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('is a dialog titled with the line and its recipe: Search first, then the options, nothing chosen', async () => {
        const user = userEvent.setup();
        const { onSearch, onPick } = renderSheet();

        const dialog = screen.getByRole('dialog', { name: '1 1/4 cups milk · Pancakes' });
        const search = within(dialog).getByRole('button', { name: `Search for a food for ${LINE}` });
        const group = within(dialog).getByRole('radiogroup', { name: `Food for ${LINE}` });

        expect(search.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(within(group).getAllByRole('radio')).toHaveLength(4);
        expect(within(group).queryByRole('radio', { checked: true })).toBeNull();

        await user.click(search);
        await user.click(within(group).getByRole('radio', { name: 'Whole milk Default' }));

        expect(onSearch).toHaveBeenCalledTimes(1);
        expect(onPick).toHaveBeenCalledWith({ kind: 'food', foodId: 'f-whole', name: 'Whole milk' });
    });

    it('closes through its close control', async () => {
        const user = userEvent.setup();
        const { onOpenChange } = renderSheet();

        await user.click(screen.getByRole('button', { name: `Close options for ${LINE}` }));

        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});

describe('ImportLineOptionsPane (web)', () => {
    it('is a region headed by the line and its recipe, with the same list: Search first, nothing chosen', () => {
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

        const pane = screen.getByRole('region', { name: '1 1/4 cups milk · Pancakes' });

        expect(within(pane).getByRole('heading', { name: '1 1/4 cups milk · Pancakes' })).toBeTruthy();
        expect(within(pane).getByRole('button', { name: `Search for a food for ${LINE}` })).toBeTruthy();
        expect(within(pane).queryByRole('radio', { checked: true })).toBeNull();
        expect(within(pane).getAllByRole('radio')).toHaveLength(4);
    });
});
