/**
 * Unit tests for `pasteMatchView.ts`, the Presentation Model of choosing foods after Paste a list
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, owner rulings 2026-10-25). Each case pins a
 * promise the spec makes, so a leaf that renders what this module returns cannot break it:
 *
 * - A default is tagged by its flag, wherever the server put it, and is never chosen for the cook.
 * - Search comes first (ruling I1) and "Keep … as written" is always the last row, after every option.
 * - A collapsed open line names what it needs; the summary leaves out a count of 0.
 * - A late review result never replaces the cook's pick: it is one more sentence.
 * - Offline, search says it needs the network instead of offering a control that cannot work.
 * - Every repeated action is named for its line, starting with its visible words (WCAG 2.5.3).
 */
import { describe, expect, it } from 'vitest';

import { recipeMessages } from '../../messages.js';
import { recipeFormMessages } from '../messages.js';
import type { FoodChoice, OpenLine, PastedLineText, SettledLine } from '../pasteMatchLine.js';
import {
    lineTextOf,
    pasteMatchClosedViewOf,
    pasteMatchNoticeOf,
    pasteMatchOpenViewOf,
    pasteMatchPaneViewOf,
    pasteMatchRowViewOf,
    pasteMatchSummaryOf,
    quotaBodyOf,
} from '../pasteMatchView.js';

const m = recipeFormMessages.en;
const copy = { ...m, details: recipeMessages.en.ingredientDetails };
const MILK: PastedLineText = { measure: '2 cups', words: 'milk' };
const EGGS: PastedLineText = { measure: '', words: 'eggs' };
const CREAM: PastedLineText = { measure: '1/2 cup', words: 'heavy cream' };

const choice = (overrides: Partial<FoodChoice> & Pick<FoodChoice, 'id' | 'name'>): FoodChoice => ({
    isDefault: false,
    ...overrides,
});

const MILKS = [
    choice({ id: 'skim', name: 'Skim milk' }),
    choice({ id: 'whole', name: 'Whole milk', isDefault: true }),
    choice({ id: 'oat', name: 'Oat milk', detailParts: ['unsweetened'] }),
];

const milkLine = (chosenId: string | undefined = undefined): OpenLine => ({
    key: 'l1',
    line: MILK,
    need: { kind: 'default', noun: 'milk', options: MILKS, chosenId },
});

describe('lineTextOf', () => {
    it('joins the measure and the words with one space', () => {
        expect(lineTextOf(MILK)).toBe('2 cups milk');
    });

    it('a line with no measure is its words alone, with no leading space', () => {
        expect(lineTextOf(EGGS)).toBe('eggs');
    });
});

describe('pasteMatchOpenViewOf — the options', () => {
    const rowsOf = (line: OpenLine) => pasteMatchOpenViewOf(line, true, copy).rows;

    it('keeps the server’s order and tags the default by its flag, not its position', () => {
        const rows = rowsOf(milkLine());

        expect(rows.map((row) => (row.kind === 'food' ? row.id : row.kind))).toEqual([
            'skim',
            'whole',
            'oat',
            'keepAsWritten',
        ]);
        expect(rows.map((row) => (row.kind === 'food' ? row.tag : undefined))).toEqual([
            undefined,
            'Default',
            undefined,
            undefined,
        ]);
    });

    it('names the default with its tag, after its own name (2.5.3)', () => {
        const rows = rowsOf(milkLine());

        expect(rows[1]?.name).toBe('Whole milk, Default');
        expect(rows[0]?.name).toBe('Skim milk');
    });

    it('names a food with parts by its parts too', () => {
        expect(rowsOf(milkLine())[2]?.name).toBe('Oat milk, unsweetened');
    });

    it('⛔ nothing is chosen while the line holds no pick, the default included', () => {
        expect(rowsOf(milkLine()).some((row) => row.kind === 'food' && row.chosen)).toBe(false);
    });

    it('a reopened line marks the food it holds as chosen, in words and not only by a check', () => {
        const rows = rowsOf(milkLine('skim'));

        expect(rows.filter((row) => row.kind === 'food' && row.chosen).map((row) => row.name)).toEqual([
            'Skim milk, chosen',
        ]);
    });

    it('a chosen default says its tag and that it is chosen', () => {
        expect(rowsOf(milkLine('whole'))[1]?.name).toBe('Whole milk, Default, chosen');
    });

    it('Keep “line” as written is the last row, after every option, with its hint', () => {
        const last = rowsOf(milkLine()).at(-1);

        expect(last).toMatchObject({
            kind: 'keepAsWritten',
            label: 'Keep “2 cups milk” as written',
            hint: 'No nutrition for this line',
            name: 'Keep “2 cups milk” as written',
        });
    });

    it('noMatch: Keep as written is the only row', () => {
        const rows = rowsOf({ key: 'l9', line: EGGS, need: { kind: 'noMatch' } });

        expect(rows.map((row) => row.kind)).toEqual(['keepAsWritten']);
    });

    it('names the group of options for its line', () => {
        expect(pasteMatchOpenViewOf(milkLine(), true, copy).optionsName).toBe('Food for 2 cups milk');
    });
});

