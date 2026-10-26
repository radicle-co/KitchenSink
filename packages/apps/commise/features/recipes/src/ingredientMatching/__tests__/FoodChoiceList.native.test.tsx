/**
 * Component tests for the native `FoodChoiceList` (the React Native leaf, rendered through react-native-web): the same
 * promises as the web leaf, in the native idiom. Each option is a `button` (VoiceOver and TalkBack read a radio as "not
 * selected", implying a confirm step that does not exist); Search comes first and Keep as written last; offline search
 * says it needs the network.
 *
 * REWRITTEN when the paste and import builds were reconciled (it was the editor builder's `form/FoodChoiceList`): a
 * press sends the row's pick (`onPick`); Keep as written is the `quiet` Button with its hint after it; the focus request
 * is the house `ControlFocus`; the held food says ", chosen" in its name and draws a check, with NO `selected` state
 * (staff-ux 2026-10-25: both would say it twice). NEW: a pick in flight reads busy and every row refuses a second
 * press; rows keep the native touch floor (`nativeTokens.touchTarget`).
 *
 * REWRITTEN for the UI fix pass (2026-10-25), each case seen red first: the options and Keep sit in ONE bordered box
 * whose group is a named `list` (U2, U12); Keep is ONE string with "no nutrition" (U6); a busy row spins and every
 * refused row is dimmed (H2); a pick made through Search reads busy on Search (M2); the focus request (`focus`) lands
 * on the first option offline (H1). DELETED: the ArrowUp/ArrowDown case (L6). It could not fail: a React Native
 * `Pressable` has no arrow-key binding at all, so no change to this leaf could make an arrow pick. The rule is pinned
 * where it can break, on web (`FoodChoiceList.test.tsx`, `ChoiceRow.test.tsx`), and native rows are never radios.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { nativeTokens } from '@commise/ui/native';

const focus = vi.hoisted(() => ({ moved: vi.fn() }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: focus.moved } };
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { FoodChoiceList } from '../FoodChoiceList.native.js';
import { recipeMessages } from '../../messages.js';
import { cookPicked, makeDefaultLine, makeNoMatchLine, MILKS } from '../__fixtures__/matchLines.js';
import type { MatchLine, PendingSend } from '../matchLine.js';
import { choiceListViewOf } from '../matchLineView.js';
import { matchLineMessages } from '../messages.js';

const copy = { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails };
const SKIM = MILKS[0] ?? MILKS[1];

afterEach(() => {
    cleanup();
    focus.moved.mockClear();
});

const KEEP_MILK = 'Keep “2 cups milk” as written\u00A0· no nutrition';
const SKIM_PENDING: PendingSend = { kind: 'pick', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } };

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
            landing={{ requested: false, onHandled: vi.fn() }}
        />,
    );

    return handlers;
}

const names = (): (string | null)[] => screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));

describe('FoodChoiceList (native)', () => {
    it('Search first, then the options in the server’s order, then Keep as written last', () => {
        renderList(makeDefaultLine());

        expect(names()).toEqual([
            'Search for a food for 2 cups milk',
            'Skim milk',
            'Whole milk, Default',
            'Oat milk, unsweetened',
            KEEP_MILK,
        ]);
    });

    it('U2/U12: the options and Keep are ONE bordered box, a list named for its line, divided by rules', () => {
        renderList(makeDefaultLine());

        const box = screen.getByRole('list', { name: 'Food for 2 cups milk' });
        const items = Array.from(box.children) as HTMLElement[];

        expect(getComputedStyle(box).borderTopWidth).toBe('1px');
        expect(items.map((item) => item.getAttribute('role'))).toEqual([
            'listitem',
            'listitem',
            'listitem',
            'listitem',
        ]);
        expect(items.map((item) => getComputedStyle(item).borderTopWidth !== '0px')).toEqual([false, true, true, true]);
        expect(items.at(-1)?.contains(screen.getByRole('button', { name: KEEP_MILK }))).toBe(true);
    });

    it('the options are buttons, never radios', () => {
        renderList(makeDefaultLine());

        expect(screen.queryByRole('radio')).toBeNull();
    });

    it('Search asks for search', () => {
        const { onSearch } = renderList(makeDefaultLine());

        fireEvent.click(screen.getByRole('button', { name: 'Search for a food for 2 cups milk' }));

        expect(onSearch).toHaveBeenCalledTimes(1);
    });

    it('the default shows its Default tag, and no other food does', () => {
        renderList(makeDefaultLine());

        expect(screen.getByRole('button', { name: 'Whole milk, Default' }).textContent).toContain('Default');
        expect(screen.getByRole('button', { name: 'Skim milk' }).textContent).toBe('Skim milk');
    });

    it('⛔ nothing is marked chosen while the line holds no pick, the default included', () => {
        renderList(makeDefaultLine());

        expect(screen.queryByRole('button', { name: /, chosen$/ })).toBeNull();
        expect(document.querySelector('[data-icon-name="check"]')).toBeNull();
    });

    it('U6: a food’s parts are drawn; Keep as written is ONE string in the 14 px list role, with no separate hint', () => {
        renderList(makeDefaultLine());

        expect(screen.getByRole('button', { name: 'Oat milk, unsweetened' }).textContent).toContain('unsweetened');
        expect(screen.queryByText('No nutrition for this line')).toBeNull();
        expect(getComputedStyle(screen.getByText(KEEP_MILK, { normalizer: (text) => text })).fontSize).toBe(
            `${String(nativeTokens.type.list.fontSize)}px`,
        );
    });

    it('pressing a food sends its pick; Keep as written sends the keep pick', () => {
        const { onPick } = renderList(makeDefaultLine());

        fireEvent.click(screen.getByRole('button', { name: 'Whole milk, Default' }));
        fireEvent.click(screen.getByRole('button', { name: KEEP_MILK }));

        expect(onPick.mock.calls).toEqual([
            [{ kind: 'food', foodId: 'whole', name: 'Whole milk' }],
            [{ kind: 'asWritten' }],
        ]);
    });

    it('a reopened line says the food it holds is chosen, in its name, and draws a check', () => {
        renderList(makeDefaultLine({ binding: cookPicked(SKIM) }));

        const held = screen.getByRole('button', { name: 'Skim milk, chosen' });

        expect(held.querySelector('[data-icon-name="check"]')).not.toBeNull();
        expect(held.getAttribute('aria-selected')).toBeNull();
    });

    it('⛔ H2: a pick in flight spins on its row, reads busy, dims every row, and nothing sends a second pick', () => {
        const { onPick, onSearch } = renderList(makeDefaultLine(), { pending: SKIM_PENDING });

        const skim = screen.getByRole('button', { name: 'Skim milk' });
        const whole = screen.getByRole('button', { name: 'Whole milk, Default' });
        const search = screen.getByRole('button', { name: 'Search for a food for 2 cups milk' });

        expect(skim.getAttribute('aria-busy')).toBe('true');
        expect(skim.querySelector('[role="progressbar"]')).not.toBeNull();
        expect(whole.getAttribute('aria-disabled')).toBe('true');
        expect(getComputedStyle(whole).opacity).toBe('0.6');
        expect(search.getAttribute('aria-disabled')).toBe('true');

        fireEvent.click(skim);
        fireEvent.click(whole);
        fireEvent.click(screen.getByRole('button', { name: KEEP_MILK }));
        fireEvent.click(search);

        expect(onPick).not.toHaveBeenCalled();
        expect(onSearch).not.toHaveBeenCalled();
    });

    it('⛔ M2: a pick made through Search reads busy on Search; no row is busy', () => {
        renderList(makeDefaultLine(), { pending: { kind: 'searchPick' } });

        expect(
            screen.getByRole('button', { name: 'Search for a food for 2 cups milk' }).getAttribute('aria-busy'),
        ).toBe('true');
        expect(screen.getByRole('button', { name: 'Skim milk' }).getAttribute('aria-busy')).not.toBe('true');
        expect(screen.getByRole('button', { name: 'Skim milk' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('offline: no search control, the words say search needs the network, and the options still pick', () => {
        const { onPick } = renderList(makeDefaultLine(), { online: false });

        expect(screen.queryByRole('button', { name: /^Search for a food/ })).toBeNull();
        expect(screen.getByText('Search needs the network')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Skim milk' }));
        expect(onPick).toHaveBeenCalledExactlyOnceWith({ kind: 'food', foodId: 'skim', name: 'Skim milk' });
    });

    it('no match: search, then Keep as written, and no food', () => {
        renderList(makeNoMatchLine({ line: { measure: '1 tsp', words: 'Grandma’s spice mix' } }));

        expect(names()).toEqual([
            'Search for a food for 1 tsp Grandma’s spice mix',
            'Keep “1 tsp Grandma’s spice mix” as written\u00A0· no nutrition',
        ]);
    });

    it('a focus request moves the screen reader to Search, and is acknowledged', () => {
        const { onHandled } = renderList(makeDefaultLine(), { focusRequested: true });

        expect(focus.moved).toHaveBeenCalledExactlyOnceWith(
            screen.getByRole('button', { name: 'Search for a food for 2 cups milk' }),
            'focus',
        );
        expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('⛔ H1: offline, a focus request moves the screen reader to the first option, and is acknowledged', () => {
        const { onHandled } = renderList(makeDefaultLine(), { online: false, focusRequested: true });

        expect(focus.moved).toHaveBeenCalledExactlyOnceWith(screen.getByRole('button', { name: 'Skim milk' }), 'focus');
        expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('⛔ H1: offline with no options, a focus request moves to Keep as written, and is acknowledged', () => {
        const { onHandled } = renderList(makeNoMatchLine(), { online: false, focusRequested: true });

        expect(focus.moved).toHaveBeenCalledExactlyOnceWith(
            screen.getByRole('button', { name: 'Keep “1 tsp spice mix” as written\u00A0· no nutrition' }),
            'focus',
        );
        expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('each option keeps the native touch floor', () => {
        renderList(makeDefaultLine());

        expect(getComputedStyle(screen.getByRole('button', { name: 'Skim milk' })).minHeight).toBe(
            `${String(nativeTokens.touchTarget)}px`,
        );
    });
});
