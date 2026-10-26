/**
 * Unit tests for `matchLineView.ts`, the ONE row view model both ingredient-matching flows render
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, owner rulings 2026-10-25). Every platform
 * leaf of both flows switches on `lineRowOf(...)`'s `kind` and draws what it returns, so these cases are the contract.
 *
 * The cases were ported from the editor builder's `pasteMatchView.test.ts` (open, collapsed and settled lines) and the
 * import builder's `importLineCopy.test.ts` (prompts, closed needs) when the two builds were reconciled, and rewritten
 * onto the one line model with its explicit `binding`. What the reconciliation changed, pinned here:
 *
 * - A default the SERVER bound (bulk "Save lines as written") shows its Default tag and is not "your choice"; only a
 *   COOK's binding says "your choice", as one sentence with a no-break space before its dot.
 * - Every line kept as written offers Change (staff-ux 2026-10-25, ruling I1), whoever kept it.
 * - The short "Keep as written" action is named "Keep as written: {line}" — every action's name starts with its label
 *   (WCAG 2.5.3), asserted over every settled kind × online.
 * - A send in flight: its control reads busy and the line refuses a second press, in the list (a pick) and on a
 *   settled row (Use this, Keep as written) alike — the staff-architect review found the settled row had no busy state.
 * - A late review note carries its reason, for See why.
 */
import { describe, expect, it } from 'vitest';

import { recipeMessages } from '../../messages.js';
import {
    cookPicked,
    makeCheckingLine,
    makeConfidentLine,
    makeDefaultLine,
    makeFoodChoice,
    makeNeedsChoiceLine,
    makeNoMatchLine,
    makeOptionsFailedLine,
    MILKS,
} from '../__fixtures__/matchLines.js';
import type { LinePick, MatchLine } from '../matchLine.js';
import { choiceListViewOf, lineRowOf, type LinePlace, type LineRow } from '../matchLineView.js';
import { matchLineMessages } from '../messages.js';

const copy = { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails };
const m = matchLineMessages.en;
const SKIM = MILKS[0] ?? makeFoodChoice({ id: 'skim', name: 'Skim milk' });
const WHOLE = MILKS[1] ?? makeFoodChoice({ id: 'whole', name: 'Whole milk', isDefault: true });

const PLACE: LinePlace = { expanded: false, current: false, online: true, pending: undefined };

/** The row, narrowed to one kind, or a failed assertion. */
function rowOf<K extends LineRow['kind']>(
    kind: K,
    line: MatchLine,
    place: Partial<LinePlace> = {},
): Extract<LineRow, { readonly kind: K }> {
    const row = lineRowOf(line, { ...PLACE, ...place }, copy, 'en');

    expect(row.kind).toBe(kind);

    return row as Extract<LineRow, { readonly kind: K }>;
}

const listOf = (line: MatchLine, options: { online?: boolean; pending?: LinePick } = {}) =>
    choiceListViewOf(
        line,
        {
            online: options.online ?? true,
            pending: options.pending === undefined ? undefined : { kind: 'pick', pick: options.pending },
        },
        copy,
    );