describe('pasteMatchOpenViewOf — the prompt and search', () => {
    it('default: names the noun the cook uses', () => {
        expect(pasteMatchOpenViewOf(milkLine(), true, copy).prompt).toBe('Choose the milk you use');
    });

    it('needsChoice: more than one food fits, and nothing is chosen', () => {
        const line: OpenLine = {
            key: 'b',
            line: MILK,
            need: { kind: 'needsChoice', options: MILKS, chosenId: undefined },
        };

        expect(pasteMatchOpenViewOf(line, true, copy).prompt).toBe(
            'More than one food fits. Nothing is chosen for you.',
        );
    });

    it('noMatch: no food was found', () => {
        expect(pasteMatchOpenViewOf({ key: 'n', line: EGGS, need: { kind: 'noMatch' } }, true, copy).prompt).toBe(
            'No food found for this',
        );
    });

    it('online: Search for a food, named for its line', () => {
        expect(pasteMatchOpenViewOf(milkLine(), true, copy).search).toEqual({
            kind: 'available',
            label: 'Search for a food',
            name: 'Search for a food for 2 cups milk',
        });
    });

    it('offline: search says it needs the network, and the loaded options still show', () => {
        const view = pasteMatchOpenViewOf(milkLine(), false, copy);

        expect(view.search).toEqual({ kind: 'unavailable', text: 'Search needs the network' });
        expect(view.rows).toHaveLength(4);
    });
});

describe('pasteMatchClosedViewOf', () => {
    const five = Array.from({ length: 5 }, (_, index) => choice({ id: String(index), name: `Bread ${index}` }));

    it('needsChoice: counts the options', () => {
        const line: OpenLine = {
            key: 'b',
            line: MILK,
            need: { kind: 'needsChoice', options: five, chosenId: undefined },
        };

        expect(pasteMatchClosedViewOf(line, m, 'en').need).toBe('Choose a food · 5 options');
    });

    it('one option is singular', () => {
        const line: OpenLine = {
            key: 'b',
            line: MILK,
            need: { kind: 'needsChoice', options: five.slice(0, 1), chosenId: undefined },
        };

        expect(pasteMatchClosedViewOf(line, m, 'en').need).toBe('Choose a food · 1 option');
    });

    it('default: names the noun and counts the options', () => {
        const line: OpenLine = {
            key: 's',
            line: { measure: '1 pinch', words: 'salt' },
            need: { kind: 'default', noun: 'salt', options: five.slice(0, 3), chosenId: undefined },
        };

        expect(pasteMatchClosedViewOf(line, m, 'en').need).toBe('Choose the salt you use · 3 options');
    });

    it('noMatch: search or keep as written', () => {
        expect(pasteMatchClosedViewOf({ key: 'n', line: EGGS, need: { kind: 'noMatch' } }, m, 'en').need).toBe(
            'No food found · search or keep as written',
        );
    });
});

