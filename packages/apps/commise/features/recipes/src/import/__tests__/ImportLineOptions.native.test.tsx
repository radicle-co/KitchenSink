/**
 * Native component tests for `ImportLineOptions`, rendered through react-native-web under jsdom. Mirrors
 * `ImportLineOptions.test.tsx` over the native design-system leaves: Search for a food first, the default tagged and never chosen, Keep … as written last.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import type { ImportCandidate, ImportLinePick } from '../importLine.js';
// ONE component for both platforms: its parts (`Button`, `RadioList`) resolve to their native leaves here.
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

describe('ImportLineOptions (native)', () => {
    it('puts Search for a food first, named for its line', () => {
        const { onSearch, group } = renderOptions();

        const search = screen.getByRole('button', { name: `Search for a food for ${LINE}` });

        expect(search.textContent).toContain(m.search);
        expect(search.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        fireEvent.click(search);

        expect(onSearch).toHaveBeenCalledTimes(1);
    });

    it('lists the candidates, the default tagged, then Keep … as written, last; nothing checked', () => {
        const { group } = renderOptions();

        const radios = within(group).getAllByRole('radio');

        expect(radios.map((radio) => radio.textContent)).toEqual([
            'All-purpose flourDefault',
            'Self-raising flour',
            `Keep “${LINE}” as written${m.keepHint}`,
        ]);
        expect(within(group).queryByRole('radio', { checked: true })).toBeNull();
    });

    it('checks the picked food', () => {
        renderOptions({ kind: 'food', foodId: 'f-sr', name: 'Self-raising flour' });

        expect(screen.getByRole('radio', { checked: true }).textContent).toBe('Self-raising flour');
    });

    it('reports a chosen food, and the keep row, as picks', () => {
        const { onPick } = renderOptions();
        const radios = screen.getAllByRole('radio');

        fireEvent.click(radios[0] as HTMLElement);
        fireEvent.click(radios[2] as HTMLElement);

        expect(onPick.mock.calls).toEqual([
            [{ kind: 'food', foodId: 'f-ap', name: 'All-purpose flour' }],
            [{ kind: 'asWritten' }],
        ]);
    });
});