describe('lineRowOf — which row a line is', () => {
    it('an open line not expanded is a collapsed row naming its need', () => {
        expect(rowOf('closed', makeDefaultLine()).need).toBe('Choose the milk you use\u00A0· 3 options');
    });

    it('an open line expanded is the open row', () => {
        expect(rowOf('open', makeDefaultLine(), { expanded: true }).view.prompt).toBe('Choose the milk you use');
    });

    it('a bound line not expanded is settled, and expanded (Change) it is open with its options', () => {
        const bound = makeDefaultLine({ binding: cookPicked(SKIM) });

        expect(rowOf('settled', bound).key).toBe('milk');
        expect(rowOf('open', bound, { expanded: true }).view.list.rows).toHaveLength(3);
    });

    it('a confident line opened by Change has no prompt: nothing about it needs a choice', () => {
        const open = rowOf('open', makeConfidentLine({ candidates: MILKS }), { expanded: true });

        expect(open.view.prompt).toBeUndefined();
        expect(open.view.list.rows.map((row) => row.label)).toEqual(['Skim milk', 'Whole milk', 'Oat milk']);
    });

    it('a checking line is never drawn open while unbound: it reaches search in one tap instead', () => {
        expect(rowOf('settled', makeCheckingLine(), { expanded: true }).view.status.kind).toBe('proposal');
    });

    it('a checking line the cook picked for opens on Change to search and Keep as written', () => {
        const open = rowOf('open', makeCheckingLine({ binding: cookPicked(WHOLE) }), { expanded: true });

        expect(open.view.list.rows).toEqual([]);
        expect(open.view.list.search.kind).toBe('available');
    });

    it('a line whose options failed stays settled even if expanded', () => {
        expect(rowOf('settled', makeOptionsFailedLine(), { expanded: true }).view.status.kind).toBe('text');
    });

    it('a collapsed row the side pane shows is marked current', () => {
        expect(rowOf('closed', makeDefaultLine(), { current: true }).current).toBe(true);
        expect(rowOf('closed', makeDefaultLine()).current).toBe(false);
    });
});

describe('the collapsed row’s need', () => {
    const five = Array.from({ length: 5 }, (_, index) => makeFoodChoice({ id: String(index), name: `Bread ${index}` }));

    it('needsChoice: counts the options', () => {
        expect(rowOf('closed', makeNeedsChoiceLine({ candidates: five })).need).toBe('Choose a food\u00A0· 5 options');
    });

    it('one option is singular', () => {
        expect(rowOf('closed', makeNeedsChoiceLine({ candidates: five.slice(0, 1) })).need).toBe(
            'Choose a food\u00A0· 1 option',
        );
    });

    it('default: names the noun and counts the options, not the keep row', () => {
        expect(rowOf('closed', makeDefaultLine({ noun: 'salt', candidates: five.slice(0, 3) })).need).toBe(
            'Choose the salt you use\u00A0· 3 options',
        );
    });

    it('default with one option is singular', () => {
        expect(rowOf('closed', makeDefaultLine({ candidates: [WHOLE] })).need).toBe(
            'Choose the milk you use\u00A0· 1 option',
        );
    });

    it('noMatch: search or keep as written', () => {
        expect(rowOf('closed', makeNoMatchLine()).need).toBe('No food found\u00A0· search or keep as written');
    });
});

describe('the open row’s prompt', () => {
    it.each([
        ['default', makeDefaultLine(), 'Choose the milk you use'],
        ['needsChoice', makeNeedsChoiceLine(), 'More than one food fits. Nothing is chosen for you.'],
        ['noMatch', makeNoMatchLine(), 'No food found for this'],
    ])('%s', (_, line, prompt) => {
        expect(rowOf('open', line, { expanded: true }).view.prompt).toBe(prompt);
    });
});