describe('pasteMatchRowViewOf', () => {
    it('matched: the food with a check and a Change named for the line, and no note', () => {
        const line: SettledLine = { kind: 'matched', key: 'c', line: EGGS, food: 'Egg, whole, raw' };
        const view = pasteMatchRowViewOf(line, true, m);

        expect(view.status).toEqual({ kind: 'food', food: 'Egg, whole, raw', yourChoice: undefined });
        expect(view.trailing).toEqual({
            kind: 'change',
            label: 'Change',
            name: 'Change the food for eggs',
            icon: 'pencilLine',
        });
        expect(view.actions).toEqual([]);
        expect(view.note).toBeUndefined();
    });

    it('chosen: says it is the cook’s choice', () => {
        const line: SettledLine = { kind: 'chosen', key: 'b', line: MILK, food: 'Whole milk', reviewNote: undefined };

        expect(pasteMatchRowViewOf(line, true, m).status).toEqual({
            kind: 'food',
            food: 'Whole milk',
            yourChoice: '· your choice',
        });
        expect(pasteMatchRowViewOf(line, true, m).note).toBeUndefined();
    });

    it('⛔ a late review result keeps the cook’s food and adds one sentence with See why', () => {
        const butter: PastedLineText = { measure: '3 tbsp', words: 'butter, melted' };
        const line: SettledLine = {
            kind: 'chosen',
            key: 'b',
            line: butter,
            food: 'Butter, unsalted',
            reviewNote: { suggestedFood: 'Butter, salted' },
        };
        const view = pasteMatchRowViewOf(line, true, m);

        expect(view.status).toMatchObject({ kind: 'food', food: 'Butter, unsalted' });
        expect(view.note).toEqual({
            sentence: 'Our check suggested Butter, salted. Your choice stays.',
            seeWhy: 'See why',
            seeWhyName: 'See why our check suggested Butter, salted for 3 tbsp butter, melted',
        });
    });

    it('checking, online: the proposal with a Checking tag and a spinner; Use this, then Search', () => {
        const line: SettledLine = { kind: 'checking', key: 'k', line: CREAM, proposal: 'Heavy whipping cream' };
        const view = pasteMatchRowViewOf(line, true, m);

        expect(view.status).toEqual({ kind: 'proposal', food: 'Heavy whipping cream', tag: 'Checking', waiting: true });
        expect(view.actions).toEqual([
            {
                kind: 'useThis',
                label: 'Use this',
                name: 'Use this: Heavy whipping cream for 1/2 cup heavy cream',
                icon: 'check',
            },
            {
                kind: 'search',
                label: 'Search for a food',
                name: 'Search for a food for 1/2 cup heavy cream',
                icon: 'search',
            },
        ]);
    });

    it('checking, offline: the check is paused, search needs the network, and Keep as written is offered', () => {
        const line: SettledLine = { kind: 'checking', key: 'k', line: CREAM, proposal: 'Heavy whipping cream' };
        const view = pasteMatchRowViewOf(line, false, m);

        expect(view.status).toEqual({
            kind: 'proposal',
            food: 'Heavy whipping cream',
            tag: 'Check paused',
            waiting: false,
        });
        expect(view.actions.map((action) => action.kind)).toEqual(['useThis', 'unavailable', 'keepAsWritten']);
        expect(view.actions[1]).toEqual({ kind: 'unavailable', text: 'Search needs the network' });
        expect(view.actions[2]).toEqual({
            kind: 'keepAsWritten',
            label: 'Keep as written',
            name: 'Keep “1/2 cup heavy cream” as written',
            icon: 'listPlus',
        });
    });

    it('optionsFailed: an attention sentence, then Try again, Search and Keep as written', () => {
        const line: SettledLine = { kind: 'optionsFailed', key: 'f', line: MILK };
        const view = pasteMatchRowViewOf(line, true, m);

        expect(view.status).toEqual({
            kind: 'text',
            text: 'We couldn’t load the options for this line.',
            tone: 'attention',
        });
        expect(view.actions.map((action) => (action.kind === 'unavailable' ? action.text : action.name))).toEqual([
            'Try again to load the options for 2 cups milk',
            'Search for a food for 2 cups milk',
            'Keep “2 cups milk” as written',
        ]);
    });

    it('optionsFailed, offline: search says it needs the network', () => {
        const view = pasteMatchRowViewOf({ kind: 'optionsFailed', key: 'f', line: MILK }, false, m);

        expect(view.actions.map((action) => action.kind)).toEqual(['retry', 'unavailable', 'keepAsWritten']);
    });

    it('keptAsWritten: a quiet sentence and no action', () => {
        const view = pasteMatchRowViewOf({ kind: 'keptAsWritten', key: 'w', line: MILK }, true, m);

        expect(view.status).toEqual({ kind: 'text', text: 'Kept as written · no nutrition yet', tone: 'muted' });
        expect(view.actions).toEqual([]);
        expect(view.trailing).toBeUndefined();
    });
});

