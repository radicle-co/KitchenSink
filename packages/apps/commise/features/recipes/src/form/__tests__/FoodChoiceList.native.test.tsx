/**
 * Component tests for the native `FoodChoiceList` (the React Native leaf, rendered through react-native-web): the same
 * promises as the web leaf, in the native idiom (staff-ux ruling 2026-10-25). Each option is a `button` (VoiceOver and
 * TalkBack would read a radio as "not selected", implying a confirm step that does not exist), the held food is
 * `selected`, Search comes first and Keep as written last, and offline search says it needs the network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

const focus = vi.hoisted(() => ({ moved: vi.fn() }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: focus.moved } };
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { FoodChoiceList } from '../FoodChoiceList.native.js';
import { recipeMessages } from '../../messages.js';
import { recipeFormMessages } from '../messages.js';
import type { FoodChoice, OpenLine } from '../pasteMatchLine.js';
import { pasteMatchOpenViewOf } from '../pasteMatchView.js';

const m = recipeFormMessages.en;
const copy = { ...m, details: recipeMessages.en.ingredientDetails };

afterEach(() => {
    cleanup();
    focus.moved.mockClear();
});

const MILKS: readonly FoodChoice[] = [
    { id: 'skim', name: 'Skim milk', isDefault: false },
    { id: 'whole', name: 'Whole milk', isDefault: true },
    { id: 'oat', name: 'Oat milk', isDefault: false, detailParts: ['unsweetened'] },
];

const milk = (chosenId: string | undefined = undefined): OpenLine => ({
    key: 'l1',
    line: { measure: '2 cups', words: 'milk' },
    need: { kind: 'default', noun: 'milk', options: MILKS, chosenId },
});

function renderList(line: OpenLine, options: { online?: boolean; searchFocusRequested?: boolean } = {}) {
    const handlers = {
        onSearch: vi.fn(),
        onChoose: vi.fn(),
        onKeepAsWritten: vi.fn(),
        onSearchFocusRequestHandled: vi.fn(),
    };

    render(
        <FoodChoiceList
            view={pasteMatchOpenViewOf(line, options.online ?? true, copy)}
            searchFocusRequested={options.searchFocusRequested ?? false}
            {...handlers}
        />,
    );

    return handlers;
}

const names = (): (string | null)[] => screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));

describe('FoodChoiceList (native)', () => {
    it('Search first, then the options in the server’s order, then Keep as written last', () => {
        renderList(milk());

        expect(names()).toEqual([
            'Search for a food for 2 cups milk',
            'Skim milk',
            'Whole milk, Default',
            'Oat milk, unsweetened',
            'Keep “2 cups milk” as written',
        ]);
    });

    it('Search asks for search', () => {
        const { onSearch } = renderList(milk());

        fireEvent.click(screen.getByRole('button', { name: 'Search for a food for 2 cups milk' }));

        expect(onSearch).toHaveBeenCalledTimes(1);
    });

    it('the default shows its Default tag, and no other food does', () => {
        renderList(milk());

        expect(screen.getByRole('button', { name: 'Whole milk, Default' }).textContent).toContain('Default');
        expect(screen.getByRole('button', { name: 'Skim milk' }).textContent).toBe('Skim milk');
    });

    it('⛔ nothing is selected while the line holds no pick, the default included', () => {
        renderList(milk());

        expect(screen.getAllByRole('button').some((button) => button.getAttribute('aria-selected') === 'true')).toBe(
            false,
        );
    });

    it('a food’s parts and Keep as written’s hint are drawn', () => {
        renderList(milk());

        expect(screen.getByRole('button', { name: 'Oat milk, unsweetened' }).textContent).toContain('unsweetened');
        expect(
            within(screen.getByRole('button', { name: 'Keep “2 cups milk” as written' })).getByText(
                'No nutrition for this line',
            ),
        ).toBeTruthy();
    });

    it('pressing a food chooses it by its id; Keep as written keeps the line', () => {
        const { onChoose, onKeepAsWritten } = renderList(milk());

        fireEvent.click(screen.getByRole('button', { name: 'Whole milk, Default' }));
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('whole');
        expect(onKeepAsWritten).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Keep “2 cups milk” as written' }));
        expect(onKeepAsWritten).toHaveBeenCalledTimes(1);
        expect(onChoose).toHaveBeenCalledTimes(1);
    });

    it('a reopened line marks the food it holds as selected, says so in its name, and draws a check', () => {
        renderList(milk('skim'));

        const held = screen.getByRole('button', { name: 'Skim milk, chosen' });

        expect(held.getAttribute('aria-selected')).toBe('true');
        expect(held.querySelector('[data-icon-name="check"]')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Whole milk, Default' }).getAttribute('aria-selected')).not.toBe(
            'true',
        );
    });

    it('offline: no search control, the words say search needs the network, and the options still choose', () => {
        const { onChoose } = renderList(milk(), { online: false });

        expect(screen.queryByRole('button', { name: /^Search for a food/ })).toBeNull();
        expect(screen.getByText('Search needs the network')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Skim milk' }));
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('skim');
    });

    it('no match: search, then Keep as written, and no food', () => {
        renderList({ key: 'n', line: { measure: '1 tsp', words: 'Grandma’s spice mix' }, need: { kind: 'noMatch' } });

        expect(names()).toEqual([
            'Search for a food for 1 tsp Grandma’s spice mix',
            'Keep “1 tsp Grandma’s spice mix” as written',
        ]);
    });

    it('a focus request moves the screen reader to Search, and is acknowledged', () => {
        const { onSearchFocusRequestHandled } = renderList(milk(), { searchFocusRequested: true });

        expect(focus.moved).toHaveBeenCalledTimes(1);
        expect(onSearchFocusRequestHandled).toHaveBeenCalledTimes(1);
    });

    it('the group of options is named for its line', () => {
        renderList(milk());

        expect(screen.getByLabelText('Food for 2 cups milk')).toBeTruthy();
    });
});