describe('choiceListViewOf — search, the options, Keep as written', () => {
    it('keeps the server’s order and tags the default by its flag, not its position', () => {
        const { rows } = listOf(makeDefaultLine());

        expect(rows.map((row) => row.label)).toEqual(['Skim milk', 'Whole milk', 'Oat milk']);
        expect(rows.map((row) => row.tag)).toEqual([undefined, 'Default', undefined]);
    });

    it('names the default with its tag, after its own name, and a food with parts by its parts (2.5.3)', () => {
        expect(listOf(makeDefaultLine()).rows.map((row) => row.name)).toEqual([
            'Skim milk',
            'Whole milk, Default',
            'Oat milk, unsweetened',
        ]);
    });

    it('⛔ nothing is chosen while the line holds no pick, the default included', () => {
        const list = listOf(makeDefaultLine());

        expect(list.rows.some((row) => row.chosen)).toBe(false);
        expect(list.keep.chosen).toBe(false);
    });

    it('a reopened line marks the food it holds as chosen, in words and not only by a check', () => {
        const { rows } = listOf(makeDefaultLine({ binding: cookPicked(SKIM) }));

        expect(rows.filter((row) => row.chosen).map((row) => row.name)).toEqual(['Skim milk, chosen']);
    });

    it('a chosen default says its tag and that it is chosen', () => {
        expect(listOf(makeDefaultLine({ binding: cookPicked(WHOLE) })).rows[1]?.name).toBe(
            'Whole milk, Default, chosen',
        );
    });

    it('a server-bound default reopened by Change is marked chosen too: it IS the bound food', () => {
        const bound = makeDefaultLine({
            binding: { boundBy: 'server', pick: { kind: 'food', foodId: 'whole', name: 'Whole milk' } },
        });

        expect(listOf(bound).rows[1]?.chosen).toBe(true);
    });

    it('Keep “line” as written comes after every option, named by its label, with its hint', () => {
        expect(listOf(makeDefaultLine()).keep).toMatchObject({
            label: 'Keep “2 cups milk” as written',
            hint: 'No nutrition for this line',
            name: 'Keep “2 cups milk” as written',
            pick: { kind: 'asWritten' },
        });
    });

    it('a line kept as written and reopened marks the keep row chosen', () => {
        const kept = makeNoMatchLine({
            binding: { boundBy: 'cook', pick: { kind: 'asWritten' }, reviewNote: undefined },
        });

        expect(listOf(kept).keep).toMatchObject({ chosen: true, name: 'Keep “1 tsp spice mix” as written, chosen' });
    });

    it('noMatch: no food rows, only Keep as written after search', () => {
        expect(listOf(makeNoMatchLine()).rows).toEqual([]);
    });

    it('names the group of options for its line', () => {
        expect(listOf(makeDefaultLine()).optionsName).toBe('Food for 2 cups milk');
    });

    it('online: Search for a food, named for its line', () => {
        expect(listOf(makeDefaultLine()).search).toEqual({
            kind: 'available',
            label: 'Search for a food',
            name: 'Search for a food for 2 cups milk',
        });
    });

    it('offline: search says it needs the network, and the loaded options still show', () => {
        const list = listOf(makeDefaultLine(), { online: false });

        expect(list.search).toEqual({ kind: 'unavailable', text: 'Search needs the network' });
        expect(list.rows).toHaveLength(3);
    });

    it('no pick in flight: no row is busy and the list takes a press', () => {
        const list = listOf(makeDefaultLine());

        expect(list.refusing).toBe(false);
        expect([...list.rows, list.keep].some((row) => row.busy)).toBe(false);
    });

    it('⛔ a pick in flight: its row reads busy and the whole list refuses a second press', () => {
        const list = listOf(makeDefaultLine(), { pending: { kind: 'food', foodId: 'skim', name: 'Skim milk' } });

        expect(list.refusing).toBe(true);
        expect(list.rows.map((row) => row.busy)).toEqual([true, false, false]);
        expect(list.keep.busy).toBe(false);
    });

    it('keeping as written in flight marks the keep row busy', () => {
        const list = listOf(makeDefaultLine(), { pending: { kind: 'asWritten' } });

        expect(list.keep.busy).toBe(true);
        expect(list.rows.some((row) => row.busy)).toBe(false);
    });

    it('each food row carries the pick it sends, and an id unique in the list', () => {
        const { rows, keep } = listOf(makeDefaultLine());

        expect(rows[1]?.pick).toEqual({ kind: 'food', foodId: 'whole', name: 'Whole milk' });
        expect(new Set([...rows, keep].map((row) => row.id)).size).toBe(4);
    });
});

