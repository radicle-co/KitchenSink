/**
 * Native component tests for `PastedReadingRow` (plan 2026-10-15-011), rendered through react-native-web under jsdom.
 * Mirrors `PastedReadingRow.test.tsx`: every row state shows its line and its state line, and offers exactly the
 * action that state allows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { recipeFormMessages } from '../messages.js';
import { pasteRowViewOf } from '../pasteStatusCopy.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { PastedReadingRow } from '../PastedReadingRow.native.js';
import type { PasteRowState } from '../props.js';

const m = recipeFormMessages.en;
const LINE = '2 tbsp olive oil, for frying';

afterEach(cleanup);

function renderRow(state: PasteRowState) {
    const onRetryLookup = vi.fn();
    const onAddAsWritten = vi.fn();

    render(
        <PastedReadingRow
            row={{ key: 'j:3', lineIndex: 3, sourceLine: LINE, state }}
            onRetryLookup={onRetryLookup}
            onAddAsWritten={onAddAsWritten}
        />,
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

describe('PastedReadingRow (native)', () => {
    it.each(STATES)('%s: the line and its state line', (state) => {
        renderRow(state);

        expect(screen.getByText(LINE)).toBeTruthy();
        expect(screen.getByText(pasteRowViewOf(state, m).stateText)).toBeTruthy();
    });

    it.each(STATES.filter((state) => pasteRowViewOf(state, m).action === undefined))('%s offers no action', (state) => {
        renderRow(state);

        expect(screen.queryByRole('button')).toBeNull();
    });

    it.each(['stalled', 'retryable'] as const)('%s offers Add as written, named for its line', (state) => {
        const { onAddAsWritten } = renderRow(state);

        fireEvent.click(screen.getByRole('button', { name: `Add as written: ${LINE}` }));

        expect(onAddAsWritten).toHaveBeenCalledWith(3);
    });

    it('a failed lookup offers Try again, named for its line', () => {
        const { onRetryLookup } = renderRow('lookupFailed');

        fireEvent.click(screen.getByRole('button', { name: `Try again for ${LINE}` }));

        expect(onRetryLookup).toHaveBeenCalledTimes(1);
    });
});
