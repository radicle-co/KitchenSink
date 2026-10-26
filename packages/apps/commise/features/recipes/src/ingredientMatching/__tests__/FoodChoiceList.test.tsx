// @vitest-environment jsdom
/**
 * Component tests for the web `FoodChoiceList`, the ONE list a line's foods are chosen from in both flows: the paste
 * line, the import wizard's open line, and a flagged line's sheet and pane
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`; staff-ux rulings 2026-10-25 that each option
 * is a button, never a radio, and arrow keys never pick).
 *
 * REWRITTEN for the UI fix pass (2026-10-25), each case seen red first:
 * - U2/U6: the options sit in ONE bordered box with dividers, and "Keep “line” as written · no nutrition" is its last
 *   row, ONE string in the quiet ink; it was a quiet Button with a hint after it, outside any box.
 * - U5: Search is the ghost tier at its own width, so its words start at the rows' edge.
 * - H2: a row whose pick is in flight draws a spinner and reads busy; every row is refused with the house dim.
 * - M2: a pick made through Search reads busy on Search; Search is refused (focusable) while the list refuses.
 * - H1: the focus request (`focus`, it was `searchFocus`) lands on Search, else the first option, else Keep.
 * - U1: the options are the 14 px `list` role.
 * Kept from before: a press sends the row's pick; a chosen food says ", chosen" and draws a check with no
 * `aria-current`; arrow keys never call `onPick`; rows are 48 px and wrap.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BUSY_CONTROL_CLASS } from '@commise/ui/button';

import { recipeMessages } from '../../messages.js';
import { cookPicked, makeDefaultLine, makeNoMatchLine, MILKS } from '../__fixtures__/matchLines.js';
import { FoodChoiceList } from '../FoodChoiceList.js';
import type { MatchLine, PendingSend } from '../matchLine.js';
import { choiceListViewOf } from '../matchLineView.js';
import { matchLineMessages } from '../messages.js';

const copy = { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails };
const SKIM = MILKS[0] ?? MILKS[1];
const KEEP_MILK = 'Keep “2 cups milk” as written · no nutrition';
const SKIM_PENDING: PendingSend = { kind: 'pick', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } };

afterEach(cleanup);

function renderList(
    line: MatchLine,
    options: { online?: boolean; pending?: PendingSend; focusRequested?: boolean } = {},
) {
    const handlers = { onSearch: vi.fn(), onPick: vi.fn(), onHandled: vi.fn() };

    render(
        <FoodChoiceList
            view={choiceListViewOf(line, { online: options.online ?? true, pending: options.pending }, copy)}
            onSearch={handlers.onSearch}
            onPick={handlers.onPick}
            focus={{ requested: options.focusRequested ?? false, onHandled: handlers.onHandled }}
        />,
    );

    return handlers;
}

const list = () => screen.getByRole('list', { name: 'Food for 2 cups milk' });
const search = () => screen.getByRole('button', { name: 'Search for a food for 2 cups milk' });

describe('FoodChoiceList (web)', () => {
    it('Search for a food comes first, named for its line, and asks for search', async () => {
        const user = userEvent.setup();
        const { onSearch, onPick } = renderList(makeDefaultLine());

        const [first] = screen.getAllByRole('button');

        expect(first).toBe(search());

        await user.click(search());
        expect(onSearch).toHaveBeenCalledTimes(1);
        expect(onPick).not.toHaveBeenCalled();
    });

    it('U5: Search is the ghost tier at its own width, with a leading search glyph', () => {
        renderList(makeDefaultLine());

        expect(search().className.split(' ')).not.toContain('w-full');
        expect(search().className).toContain('text-action-text');
        expect(search().querySelector('svg.lucide-search')).not.toBeNull();
    });

    it('then the options in the server’s order, then Keep as written last, in the same list', () => {
        renderList(makeDefaultLine());

        expect(
            within(list())
                .getAllByRole('button')
                .map((option) => option.getAttribute('aria-label')),
        ).toEqual(['Skim milk', 'Whole milk, Default', 'Oat milk, unsweetened', KEEP_MILK]);
    });

    it('U2: the options and Keep sit in ONE bordered box on the raised paper, divided by rules', () => {
        renderList(makeDefaultLine());

        const box = list();

        for (const utility of ['border', 'border-line-divider', 'bg-paper-raised', 'divide-y', 'divide-line-divider']) {
            expect(box.className.split(' ')).toContain(utility);
        }

        expect(within(box).getAllByRole('listitem')).toHaveLength(4);
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

    it('U1: a food is set in the 14 px list role, its parts drawn under its name', () => {
        renderList(makeDefaultLine());

        const oat = screen.getByRole('button', { name: 'Oat milk, unsweetened' });

        expect(within(oat).getByText('unsweetened')).toBeTruthy();
        expect(within(oat).getByText('Oat milk').className).toContain('text-list');
    });

    it('U6: Keep as written is ONE string in the quiet ink, the box’s last row, with no separate hint', () => {
        renderList(makeDefaultLine());

        const keep = screen.getByRole('button', { name: KEEP_MILK });
        const words = within(keep).getByText(KEEP_MILK, { normalizer: (text) => text });

        expect(words.className).toContain('text-ink-muted');
        expect(words.className).toContain('text-list');
        expect(screen.queryByText('No nutrition for this line')).toBeNull();
        expect(within(list()).getAllByRole('listitem').at(-1)?.contains(keep)).toBe(true);
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

        await user.click(screen.getByRole('button', { name: KEEP_MILK }));

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

    it('⛔ H2: a pick in flight draws a spinner on its row, reads busy, and no control sends a second pick', async () => {
        const user = userEvent.setup();
        const { onPick, onSearch } = renderList(makeDefaultLine(), { pending: SKIM_PENDING });

        const skim = screen.getByRole('button', { name: 'Skim milk' });
        const whole = screen.getByRole('button', { name: 'Whole milk, Default' });

        expect(skim.getAttribute('aria-busy')).toBe('true');
        expect(skim.querySelector('.animate-spin')).not.toBeNull();
        expect(whole.getAttribute('aria-disabled')).toBe('true');
        expect(whole.hasAttribute('aria-busy')).toBe(false);
        expect(whole.className).toContain(BUSY_CONTROL_CLASS);
        // M2: Search is refused too, and stays focusable: it is never natively disabled.
        expect(search().getAttribute('aria-disabled')).toBe('true');
        expect(search().hasAttribute('disabled')).toBe(false);

        await user.click(skim);
        await user.click(whole);
        await user.click(screen.getByRole('button', { name: KEEP_MILK }));
        await user.click(search());

        expect(onPick).not.toHaveBeenCalled();
        expect(onSearch).not.toHaveBeenCalled();
    });

    it('⛔ M2: a pick made through Search reads busy on Search, which keeps focus; no row is busy', () => {
        renderList(makeDefaultLine(), { pending: { kind: 'searchPick' } });

        search().focus();

        expect(search().getAttribute('aria-busy')).toBe('true');
        expect(search().hasAttribute('disabled')).toBe(false);
        expect(document.activeElement).toBe(search());
        expect(within(list()).queryAllByRole('button', { busy: true })).toEqual([]);
        expect(screen.getByRole('button', { name: KEEP_MILK }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: KEEP_MILK }).hasAttribute('disabled')).toBe(false);
    });

    it('offline: no search control, the words say search needs the network, and the options still pick', async () => {
        const user = userEvent.setup();
        const { onPick } = renderList(makeDefaultLine(), { online: false });

        expect(screen.queryByRole('button', { name: /^Search for a food/ })).toBeNull();
        expect(screen.getByText('Search needs the network').className).toContain('text-list');

        await user.click(screen.getByRole('button', { name: 'Skim milk' }));
        expect(onPick).toHaveBeenCalledExactlyOnceWith({ kind: 'food', foodId: 'skim', name: 'Skim milk' });
    });

    it('no match: search, then Keep as written, and no food', () => {
        renderList(makeNoMatchLine({ line: { measure: '1 tsp', words: 'Grandma’s spice mix' } }));

        expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
            'Search for a food for 1 tsp Grandma’s spice mix',
            'Keep “1 tsp Grandma’s spice mix” as written · no nutrition',
        ]);
    });

    it('a focus request moves focus to Search, and is acknowledged', () => {
        const { onHandled } = renderList(makeDefaultLine(), { focusRequested: true });

        expect(document.activeElement).toBe(search());
        expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('⛔ H1: offline, a focus request lands on the first option, and is acknowledged', () => {
        const { onHandled } = renderList(makeDefaultLine(), { online: false, focusRequested: true });

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Skim milk' }));
        expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('⛔ H1: offline with no options, a focus request lands on Keep as written, and is acknowledged', () => {
        const { onHandled } = renderList(makeNoMatchLine(), { online: false, focusRequested: true });

        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'Keep “1 tsp spice mix” as written · no nutrition' }),
        );
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
