// @vitest-environment jsdom
/**
 * Component tests for the web `FoodChoiceList`, the ONE list a line's foods are chosen from in both flows: the paste
 * line, the import wizard's open line, and a flagged line's sheet and pane
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`; staff-ux rulings 2026-10-25 that each option
 * is a button, never a radio, and arrow keys never pick).
 *
 * REWRITTEN when the paste and import builds were reconciled (it was the editor builder's `form/FoodChoiceList`):
 * - a press sends the row's PICK (`onPick`), food or keep, instead of two callbacks keyed by id;
 * - "Keep … as written" is a `quiet` Button, its hint after it;
 * - the focus request is the house `ControlFocus`, not two loose props;
 * - a chosen food says ", chosen" in its name and draws a check, and carries NO `aria-current` (staff-ux: both would
 *   say the state twice, and `aria-current` means "you are here", not "picked");
 * - NEW: arrow keys never call `onPick`; a pick in flight reads busy and every row refuses a second press; a bound
 *   default keeps its tag; rows are 48 px and wrap.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { recipeMessages } from '../../messages.js';
import { cookPicked, makeDefaultLine, makeNoMatchLine, MILKS } from '../__fixtures__/matchLines.js';
import { FoodChoiceList } from '../FoodChoiceList.js';
import type { LinePick, MatchLine } from '../matchLine.js';
import { choiceListViewOf } from '../matchLineView.js';
import { matchLineMessages } from '../messages.js';

const copy = { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails };
const SKIM = MILKS[0] ?? MILKS[1];

afterEach(cleanup);

function renderList(line: MatchLine, options: { online?: boolean; pending?: LinePick; focusRequested?: boolean } = {}) {
    const handlers = { onSearch: vi.fn(), onPick: vi.fn(), onHandled: vi.fn() };

    render(
        <FoodChoiceList
            view={choiceListViewOf(line, { online: options.online ?? true, pending: options.pending }, copy)}
            onSearch={handlers.onSearch}
            onPick={handlers.onPick}
            searchFocus={{ requested: options.focusRequested ?? false, onHandled: handlers.onHandled }}
        />,
    );

    return handlers;
}

const list = () => screen.getByRole('list', { name: 'Food for 2 cups milk' });

describe('FoodChoiceList (web)', () => {
    it('Search for a food comes first, named for its line, and asks for search', async () => {
        const user = userEvent.setup();
        const { onSearch, onPick } = renderList(makeDefaultLine());

        const [first] = screen.getAllByRole('button');

        expect(first).toBe(screen.getByRole('button', { name: 'Search for a food for 2 cups milk' }));

        await user.click(screen.getByRole('button', { name: 'Search for a food for 2 cups milk' }));
        expect(onSearch).toHaveBeenCalledTimes(1);
        expect(onPick).not.toHaveBeenCalled();
    });

    it('then the options in the server’s order, then Keep as written last, in the same list', () => {
        renderList(makeDefaultLine());

        expect(
            within(list())
                .getAllByRole('button')
                .map((option) => option.getAttribute('aria-label')),
        ).toEqual(['Skim milk', 'Whole milk, Default', 'Oat milk, unsweetened', 'Keep “2 cups milk” as written']);
    });

    it('the options are buttons, never radios', () => {
        renderList(makeDefaultLine());

        expect(screen.queryByRole('radio')).toBeNull();
        expect(screen.queryByRole('radiogroup')).toBeNull();
    });

    it('the default shows its Default tag, and no other food does', () => {
        renderList(makeDefaultLine());

        expect(within(screen.getByRole('button', { name: 'Whole milk, Default' })).getByText('Default')).toBeTruthy();
        expect(within(screen.getByRole('button', { name: 'Skim milk' })).queryByText('Default')).toBeNull();
    });

    it('⛔ nothing is marked chosen while the line holds no pick, the default included', () => {
        renderList(makeDefaultLine());

        expect(screen.queryByRole('button', { name: /, chosen$/ })).toBeNull();
        expect(document.querySelector('svg.lucide-check')).toBeNull();
    });

    it('a food’s parts are drawn under its name, in the 13 px list role', () => {
        renderList(makeDefaultLine());

        const oat = screen.getByRole('button', { name: 'Oat milk, unsweetened' });

        expect(within(oat).getByText('unsweetened')).toBeTruthy();
        expect(within(oat).getByText('Oat milk').className).toContain('text-list');
    });

    it('Keep as written is the quiet tier, its hint after it', () => {
        renderList(makeDefaultLine());

        const keep = screen.getByRole('button', { name: 'Keep “2 cups milk” as written' });

        expect(keep.className).toContain('text-ink-muted');
        expect(within(list()).getByText('No nutrition for this line')).toBeTruthy();
    });

    it('pressing a food sends its pick', async () => {
        const user = userEvent.setup();
        const { onPick } = renderList(makeDefaultLine());

        await user.click(screen.getByRole('button', { name: 'Whole milk, Default' }));

        expect(onPick).toHaveBeenCalledExactlyOnceWith({ kind: 'food', foodId: 'whole', name: 'Whole milk' });
    });

    it('pressing Keep as written keeps the line, and chooses no food', async () => {
        const user = userEvent.setup();
        const { onPick } = renderList(makeDefaultLine());

        await user.click(screen.getByRole('button', { name: 'Keep “2 cups milk” as written' }));

        expect(onPick).toHaveBeenCalledExactlyOnceWith({ kind: 'asWritten' });
    });

    it('the options are buttons the keyboard reaches with Tab, and Enter picks', async () => {
        const user = userEvent.setup();
        const { onPick } = renderList(makeDefaultLine());

        await user.tab();
        await user.tab();
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Whole milk, Default' }));

        await user.keyboard('{Enter}');
        expect(onPick).toHaveBeenCalledExactlyOnceWith({ kind: 'food', foodId: 'whole', name: 'Whole milk' });
    });

    it('⛔ ArrowUp and ArrowDown never pick: moving through the list chooses nothing', async () => {
        const user = userEvent.setup();
        const { onPick } = renderList(makeDefaultLine());

        await user.tab();
        await user.tab();
        await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{ArrowDown}');

        expect(onPick).not.toHaveBeenCalled();
    });

    it('a reopened line says the food it holds is chosen, in its name, and draws a check', () => {
        renderList(makeDefaultLine({ binding: cookPicked(SKIM) }));

        const held = screen.getByRole('button', { name: 'Skim milk, chosen' });

        expect(held.querySelector('svg.lucide-check')).not.toBeNull();
        expect(held.hasAttribute('aria-current')).toBe(false);
        expect(
            screen.getByRole('button', { name: 'Whole milk, Default' }).querySelector('svg.lucide-check'),
        ).toBeNull();
    });

    it('a default the server bound, reopened, shows its tag and is the chosen food', () => {
        renderList(
            makeDefaultLine({
                binding: { boundBy: 'server', pick: { kind: 'food', foodId: 'whole', name: 'Whole milk' } },
            }),
        );

        const held = screen.getByRole('button', { name: 'Whole milk, Default, chosen' });

        expect(within(held).getByText('Default')).toBeTruthy();
    });

    it('⛔ a pick in flight: its row reads busy, and no row sends a second pick', async () => {
        const user = userEvent.setup();
        const { onPick } = renderList(makeDefaultLine(), {
            pending: { kind: 'food', foodId: 'skim', name: 'Skim milk' },
        });

        const skim = screen.getByRole('button', { name: 'Skim milk' });

        expect(skim.getAttribute('aria-busy')).toBe('true');
        expect(skim.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'Whole milk, Default' }).getAttribute('aria-disabled')).toBe('true');

        await user.click(skim);
        await user.click(screen.getByRole('button', { name: 'Whole milk, Default' }));
        await user.click(screen.getByRole('button', { name: 'Keep “2 cups milk” as written' }));

        expect(onPick).not.toHaveBeenCalled();
    });

    it('offline: no search control, the words say search needs the network, and the options still pick', async () => {
        const user = userEvent.setup();
        const { onPick } = renderList(makeDefaultLine(), { online: false });

        expect(screen.queryByRole('button', { name: /^Search for a food/ })).toBeNull();
        expect(screen.getByText('Search needs the network')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Skim milk' }));
        expect(onPick).toHaveBeenCalledExactlyOnceWith({ kind: 'food', foodId: 'skim', name: 'Skim milk' });
    });

    it('no match: search, then Keep as written, and no food', () => {
        renderList(makeNoMatchLine({ line: { measure: '1 tsp', words: 'Grandma’s spice mix' } }));

        expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
            'Search for a food for 1 tsp Grandma’s spice mix',
            'Keep “1 tsp Grandma’s spice mix” as written',
        ]);
    });

    it('a focus request moves focus to Search, and is acknowledged', () => {
        const { onHandled } = renderList(makeDefaultLine(), { focusRequested: true });

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Search for a food for 2 cups milk' }));
        expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('rows are 48 px tall and their words wrap, so nothing scrolls sideways at 320 px', () => {
        renderList(makeDefaultLine());

        const row = screen.getByRole('button', { name: 'Skim milk' });

        expect(row.className).toContain('min-h-12');
        expect(row.className).toContain('w-full');
        expect(within(row).getByText('Skim milk').className).toContain('break-words');
    });
});