describe('pasteMatchSummaryOf', () => {
    it('says how many lines were added, then the counts in the spec’s order', () => {
        const summary = pasteMatchSummaryOf({ added: 8, choose: 4, checking: 1, matched: 3 }, m, 'en');

        expect(summary.added).toBe('Added 8 lines');
        expect(summary.counts).toBe('4 need your choice · 1 being checked · 3 matched');
        expect(summary.rule).toBe('Matched lines are ready, and you can change them. Nothing else is chosen for you.');
    });

    it('leaves out a count of 0, and a single line is singular', () => {
        const summary = pasteMatchSummaryOf({ added: 1, choose: 1, checking: 0, matched: 0 }, m, 'en');

        expect(summary.added).toBe('Added 1 line');
        expect(summary.counts).toBe('1 needs your choice');
    });

    it('all matched: only the matched count', () => {
        expect(pasteMatchSummaryOf({ added: 3, choose: 0, checking: 0, matched: 3 }, m, 'en').counts).toBe('3 matched');
    });
});

describe('quotaBodyOf', () => {
    it('says when matching starts again, in the cook’s locale and time zone', () => {
        const resetsAt = '2026-10-26T04:00:00.000Z';
        const time = new Intl.DateTimeFormat('en', { timeStyle: 'short', timeZone: 'America/New_York' }).format(
            new Date(resetsAt),
        );

        expect(time).toBe('12:00 AM');
        expect(quotaBodyOf(resetsAt, m, 'en', 'America/New_York')).toBe(
            `You’ve added a lot today. Matching starts again at ${time}. These lines are kept as written, and you can choose foods for them then.`,
        );
    });
});

describe('pasteMatchPaneViewOf', () => {
    it('says which open line it shows, out of how many, and heads it with the line', () => {
        const view = pasteMatchPaneViewOf(milkLine(), { index: 1, count: 4 }, true, copy);

        expect(view.position).toBe('Open line 2 of 4');
        expect(view.heading).toBe('2 cups milk');
        expect(view.label).toBe('Choose a food');
        expect(view.open.prompt).toBe('Choose the milk you use');
    });

    it('in the middle, both Previous and Next can be used', () => {
        const view = pasteMatchPaneViewOf(milkLine(), { index: 1, count: 4 }, true, copy);

        expect([view.previous.disabled, view.next.disabled]).toEqual([false, false]);
        expect([view.previous.label, view.next.label]).toEqual(['Previous', 'Next open line']);
    });

    it('the first line cannot go back, and the last cannot go on', () => {
        expect(pasteMatchPaneViewOf(milkLine(), { index: 0, count: 4 }, true, copy).previous.disabled).toBe(true);
        expect(pasteMatchPaneViewOf(milkLine(), { index: 3, count: 4 }, true, copy).next.disabled).toBe(true);
    });

    it('a single open line can go neither way', () => {
        const view = pasteMatchPaneViewOf(milkLine(), { index: 0, count: 1 }, true, copy);

        expect([view.previous.disabled, view.next.disabled]).toEqual([true, true]);
    });
});

describe('pasteMatchNoticeOf', () => {
    it('offline, on a device: choices are saved on this device', () => {
        expect(pasteMatchNoticeOf({ kind: 'offline', keep: 'disk' }, m, 'en')).toBe(
            'You’re offline. Your choices are saved on this device. Search and the check start again when you’re back online.',
        );
    });

    it('⛔ offline, on web: choices are kept in this tab, never claimed to be on the device (D7)', () => {
        expect(pasteMatchNoticeOf({ kind: 'offline', keep: 'tabSession' }, m, 'en')).toBe(
            'You’re offline. Your choices are kept in this tab. Search and the check start again when you’re back online.',
        );
    });

    it('the daily limit: says when matching starts again', () => {
        const notice = { kind: 'quota', resetsAt: '2026-10-26T04:00:00.000Z', timeZone: 'America/New_York' } as const;

        expect(pasteMatchNoticeOf(notice, m, 'en')).toBe(quotaBodyOf(notice.resetsAt, m, 'en', notice.timeZone));
        expect(pasteMatchNoticeOf(notice, m, 'en')).toContain('12:00 AM');
    });
});
