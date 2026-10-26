// @vitest-environment jsdom
/**
 * Component tests for the web `ImportLineList` (board WizardStep; `ingredientMatching.md` line states): one open line
 * expanded at a time with its NEUTRAL prompt and its option list, every other open line closed and naming its need,
 * matched lines with Change, a checking line with Use this and Search in one tap, a cook's pick marked "your choice",
 * and a late check result that keeps the pick and adds one quiet sentence. Every state, every action.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
    makeCheckingLine,
    makeConfidentLine,
    makeDefaultLine,
    makeNeedsChoiceLine,
    makeNoMatchLine,
} from '../__fixtures__/importLines.js';
import type { ImportLine } from '../importLine.js';
import { ImportLineList } from '../ImportLineList.js';
import { importMessages } from '../messages.js';

const m = importMessages.en.line;
const w = importMessages.en.wizard;

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

const itemOf = (text: string) =>
    screen.getAllByRole('listitem').find((item) => item.textContent?.includes(text)) as HTMLElement;

describe('ImportLineList (web) — the expanded line', () => {
    it('a default line: its text, the neutral prompt, Search first, the options with nothing chosen', () => {
        renderList([makeDefaultLine()], 'flour');

        const item = itemOf('275 g flour');
        const prompt = within(item).getByText('Choose the flour you use');

        expect(prompt.className).toContain('text-ink-muted');
        expect(prompt.className).not.toContain('attention');
        expect(within(item).getByRole('button', { name: 'Search for a food for 275 g flour' })).toBeTruthy();
        expect(within(item).getByRole('radio', { name: 'All-purpose flour Default' })).toBeTruthy();
        expect(within(item).queryByRole('radio', { checked: true })).toBeNull();
    });

    it('a needsChoice line says more than one food fits; a noMatch line offers only search and keep', () => {
        renderList([makeNeedsChoiceLine()], 'bread');
        expect(screen.getByText(m.needsChoicePrompt)).toBeTruthy();
        cleanup();

        renderList([makeNoMatchLine()], 'syrup');
        expect(screen.getByText(m.noMatchPrompt)).toBeTruthy();
        expect(screen.getAllByRole('radio')).toEqual([
            screen.getByRole('radio', { name: 'Keep “4 tbsp drizzle syrup” as written' }),
        ]);
        expect(screen.getByRole('button', { name: 'Search for a food for 4 tbsp drizzle syrup' })).toBeTruthy();
    });

    it('reports a pick and a search for the expanded line by its key', async () => {
        const user = userEvent.setup();
        const { onPick, onSearch } = renderList([makeDefaultLine()], 'flour');

        await user.click(screen.getByRole('radio', { name: 'Self-raising flour' }));
        await user.click(screen.getByRole('button', { name: 'Search for a food for 275 g flour' }));

        expect(onPick).toHaveBeenCalledWith('flour', { kind: 'food', foodId: 'f-sr', name: 'Self-raising flour' });
        expect(onSearch).toHaveBeenCalledWith('flour');
    });

    it('a line re-opened after a pick shows that pick checked', () => {
        renderList(
            [makeDefaultLine({ choice: { pick: { kind: 'food', foodId: 'f-cake', name: 'Cake flour' } } })],
            'flour',
        );

        expect(screen.getByRole('radio', { checked: true })).toBe(screen.getByRole('radio', { name: 'Cake flour' }));
    });

    it('a matched line opened by Change offers its candidates with no prompt', () => {
        renderList(
            [makeConfidentLine({ candidates: [{ id: 'b-s', name: 'Butter, salted', isDefault: false }] })],
            'butter',
        );

        expect(screen.getByRole('radio', { name: 'Butter, salted' })).toBeTruthy();
        expect(screen.queryByText(m.needsChoicePrompt)).toBeNull();
    });

    it('⛔ a checking line is never drawn expanded, even when asked', () => {
        renderList([makeCheckingLine()], 'lemons');

        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.getByRole('button', { name: /^Use this/u })).toBeTruthy();
    });
});

describe('ImportLineList (web) — closed lines', () => {
    it.each([
        [makeDefaultLine(), '275 g flour', 'Choose the flour you use · 3 options'],
        [makeNeedsChoiceLine(), '6 slices day-old bread', 'Choose a food · 2 options'],
        [makeNoMatchLine(), '4 tbsp drizzle syrup', m.closedNoMatch],
    ])('an open line waiting its turn is one button naming its need: %#', async (line, text, need) => {
        const user = userEvent.setup();
        const { onExpand } = renderList([line]);

        const row = screen.getByRole('button', { name: `${text} ${need}` });

        expect(row.className).toContain('min-h-12');

        await user.click(row);

        expect(onExpand).toHaveBeenCalledWith(line.key);
    });

    it('a matched line shows its food and a Change named for the line', async () => {
        const user = userEvent.setup();
        const { onExpand } = renderList([makeConfidentLine()]);

        expect(within(itemOf('225 g butter')).getByText('Butter, unsalted')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Change the food for 225 g butter, softened' }));

        expect(onExpand).toHaveBeenCalledWith('butter');
    });

    it('a checking line shows its proposal with Checking, Use this and Search for a food, each in one tap', async () => {
        const user = userEvent.setup();
        const { onUseProposal, onSearch } = renderList([makeCheckingLine()]);

        const item = itemOf('2 lemons');

        expect(within(item).getByText('Lemon peel, raw')).toBeTruthy();
        expect(within(item).getByText(m.checkingTag)).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Use this: Lemon peel, raw for 2 lemons, zest only' }));
        await user.click(screen.getByRole('button', { name: 'Search for a food for 2 lemons, zest only' }));

        expect(onUseProposal).toHaveBeenCalledWith('lemons');
        expect(onSearch).toHaveBeenCalledWith('lemons');
    });

    it('⛔ nothing on a checking line moves: no element asks for an animation', () => {
        renderList([makeCheckingLine()]);

        expect(document.querySelector('[class*="animate-"]')).toBeNull();
    });

    it('a cook’s pick shows the food marked “your choice”, and Change', () => {
        renderList([
            makeDefaultLine({ choice: { pick: { kind: 'food', foodId: 'f-sr', name: 'Self-raising flour' } } }),
        ]);

        const item = itemOf('275 g flour');

        expect(item.textContent).toContain('Self-raising flour');
        expect(item.textContent).toContain(m.yourChoice);
        expect(within(item).getByRole('button', { name: 'Change the food for 275 g flour' })).toBeTruthy();
    });

    it('a line the cook kept as written says so, marked “your choice”', () => {
        renderList([makeNoMatchLine({ choice: { pick: { kind: 'asWritten' } } })]);

        const item = itemOf('4 tbsp drizzle syrup');

        expect(item.textContent).toContain(m.keptAsWritten);
        expect(item.textContent).toContain(m.yourChoice);
    });

    it('⛔ a late check result keeps the cook’s pick and adds one quiet sentence with See why', async () => {
        const user = userEvent.setup();
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

        const item = itemOf('3 tbsp butter, melted');
        const note = within(item).getByText('Our check suggested Butter, salted. Your choice stays.');

        expect(item.textContent).toContain('Butter, unsalted');
        expect(note.className).toContain('text-ink-muted');

        await user.click(
            screen.getByRole('button', {
                name: 'See why our check suggested Butter, salted for 3 tbsp butter, melted',
            }),
        );

        expect(onSeeWhy).toHaveBeenCalledWith('melted');
    });
});

describe('ImportLineList (web) — the list', () => {
    it('is a list of the recipe’s lines in order, one expanded', () => {
        renderList([makeConfidentLine(), makeDefaultLine(), makeCheckingLine(), makeNoMatchLine()], 'flour');

        const items = screen.getAllByRole('listitem');

        expect(items.map((item) => item.textContent?.slice(0, 12))).toEqual([
            '225 g butter',
            '275 g flourC',
            '2 lemons, ze',
            '4 tbsp drizz',
        ]);
        expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
    });

    it('a recipe whose every line is matched says there is nothing to fix', () => {
        renderList([
            makeConfidentLine(),
            makeConfidentLine({ key: 'sugar', text: '225 g caster sugar', food: 'Caster sugar' }),
        ]);

        expect(screen.getByText(w.nothingToFix.other.replace('{count}', '2'))).toBeTruthy();
    });

    it('says nothing of the kind while a line is still open', () => {
        renderList([makeConfidentLine(), makeDefaultLine()]);

        expect(screen.queryByText(/ingredients are matched/u)).toBeNull();
    });
});
