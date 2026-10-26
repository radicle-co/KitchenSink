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
import type { LinePick, MatchLine } from '../matchLine.js';
import { choiceListViewOf } from '../matchLineView.js';
import { matchLineMessages } from '../messages.js';

const copy = { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails };
const SKIM = MILKS[0] ?? MILKS[1];

afterEach(() => {
    cleanup();
    focus.moved.mockClear();
});

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

const names = (): (string | null)[] => screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));

describe('FoodChoiceList (native)', () => {
    it('Search first, then the options in the server’s order, then Keep as written last', () => {
        renderList(makeDefaultLine());

        expect(names()).toEqual([
            'Search for a food for 2 cups milk',
            'Skim milk',
            'Whole milk, Default',
            'Oat milk, unsweetened',
            'Keep “2 cups milk” as written',
        ]);
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

    it('a food’s parts are drawn, and Keep as written’s hint follows it', () => {
        renderList(makeDefaultLine());

        expect(screen.getByRole('button', { name: 'Oat milk, unsweetened' }).textContent).toContain('unsweetened');
        expect(screen.getByText('No nutrition for this line')).toBeTruthy();
    });

    it('pressing a food sends its pick; Keep as written sends the keep pick', () => {
        const { onPick } = renderList(makeDefaultLine());

        fireEvent.click(screen.getByRole('button', { name: 'Whole milk, Default' }));
        fireEvent.click(screen.getByRole('button', { name: 'Keep “2 cups milk” as written' }));

        expect(onPick.mock.calls).toEqual([
            [{ kind: 'food', foodId: 'whole', name: 'Whole milk' }],
            [{ kind: 'asWritten' }],
        ]);
    });

    it('⛔ ArrowUp and ArrowDown never pick (a hardware keyboard on a tablet): moving through the list chooses nothing', () => {
        const { onPick } = renderList(makeDefaultLine());
        const skim = screen.getByRole('button', { name: 'Skim milk' });

        skim.focus();
        fireEvent.keyDown(skim, { key: 'ArrowDown' });
        fireEvent.keyDown(skim, { key: 'ArrowUp' });
        fireEvent.keyDown(screen.getByRole('button', { name: 'Whole milk, Default' }), { key: 'ArrowDown' });

        expect(onPick).not.toHaveBeenCalled();
    });

    it('a reopened line says the food it holds is chosen, in its name, and draws a check', () => {
        renderList(makeDefaultLine({ binding: cookPicked(SKIM) }));

        const held = screen.getByRole('button', { name: 'Skim milk, chosen' });

        expect(held.querySelector('[data-icon-name="check"]')).not.toBeNull();
        expect(held.getAttribute('aria-selected')).toBeNull();
    });

    it('⛔ a pick in flight: its row reads busy, and no row sends a second pick', () => {
        const { onPick } = renderList(makeDefaultLine(), {
            pending: { kind: 'food', foodId: 'skim', name: 'Skim milk' },
        });

        const skim = screen.getByRole('button', { name: 'Skim milk' });

        expect(skim.getAttribute('aria-busy')).toBe('true');
        expect(skim.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'Whole milk, Default' }).getAttribute('aria-disabled')).toBe('true');

        fireEvent.click(skim);
        fireEvent.click(screen.getByRole('button', { name: 'Whole milk, Default' }));
        fireEvent.click(screen.getByRole('button', { name: 'Keep “2 cups milk” as written' }));

        expect(onPick).not.toHaveBeenCalled();
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
            'Keep “1 tsp Grandma’s spice mix” as written',
        ]);
    });

    it('a focus request moves the screen reader to Search, and is acknowledged', () => {
        const { onHandled } = renderList(makeDefaultLine(), { focusRequested: true });

        expect(focus.moved).toHaveBeenCalledTimes(1);
        expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('the group of options is named for its line', () => {
        renderList(makeDefaultLine());

        expect(screen.getByLabelText('Food for 2 cups milk')).toBeTruthy();
    });

    it('each option keeps the native touch floor', () => {
        renderList(makeDefaultLine());

        expect(getComputedStyle(screen.getByRole('button', { name: 'Skim milk' })).minHeight).toBe(
            `${String(nativeTokens.touchTarget)}px`,
        );
    });
});
