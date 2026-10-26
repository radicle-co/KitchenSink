// @vitest-environment jsdom
/**
 * Component tests for the web `ImportLineOptions`, the one option list the wizard's open line, the wide flagged pane and
 * the flagged sheet all show (`ingredientMatching.md`): "Search for a food" FIRST (owner ruling I1), then the
 * candidates in the server's order with the default tagged and NEVER chosen, then "Keep … as written" last.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ImportCandidate, ImportLinePick } from '../importLine.js';
import { ImportLineOptions } from '../ImportLineOptions.js';
import { importMessages } from '../messages.js';

const m = importMessages.en.line;
const LINE = '275 g flour';
const FLOUR: readonly ImportCandidate[] = [
    { id: 'f-ap', name: 'All-purpose flour', isDefault: true },
    { id: 'f-sr', name: 'Self-raising flour', isDefault: false },
];

afterEach(cleanup);

function renderOptions(pick: ImportLinePick | undefined = undefined) {
    const onPick = vi.fn();
    const onSearch = vi.fn();
    render(<ImportLineOptions lineText={LINE} candidates={FLOUR} pick={pick} onPick={onPick} onSearch={onSearch} />);

    return { onPick, onSearch, group: screen.getByRole('radiogroup', { name: `Food for ${LINE}` }) };
}

describe('ImportLineOptions (web)', () => {
    it('puts Search for a food first, named for its line, ahead of the options', async () => {
        const user = userEvent.setup();
        const { onSearch, group } = renderOptions();

        const search = screen.getByRole('button', { name: `Search for a food for ${LINE}` });

        expect(search.textContent).toContain(m.search);
        expect(search.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        await user.click(search);

        expect(onSearch).toHaveBeenCalledTimes(1);
    });

    it('lists the candidates, the default tagged, then Keep … as written with its hint, last', () => {
        const { group } = renderOptions();

        expect(within(group).getAllByRole('radio')).toEqual([
            within(group).getByRole('radio', { name: 'All-purpose flour Default' }),
            within(group).getByRole('radio', { name: 'Self-raising flour' }),
            within(group).getByRole('radio', { name: `Keep “${LINE}” as written`, description: m.keepHint }),
        ]);
    });

    it('⛔ checks nothing with no pick, though a default is listed', () => {
        const { group } = renderOptions();

        expect(within(group).queryByRole('radio', { checked: true })).toBeNull();
    });

    it('checks the picked food, or the keep row for a line kept as written', () => {
        renderOptions({ kind: 'food', foodId: 'f-sr', name: 'Self-raising flour' });
        expect(screen.getByRole('radio', { checked: true })).toBe(
            screen.getByRole('radio', { name: 'Self-raising flour' }),
        );
        cleanup();

        renderOptions({ kind: 'asWritten' });
        expect(screen.getByRole('radio', { checked: true })).toBe(
            screen.getByRole('radio', { name: `Keep “${LINE}” as written` }),
        );
    });

    it('reports a chosen food, and the keep row, as picks', async () => {
        const user = userEvent.setup();
        const { onPick } = renderOptions();

        await user.click(screen.getByRole('radio', { name: 'All-purpose flour Default' }));
        await user.click(screen.getByRole('radio', { name: `Keep “${LINE}” as written` }));

        expect(onPick.mock.calls).toEqual([
            [{ kind: 'food', foodId: 'f-ap', name: 'All-purpose flour' }],
            [{ kind: 'asWritten' }],
        ]);
    });
});