describe('a settled line', () => {
    it('confident: the food with Change named for the line, no tag, no "your choice", no note', () => {
        const { view } = rowOf('settled', makeConfidentLine());

        expect(view.status).toEqual({ kind: 'food', text: 'Egg, whole, raw', tag: undefined });
        expect(view.trailing).toEqual({
            kind: 'change',
            label: 'Change',
            name: 'Change the food for eggs',
            icon: 'pencilLine',
            busy: false,
        });
        expect(view.actions).toEqual([]);
        expect(view.note).toBeUndefined();
    });

    it('the cook’s pick says "your choice" as ONE sentence, a no-break space before its dot', () => {
        expect(rowOf('settled', makeDefaultLine({ binding: cookPicked(WHOLE) })).view.status).toEqual({
            kind: 'food',
            text: 'Whole milk\u00A0· your choice',
            tag: undefined,
        });
    });

    it('⛔ a default the server bound keeps its Default tag and is NOT "your choice"', () => {
        const bound = makeDefaultLine({
            binding: { boundBy: 'server', pick: { kind: 'food', foodId: 'whole', name: 'Whole milk' } },
        });

        expect(rowOf('settled', bound).view.status).toEqual({ kind: 'food', text: 'Whole milk', tag: 'Default' });
    });

    it('a non-default food the server bound has no tag', () => {
        const bound = makeDefaultLine({
            binding: { boundBy: 'review', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } },
        });

        expect(rowOf('settled', bound).view.status).toEqual({ kind: 'food', text: 'Skim milk', tag: undefined });
    });

    it('⛔ a late review result keeps the cook’s food and adds one sentence with See why and its reason', () => {
        const butter = makeDefaultLine({
            line: { measure: '3 tbsp', words: 'butter, melted' },
            binding: cookPicked(makeFoodChoice({ id: 'u', name: 'Butter, unsalted' }), {
                suggestedFood: 'Butter, salted',
                reason: 'The recipe adds no other salt.',
            }),
        });
        const { view } = rowOf('settled', butter);

        expect(view.status).toMatchObject({ kind: 'food', text: 'Butter, unsalted\u00A0· your choice' });
        expect(view.note).toEqual({
            sentence: 'Our check suggested Butter, salted. Your choice stays.',
            reason: 'The recipe adds no other salt.',
            seeWhy: 'See why',
            seeWhyName: 'See why our check suggested Butter, salted for 3 tbsp butter, melted',
        });
    });

    it('checking, online: the proposal with its Checking tag, waiting; Use this, then Search', () => {
        const { view } = rowOf('settled', makeCheckingLine());

        expect(view.status).toEqual({ kind: 'proposal', food: 'Heavy whipping cream', tag: 'Checking', waiting: true });
        expect(view.actions).toEqual([
            {
                kind: 'useThis',
                label: 'Use this',
                name: 'Use this: Heavy whipping cream for 1/2 cup heavy cream',
                icon: 'check',
                busy: false,
            },
            {
                kind: 'search',
                label: 'Search for a food',
                name: 'Search for a food for 1/2 cup heavy cream',
                icon: 'search',
                busy: false,
            },
        ]);
    });

    it('checking, offline: the check is paused, search needs the network, and Keep as written is offered', () => {
        const { view } = rowOf('settled', makeCheckingLine(), { online: false });

        expect(view.status).toEqual({
            kind: 'proposal',
            food: 'Heavy whipping cream',
            tag: 'Check paused',
            waiting: false,
        });
        expect(view.actions[1]).toEqual({ kind: 'unavailable', text: 'Search needs the network' });
        expect(view.actions[2]).toEqual({
            kind: 'keepAsWritten',
            label: 'Keep as written',
            name: 'Keep as written: 1/2 cup heavy cream',
            icon: 'listPlus',
            busy: false,
        });
    });

    it('optionsFailed: an attention sentence, then Try again, Search and Keep as written', () => {
        const { view } = rowOf('settled', makeOptionsFailedLine());

        expect(view.status).toEqual({ kind: 'text', text: m.optionsError, tone: 'attention' });
        expect(view.actions.map((action) => (action.kind === 'unavailable' ? action.text : action.name))).toEqual([
            'Try again to load the options for 2 cups milk',
            'Search for a food for 2 cups milk',
            'Keep as written: 2 cups milk',
        ]);
    });

    it('optionsFailed, offline: search says it needs the network', () => {
        const { view } = rowOf('settled', makeOptionsFailedLine(), { online: false });

        expect(view.actions.map((action) => action.kind)).toEqual(['retry', 'unavailable', 'keepAsWritten']);
    });

    it.each([
        ['the cook', { boundBy: 'cook', pick: { kind: 'asWritten' }, reviewNote: undefined }],
        ['the server (daily limit, bulk)', { boundBy: 'server', pick: { kind: 'asWritten' } }],
    ] as const)('kept as written by %s: a quiet sentence, and Change to choose a food later', (_, binding) => {
        const { view } = rowOf('settled', makeNoMatchLine({ binding }));

        expect(view.status).toEqual({ kind: 'text', text: 'Kept as written\u00A0· no nutrition yet', tone: 'muted' });
        expect(view.trailing?.kind).toBe('change');
        expect(view.actions).toEqual([]);
    });
});

