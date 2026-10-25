/**
 * Native component tests for `ImportLineList`, rendered through react-native-web under jsdom. Mirrors
 * `ImportLineList.test.tsx`: one expanded line with its prompt and options, closed open lines naming their need, matched
 * lines with Change, a checking line with Use this and Search, the cook's pick and a late result that keeps it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import {
    makeCheckingLine,
    makeConfidentLine,
    makeDefaultLine,
    makeNeedsChoiceLine,
    makeNoMatchLine,
} from '../__fixtures__/importLines.js';
import type { ImportLine } from '../importLine.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { ImportLineList } from '../ImportLineList.native.js';
import { importMessages } from '../messages.js';

const m = importMessages.en.line;

afterEach(cleanup);

function renderList(lines: readonly ImportLine[], expandedKey: string | undefined = undefined) {
    const handlers = {
        onExpand: vi.fn(),
        onPick: vi.fn(),
        onSearch: vi.fn(),
        onUseProposal: vi.fn(),
        onSeeWhy: vi.fn(),
    };
    render(<ImportLineList lines={lines} expandedKey={expandedKey} {...handlers} />);

    return handlers;
}

describe('ImportLineList (native)', () => {
    it('the expanded default line: prompt, Search first, options with nothing chosen; a pick reports by key', () => {
        const { onPick, onSearch } = renderList([makeDefaultLine()], 'flour');

        expect(screen.getByText('Choose the flour you use')).toBeTruthy();
        expect(screen.queryByRole('radio', { checked: true })).toBeNull();

        fireEvent.click(screen.getAllByRole('radio')[1] as HTMLElement);
        fireEvent.click(screen.getByRole('button', { name: 'Search for a food for 275 g flour' }));

        expect(onPick).toHaveBeenCalledWith('flour', { kind: 'food', foodId: 'f-sr', name: 'Self-raising flour' });
        expect(onSearch).toHaveBeenCalledWith('flour');
    });

    it('⛔ a checking line is never drawn expanded', () => {
        renderList([makeCheckingLine()], 'lemons');

        expect(screen.queryByRole('radiogroup')).toBeNull();
    });

    it.each([
        [makeDefaultLine(), 'Choose the flour you use · 3 options'],
        [makeNeedsChoiceLine(), 'Choose a food · 2 options'],
        [makeNoMatchLine(), m.closedNoMatch],
    ])('a closed open line is one button naming its need: %#', (line, need) => {
        const { onExpand } = renderList([line]);

        const row = screen.getByRole('button');

        expect(row.textContent).toContain(line.text);
        expect(row.textContent).toContain(need);

        fireEvent.click(row);

        expect(onExpand).toHaveBeenCalledWith(line.key);
    });

    it('a matched line shows its food and a Change named for the line', () => {
        const { onExpand } = renderList([makeConfidentLine()]);

        expect(screen.getByText('Butter, unsalted')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Change the food for 225 g butter, softened' }));

        expect(onExpand).toHaveBeenCalledWith('butter');
    });

    it('a checking line: proposal, Checking, Use this and Search for a food', () => {
        const { onUseProposal, onSearch } = renderList([makeCheckingLine()]);

        expect(screen.getByText('Lemon peel, raw')).toBeTruthy();
        expect(screen.getByText(m.checkingTag)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Use this: Lemon peel, raw for 2 lemons, zest only' }));
        fireEvent.click(screen.getByRole('button', { name: 'Search for a food for 2 lemons, zest only' }));

        expect(onUseProposal).toHaveBeenCalledWith('lemons');
        expect(onSearch).toHaveBeenCalledWith('lemons');
    });

    it('⛔ a late check result keeps the cook’s pick and adds one quiet sentence with See why', () => {
        const { onSeeWhy } = renderList([
            makeConfidentLine({
                key: 'melted',
                text: '3 tbsp butter, melted',
                choice: {
                    pick: { kind: 'food', foodId: 'b-u', name: 'Butter, unsalted' },
                    lateSuggestion: 'Butter, salted',
                },
            }),
        ]);

        expect(document.body.textContent).toContain(`Butter, unsalted · ${m.yourChoice}`);
        expect(screen.getByText('Our check suggested Butter, salted. Your choice stays.')).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'See why our check suggested Butter, salted for 3 tbsp butter, melted',
            }),
        );

        expect(onSeeWhy).toHaveBeenCalledWith('melted');
    });

    it('a line kept as written says so; a recipe of matched lines says there is nothing to fix', () => {
        renderList([makeNoMatchLine({ choice: { pick: { kind: 'asWritten' } } })]);
        expect(document.body.textContent).toContain(`${m.keptAsWritten} · ${m.yourChoice}`);
        cleanup();

        renderList([makeConfidentLine()]);
        expect(screen.getByText('The ingredient is matched. You can change it.')).toBeTruthy();
    });
});
