// @vitest-environment jsdom
/**
 * Component tests for the web `PastedReadingRow` (plan 2026-10-15-011, UX spec there): EVERY row state renders the
 * line's own text and its state line, and offers exactly the action that state allows — Add as written for a stalled or
 * retryable line, Try again for a failed lookup, nothing otherwise. The words themselves are `pasteStatusCopy.ts`'s.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { recipeFormMessages } from '../messages.js';
import { pasteRowViewOf } from '../pasteStatusCopy.js';
import { PastedReadingRow } from '../PastedReadingRow.js';
import type { PasteRowState } from '../props.js';

const m = recipeFormMessages.en;
const LINE = '2 tbsp olive oil, for frying';

afterEach(cleanup);

function renderRow(state: PasteRowState) {
    const onRetryLookup = vi.fn();
    const onAddAsWritten = vi.fn();

    render(
        <ul>
            <PastedReadingRow
                row={{ key: 'j:3', lineIndex: 3, sourceLine: LINE, state }}
                onRetryLookup={onRetryLookup}
                onAddAsWritten={onAddAsWritten}
            />
        </ul>,
    );

    return { onRetryLookup, onAddAsWritten };
}

const STATES: readonly PasteRowState[] = [
    'queued',
    'reading',
    'retrying',
    'delayed',
    'stalled',
    'retryable',
    'ready',
    'joining',
    'waiting',
    'lookupFailed',
];

describe('PastedReadingRow (web)', () => {
    it.each(STATES)('%s: a list item with the line and its state line', (state) => {
        renderRow(state);

        const item = screen.getByRole('listitem');

        expect(item.textContent).toContain(LINE);
        expect(item.textContent).toContain(pasteRowViewOf(state, m).stateText);
    });

    it.each(STATES.filter((state) => pasteRowViewOf(state, m).action === undefined))('%s offers no action', (state) => {
        renderRow(state);

        expect(screen.queryByRole('button')).toBeNull();
    });

    it.each(['stalled', 'retryable'] as const)('%s offers Add as written, named for its line', async (state) => {
        const user = userEvent.setup();
        const { onAddAsWritten, onRetryLookup } = renderRow(state);

        await user.click(screen.getByRole('button', { name: `Add as written: ${LINE}` }));

        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(onAddAsWritten).toHaveBeenCalledWith(3);
        expect(onRetryLookup).not.toHaveBeenCalled();
    });

    it('a failed lookup offers Try again, named for its line', async () => {
        const user = userEvent.setup();
        const { onRetryLookup, onAddAsWritten } = renderRow('lookupFailed');

        await user.click(screen.getByRole('button', { name: `Try again for ${LINE}` }));

        expect(onRetryLookup).toHaveBeenCalledTimes(1);
        expect(onAddAsWritten).not.toHaveBeenCalled();
    });

    it('⛔ nothing on a working row moves: no element asks for an animation', () => {
        renderRow('reading');

        expect(document.querySelector('[class*="animate-"]')).toBeNull();
    });
});