describe('a settled line’s send in flight', () => {
    it('⛔ Use this in flight: it reads busy, and the row refuses a second press of anything', () => {
        const { view } = rowOf('settled', makeCheckingLine(), { pending: { kind: 'useProposal' } });

        expect(view.refusing).toBe(true);
        expect(view.actions.map((action) => (action.kind === 'unavailable' ? undefined : action.busy))).toEqual([
            true,
            false,
        ]);
    });

    it('Keep as written in flight on a checking line offline: the keep reads busy', () => {
        const { view } = rowOf('settled', makeCheckingLine(), {
            online: false,
            pending: { kind: 'pick', pick: { kind: 'asWritten' } },
        });

        expect(view.refusing).toBe(true);
        expect(view.actions.map((action) => (action.kind === 'unavailable' ? undefined : action.busy))).toEqual([
            false,
            undefined,
            true,
        ]);
    });

    it('nothing in flight: no action is busy and the row takes a press', () => {
        const { view } = rowOf('settled', makeCheckingLine());

        expect(view.refusing).toBe(false);
        expect(view.actions.some((action) => action.kind !== 'unavailable' && action.busy)).toBe(false);
    });
});

describe('⛔ every control’s accessible name starts with its visible label (WCAG 2.5.3)', () => {
    const settledLines: readonly [string, MatchLine][] = [
        ['confident', makeConfidentLine()],
        ['cook-bound', makeDefaultLine({ binding: cookPicked(WHOLE, { suggestedFood: 'Skim milk', reason: 'r' }) })],
        [
            'server-bound default',
            makeDefaultLine({
                binding: { boundBy: 'server', pick: { kind: 'food', foodId: 'whole', name: 'Whole milk' } },
            }),
        ],
        ['kept as written', makeNoMatchLine({ binding: { boundBy: 'server', pick: { kind: 'asWritten' } } })],
        ['checking', makeCheckingLine()],
        ['optionsFailed', makeOptionsFailedLine()],
    ];

    for (const online of [true, false]) {
        it.each(settledLines)(`%s, online ${String(online)}`, (_, line) => {
            const { view } = rowOf('settled', line, { online });
            const named = [
                ...(view.trailing === undefined ? [] : [view.trailing]),
                ...view.actions.flatMap((action) => (action.kind === 'unavailable' ? [] : [action])),
                ...(view.note === undefined ? [] : [{ label: view.note.seeWhy, name: view.note.seeWhyName }]),
            ].map(({ label, name }) => ({ label, name }));

            expect(named.length).toBeGreaterThan(0);
            expect(named.filter(({ label, name }) => !name.startsWith(label))).toEqual([]);
        });
    }

    it('every option row and the keep row too', () => {
        const list = listOf(makeDefaultLine({ binding: cookPicked(WHOLE) }));

        expect([...list.rows, list.keep].filter((row) => !row.name.startsWith(row.label))).toEqual([]);
        expect(list.search).toMatchObject({ kind: 'available' });
        expect(list.search.kind === 'available' && list.search.name.startsWith(list.search.label)).toBe(true);
    });
});
