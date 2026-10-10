/**
 * REWRITTEN for plan 002 S7.8: what an ingredient entry field's combobox lists, shows and announces, from the ONE
 * progressive answer (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P1 to P8; items 1, 2, 5 and 10 and
 * rulings R1 to R3 still hold; L1 to L4 govern the database part). The live search and its option are gone (S7.9):
 * remote foods arrive by themselves.
 *
 * ⛔ Each case pins the whole answer for one state, so a rule that moves one state fails that case. The rules that hold
 * for every state (an inactive field says nothing; below the minimum nothing is offered) are stated again as properties.
 */
import type { ProgressiveFrame } from '@kitchensink/food-service-client';
import { describe, expect, it } from 'vitest';

import {
    COMPLETE_FRAME,
    answerOf,
    authoredResult,
    catalogResult,
    databaseFrame,
    remoteItem,
    sourceAnswered,
    sourceBusy,
    sourceLimited,
    sourceUnavailable,
} from '../../__fixtures__/progressiveFrames.js';
import { entrySearchViewOf, type EntrySearchView, type ProgressiveRead } from '../../hooks/foodSuggestions.model.js';
import { recipeMessages } from '../../messages.js';
import { entryComboboxOf, type EntryComboboxCopy, type EntryComboboxInput } from '../entryCombobox.js';
import { recipeFormMessages } from '../messages.js';

const form = recipeFormMessages.en;
const shared = recipeMessages.en;
const READ_OFFLINE = 'Waiting for a connection. This loads on its own.';

const COPY: EntryComboboxCopy = {
    form,
    search: shared.ingredientSearch,
    pickerSearch: shared.ingredientPickerSearch,
    remote: shared.ingredientRemoteSearch,
    details: shared.ingredientDetails,
    readOffline: READ_OFFLINE,
};

const MINE = authoredResult('food_mine', 'Chickpeas, home cooked');
const DRY = catalogResult('food_cp', 'Chickpeas, dry');
const BOTH = databaseFrame({ authored: [MINE], catalog: [DRY] });
const GARBANZO = remoteItem('Garbanzo beans, raw', 'sealed.g');

/** The list's view for `frames`, the answer still running (`asking`) or ended. */
const viewOf = (
    frames: readonly ProgressiveFrame[],
    kind: 'asking' | 'ended' = 'ended',
    resumed = false,
): EntrySearchView => {
    const read: ProgressiveRead = { kind, answer: answerOf(...frames), resumed };

    return entrySearchViewOf({ trimmed: 'chickpea', debouncedTrimmed: 'chickpea', read });
};

/** The register's names the field reads; `cnf` has none here, so it reads as the fallback. */
const SOURCE_NAMES: Readonly<Record<string, string>> = { usda: 'USDA', fdc: 'FDC Branded' };

const input = (over: Partial<EntryComboboxInput> = {}): EntryComboboxInput => ({
    active: true,
    text: 'chickpea',
    view: viewOf([BOTH, COMPLETE_FRAME]),
    databaseSaidEarly: false,
    pickFailure: undefined,
    refusal: undefined,
    offersCreateOwnFood: false,
    formatTime: () => '3:05 PM',
    formatList: (items) => items.join(' and '),
    sourceName: (source) => SOURCE_NAMES[source],
    ...over,
});

const labelsOf = (view: ReturnType<typeof entryComboboxOf>) =>
    view.groups.map((group) => ({ group: group.label, options: group.options.map((option) => option.label) }));

const linesOf = (lines: ReturnType<typeof entryComboboxOf>['trailingStatus']) =>
    lines.map((line) => (line.kind === 'loading' ? `[loading] ${line.label}` : line.text));

const FIND = 'Find nutrition for “chickpea”';
const USE = 'Use “chickpea” as written, without nutrition';
const CREATE = 'Create my own food';
const NOT_LISTED = { group: 'Not listed?', options: [FIND, USE] };
const NO_MATCH =
    'Nothing in your foods or the food catalog matches “chickpea”. Keep typing, or find its nutrition by name.';

describe('entryComboboxOf — before the database part (P2, P6)', () => {
    it('no frame yet: the loader alone, last, and the polite channel says it is searching', () => {
        const view = entryComboboxOf(input({ view: viewOf([], 'asking') }), COPY);

        expect(view.groups).toEqual([]);
        expect(view.status).toBeUndefined();
        expect(linesOf(view.trailingStatus)).toEqual(['[loading] Searching ingredients']);
        expect(view.countAnnouncement).toBe('Searching ingredients');
        expect(view.alertAnnouncement).toBe('');
    });

    it('while the debounce lags: the loader alone, never the previous text’s foods', () => {
        const lagging = entrySearchViewOf({
            trimmed: 'chickpeas',
            debouncedTrimmed: 'chickpea',
            read: { kind: 'ended', answer: answerOf(BOTH, COMPLETE_FRAME), resumed: false },
        });
        const view = entryComboboxOf(input({ text: 'chickpeas', view: lagging }), COPY);

        expect(view.groups).toEqual([]);
        expect(linesOf(view.trailingStatus)).toEqual(['[loading] Searching ingredients']);
    });

    // P6: "Nothing arrived covers a transport error, a 5xx, a rate-limit refusal of the search itself, and the database
    // deadline."
    it('nothing arrived: `failed` is the database line, said assertively once, with the ways on and no loader', () => {
        const view = entryComboboxOf(input({ view: viewOf([]), offersCreateOwnFood: true }), COPY);

        expect(view.status).toEqual({ kind: 'note', text: shared.ingredientPickerSearch.failed });
        expect(labelsOf(view)).toEqual([{ group: 'Not listed?', options: [FIND, USE, CREATE] }]);
        expect(view.trailingStatus).toEqual([]);
        expect(view.countAnnouncement).toBe('');
        expect(view.alertAnnouncement).toBe(shared.ingredientPickerSearch.failed);
    });

    it('offline: `Not listed?`, then Create under `None of these?`, then the offline line where the loader was', () => {
        const view = entryComboboxOf(input({ view: { kind: 'offline' }, offersCreateOwnFood: true }), COPY);

        expect(labelsOf(view)).toEqual([NOT_LISTED, { group: 'None of these?', options: [CREATE] }]);
        expect(linesOf(view.trailingStatus)).toEqual([READ_OFFLINE]);
        expect(view.countAnnouncement).toBe(READ_OFFLINE);
        expect(view.alertAnnouncement).toBe('');
    });

    // P2: "A reconnect resumes the parked answer. `Not listed?` and `None of these?` stay on screen."
    it('a resumed answer keeps `Not listed?` and `None of these?` on screen while it searches', () => {
        const view = entryComboboxOf(input({ view: viewOf([], 'asking', true), offersCreateOwnFood: true }), COPY);

        expect(labelsOf(view)).toEqual([NOT_LISTED, { group: 'None of these?', options: [CREATE] }]);
        expect(linesOf(view.trailingStatus)).toEqual(['[loading] Searching ingredients']);
    });

    it('below the minimum: only the guidance, no option, no loader, nothing said (item 2)', () => {
        const view = entryComboboxOf(input({ text: 'ch', view: { kind: 'tooShort', minimum: 3 } }), COPY);

        expect(view.groups).toEqual([]);
        expect(view.status).toEqual({ kind: 'note', text: shared.ingredientSearch.tooShort.replace('{minimum}', '3') });
        expect(view.trailingStatus).toEqual([]);
        expect(view.countAnnouncement).toBe('');
    });

    it('an untouched field shows and says nothing', () => {
        const view = entryComboboxOf(input({ text: '', view: { kind: 'idle' } }), COPY);

        expect(view.groups).toEqual([]);
        expect(view.status).toBeUndefined();
        expect(view.trailingStatus).toEqual([]);
        expect(view.countAnnouncement).toBe('');
    });
});

describe('entryComboboxOf — the database part (L1 to L3, P6)', () => {
    it('running: the database groups, `Not listed?`, then `Still searching`, and nothing new said yet (P7)', () => {
        const view = entryComboboxOf(input({ view: viewOf([BOTH], 'asking'), offersCreateOwnFood: true }), COPY);

        expect(labelsOf(view)).toEqual([
            { group: 'Your foods', options: ['Chickpeas, home cooked'] },
            { group: 'Food catalog', options: ['Chickpeas, dry'] },
            NOT_LISTED,
        ]);
        expect(view.status).toBeUndefined();
        expect(linesOf(view.trailingStatus)).toEqual(['[loading] Still searching other food databases']);
        expect(view.countAnnouncement).toBe('Searching ingredients');
    });

    it('a group with no food has no heading', () => {
        expect(
            labelsOf(entryComboboxOf(input({ view: viewOf([databaseFrame({ catalog: [DRY] })]) }), COPY))[0],
        ).toEqual({ group: 'Food catalog', options: ['Chickpeas, dry'] });
    });

    it('both answered with no food: the database line names the way on, and stays true beside remote foods', () => {
        const view = entryComboboxOf(
            input({ view: viewOf([databaseFrame(), sourceAnswered('usda', GARBANZO), COMPLETE_FRAME]) }),
            COPY,
        );

        expect(view.status).toEqual({ kind: 'note', text: NO_MATCH });
        expect(labelsOf(view)).toEqual([NOT_LISTED, { group: 'From USDA', options: ['Garbanzo beans, raw'] }]);
    });

    // REWRITTEN for `docs/design/v3Evaluation.md` V3-M2a: one "failed alone" case became two, because what the other
    // group found now decides where the L3 sentence stands. It is never “no foods match” in either place.
    const failedAlone: ReadonlyArray<readonly [string, ProgressiveFrame, string]> = [
        ['the catalog', databaseFrame({ catalog: 'unavailable', authored: [MINE] }), form.ingredientCatalogUnavailable],
        [
            'the cook’s own foods',
            databaseFrame({ authored: 'unavailable', catalog: [DRY] }),
            form.ingredientAuthoredUnavailable,
        ],
    ];

    it.each(failedAlone)(
        '%s failed alone while the other group found foods: its sentence is the first trailing line, after the foods',
        (_case, frame, sentence) => {
            const view = entryComboboxOf(input({ view: viewOf([frame, COMPLETE_FRAME]) }), COPY);

            expect(view.status).toBeUndefined();
            expect(linesOf(view.trailingStatus)).toEqual([sentence]);
        },
    );

    const SOURCE_FOODS = [sourceAnswered('usda', GARBANZO)];

    it.each<[string, string, 'authored' | 'catalog', string, readonly ProgressiveFrame[]]>([
        ['the catalog', 'no source added foods', 'catalog', form.ingredientCatalogUnavailable, []],
        ['the cook’s own foods', 'no source added foods', 'authored', form.ingredientAuthoredUnavailable, []],
        // P2: the place is chosen at the database part's settle, so remote foods arriving later never move the line.
        ['the catalog', 'a source then added foods', 'catalog', form.ingredientCatalogUnavailable, SOURCE_FOODS],
        [
            'the cook’s own foods',
            'a source then added foods',
            'authored',
            form.ingredientAuthoredUnavailable,
            SOURCE_FOODS,
        ],
    ])(
        '%s failed alone while the other group found nothing, and %s: its sentence leads the list',
        (_case, _when, group, sentence, later) => {
            const view = entryComboboxOf(
                input({ view: viewOf([databaseFrame({ [group]: 'unavailable' }), ...later, COMPLETE_FRAME]) }),
                COPY,
            );

            expect(view.status).toEqual({ kind: 'note', text: sentence });
            expect(linesOf(view.trailingStatus)).toEqual([]);
        },
    );

    it('a later source’s note and the loader land after the database line that trails the foods', () => {
        const view = entryComboboxOf(
            input({
                view: viewOf(
                    [databaseFrame({ catalog: 'unavailable', authored: [MINE] }), sourceBusy('fdc', 1)],
                    'asking',
                ),
            }),
            COPY,
        );

        expect(view.status).toBeUndefined();
        expect(linesOf(view.trailingStatus)).toEqual([
            form.ingredientCatalogUnavailable,
            'We couldn’t search FDC Branded just now. Try again later.',
            '[loading] Still searching other food databases',
        ]);
    });

    it('both failed while a source still answers: `ingredientDatabaseUnavailable` is the database line', () => {
        const view = entryComboboxOf(
            input({ view: viewOf([databaseFrame({ authored: 'unavailable', catalog: 'unavailable' })], 'asking') }),
            COPY,
        );

        expect(view.status).toEqual({ kind: 'note', text: form.ingredientDatabaseUnavailable });
        expect(view.alertAnnouncement).toBe('');
    });

    // P6: "Every part fails … With a database frame, its line stays and each source's note shows."
    it('every part failed: the database line stays, each source’s note shows, and `failed` is said assertively', () => {
        const view = entryComboboxOf(
            input({
                view: viewOf([
                    databaseFrame({ authored: 'unavailable', catalog: 'unavailable' }),
                    sourceUnavailable('usda'),
                    COMPLETE_FRAME,
                ]),
            }),
            COPY,
        );

        expect(view.status).toEqual({ kind: 'note', text: form.ingredientDatabaseUnavailable });
        expect(linesOf(view.trailingStatus)).toEqual(['We didn’t hear back from USDA. Edit your search to try again.']);
        expect(view.countAnnouncement).toBe('');
        expect(view.alertAnnouncement).toBe(shared.ingredientPickerSearch.failed);
    });
});

describe('entryComboboxOf — each remote source (P1, P5, P6)', () => {
    it('a source with foods: its group `From {source}`, after `Not listed?`, each hit named with its source', () => {
        const view = entryComboboxOf(input({ view: viewOf([BOTH, sourceAnswered('usda', GARBANZO)], 'asking') }), COPY);
        const remote = view.groups.at(-1);

        expect(remote?.label).toBe('From USDA');
        expect(remote?.options).toEqual([
            {
                key: 'remote:usda:sealed.g',
                label: 'Garbanzo beans, raw',
                accessibleName: 'Garbanzo beans, raw, from USDA',
            },
        ]);
        expect(view.groups.map((group) => group.key)).toEqual(['authored', 'catalog', 'more', 'remote:usda']);
    });

    it('sources add their groups in the order their frames arrived', () => {
        const view = entryComboboxOf(
            input({
                view: viewOf([
                    BOTH,
                    sourceAnswered('fdc', remoteItem('Chickpeas, canned', 'sealed.c')),
                    sourceAnswered('usda', GARBANZO),
                ]),
            }),
            COPY,
        );

        expect(view.groups.slice(3).map((group) => group.label)).toEqual(['From FDC Branded', 'From USDA']);
    });

    // P6: "Never "{source} has nothing": R66 hides a hit for a food our catalog holds, so the source can have had matches."
    it('a source that answered with nothing shows nothing at all', () => {
        const view = entryComboboxOf(input({ view: viewOf([BOTH, sourceAnswered('usda'), COMPLETE_FRAME]) }), COPY);

        expect(view.groups.map((group) => group.key)).toEqual(['authored', 'catalog', 'more']);
        expect(view.trailingStatus).toEqual([]);
    });

    it('a source with no name in the register is named by the fallback, never its id (P5)', () => {
        const view = entryComboboxOf(input({ view: viewOf([BOTH, sourceAnswered('cnf', GARBANZO)]) }), COPY);

        expect(view.groups.at(-1)?.label).toBe('From another food database');
        expect(view.groups.at(-1)?.options[0]?.accessibleName).toBe('Garbanzo beans, raw, from another food database');
    });

    it('busy and unavailable sources each leave a note, in arrival order, before the loader', () => {
        const view = entryComboboxOf(
            input({ view: viewOf([BOTH, sourceBusy('fdc', 1), sourceUnavailable('usda')], 'asking') }),
            COPY,
        );

        expect(linesOf(view.trailingStatus)).toEqual([
            'We couldn’t search FDC Branded just now. Try again later.',
            'We didn’t hear back from USDA. Edit your search to try again.',
            '[loading] Still searching other food databases',
        ]);
    });

    // P6: "One budget covers every source, so one note says it once", at the clock time item 10 rounds up to.
    it('the cook’s limit is one note for every source it skipped, with the minute it ends', () => {
        const times: number[] = [];
        const view = entryComboboxOf(
            input({
                view: viewOf([BOTH, sourceLimited('usda', 90_000), sourceLimited('fdc', 90_000), COMPLETE_FRAME]),
                formatTime: (epochMs) => {
                    times.push(epochMs);

                    return '3:05 PM';
                },
            }),
            COPY,
        );

        expect(linesOf(view.trailingStatus)).toEqual([
            'You’ve reached your limit for food lookups until 3:05 PM, so we didn’t search USDA and FDC Branded.',
        ]);
        expect(times).toEqual([120_000]);
    });
});

describe('entryComboboxOf — the end of the answer (P1, P3, P6)', () => {
    it('complete: the loader goes, and Create joins `Not listed?` when no remote group shows', () => {
        const view = entryComboboxOf(input({ view: viewOf([BOTH, COMPLETE_FRAME]), offersCreateOwnFood: true }), COPY);

        expect(labelsOf(view).at(-1)).toEqual({ group: 'Not listed?', options: [FIND, USE, CREATE] });
        expect(view.trailingStatus).toEqual([]);
    });

    it('complete with remote foods: Create stands under `None of these?`, after the remote groups', () => {
        const view = entryComboboxOf(
            input({
                view: viewOf([BOTH, sourceAnswered('usda', GARBANZO), COMPLETE_FRAME]),
                offersCreateOwnFood: true,
            }),
            COPY,
        );

        expect(labelsOf(view).slice(2)).toEqual([
            NOT_LISTED,
            { group: 'From USDA', options: ['Garbanzo beans, raw'] },
            { group: 'None of these?', options: [CREATE] },
        ]);
    });

    it('Create is named as opening a form, and starts with its visible text (P11, 2.5.3)', () => {
        const view = entryComboboxOf(input({ offersCreateOwnFood: true }), COPY);

        expect(view.groups.at(-1)?.options.at(-1)).toEqual({
            key: 'createOwnFood',
            label: CREATE,
            accessibleName: 'Create my own food, opens a form',
        });
    });

    it('Create does not arrive while the answer runs (P1)', () => {
        const view = entryComboboxOf(
            input({ view: viewOf([BOTH, sourceAnswered('usda', GARBANZO)], 'asking'), offersCreateOwnFood: true }),
            COPY,
        );

        expect(view.groups.flatMap((group) => group.options).map((option) => option.key)).not.toContain(
            'createOwnFood',
        );
    });

    it('incomplete: what arrived stays, the loader goes, the `incomplete` note shows last, and Create arrives', () => {
        const view = entryComboboxOf(
            input({ view: viewOf([BOTH, sourceBusy('fdc', 1)]), offersCreateOwnFood: true }),
            COPY,
        );

        expect(linesOf(view.trailingStatus)).toEqual([
            'We couldn’t search FDC Branded just now. Try again later.',
            shared.ingredientRemoteSearch.incomplete,
        ]);
        expect(labelsOf(view).at(-1)).toEqual({ group: 'Not listed?', options: [FIND, USE, CREATE] });
    });

    it('a row’s list never offers Create (item 1, O3)', () => {
        const view = entryComboboxOf(input({ offersCreateOwnFood: false }), COPY);

        expect(view.groups.flatMap((group) => group.options).map((option) => option.key)).not.toContain(
            'createOwnFood',
        );
    });
});

describe('entryComboboxOf — when the count is spoken (P7)', () => {
    it('fast path: one announcement at the end, the total count, then each unavailable sentence and each note', () => {
        const view = entryComboboxOf(
            input({
                view: viewOf([
                    databaseFrame({ authored: 'unavailable', catalog: [DRY] }),
                    sourceAnswered('usda', GARBANZO),
                    sourceBusy('fdc', 1),
                    COMPLETE_FRAME,
                ]),
            }),
            COPY,
        );

        expect(view.countAnnouncement).toBe(
            `2 foods found ${form.ingredientAuthoredUnavailable} We couldn’t search FDC Branded just now. Try again later.`,
        );
    });

    it('fast path with no food anywhere: the database’s `no match`', () => {
        const view = entryComboboxOf(input({ view: viewOf([databaseFrame(), COMPLETE_FRAME]) }), COPY);

        expect(view.countAnnouncement).toBe(NO_MATCH);
    });

    it('one food is counted in the singular', () => {
        const view = entryComboboxOf(
            input({ view: viewOf([databaseFrame({ catalog: [DRY] }), COMPLETE_FRAME]) }),
            COPY,
        );

        expect(view.countAnnouncement).toBe('1 food found');
    });

    it('slow path, at the guard: the database part, then that it is still searching', () => {
        const view = entryComboboxOf(input({ view: viewOf([BOTH], 'asking'), databaseSaidEarly: true }), COPY);

        expect(view.countAnnouncement).toBe('2 foods found Still searching other food databases');
    });

    it('slow path, at the end: each source that added foods, then each note', () => {
        const view = entryComboboxOf(
            input({
                view: viewOf([
                    BOTH,
                    sourceAnswered('usda', GARBANZO, remoteItem('Garbanzo flour', 'sealed.f')),
                    sourceAnswered('fdc', remoteItem('Chickpeas, canned', 'sealed.c')),
                    sourceUnavailable('cnf'),
                    COMPLETE_FRAME,
                ]),
                databaseSaidEarly: true,
            }),
            COPY,
        );

        expect(view.countAnnouncement).toBe(
            '2 more foods from USDA 1 more food from FDC Branded We didn’t hear back from another food database. Edit your search to try again.',
        );
    });

    it('slow path, at the end, with nothing added and no failure: `No more foods found.`', () => {
        const view = entryComboboxOf(
            input({ view: viewOf([BOTH, sourceAnswered('usda'), COMPLETE_FRAME]), databaseSaidEarly: true }),
            COPY,
        );

        expect(view.countAnnouncement).toBe('No more foods found.');
    });
});

describe('entryComboboxOf — how an option reads (L4, P5)', () => {
    it('a catalog result that carries a variant draws its parts, and its name adds them (§S2)', () => {
        const brisket = {
            ...catalogResult('food_brisket', 'beef brisket'),
            variant: {
                id: 'var_brisket',
                parts: [
                    { attribute: 'cut' as const, text: 'flat half' },
                    { attribute: 'grade' as const, text: 'choice' },
                ],
            },
        };
        const view = entryComboboxOf(input({ view: viewOf([databaseFrame({ catalog: [brisket] })]) }), COPY);

        expect(view.groups[0]?.options[0]).toMatchObject({
            label: 'beef brisket',
            detailParts: ['flat half', 'choice'],
            accessibleName: 'beef brisket, flat half, choice',
        });
    });

    it('a catalog result with no variant reads as its name alone', () => {
        const view = entryComboboxOf(input({ view: viewOf([databaseFrame({ catalog: [DRY] })]) }), COPY);

        expect(view.groups[0]?.options[0]).toEqual({ key: 'catalog:food_cp', label: 'Chickpeas, dry' });
    });

    it('the cook’s own food is named as theirs (L4.2)', () => {
        const view = entryComboboxOf(input({ view: viewOf([databaseFrame({ authored: [MINE] })]) }), COPY);

        expect(view.groups[0]?.options[0]).toEqual({
            key: 'authored:food_mine',
            label: 'Chickpeas, home cooked',
            accessibleName: 'Chickpeas, home cooked, your food',
        });
    });

    // The contract has no tag since V3-5, so "no tag" is the option holding nothing beyond its key and its two names.
    it('a remote hit has no detail line and nothing shown beyond its name (P5, R64)', () => {
        const view = entryComboboxOf(input({ view: viewOf([BOTH, sourceAnswered('usda', GARBANZO)]) }), COPY);
        const [hit] = view.groups.at(-1)?.options ?? [];

        expect(hit).toStrictEqual({
            key: 'remote:usda:sealed.g',
            label: 'Garbanzo beans, raw',
            accessibleName: 'Garbanzo beans, raw, from USDA',
        });
    });
});

describe('entryComboboxOf — the assertive channel (R3, R7)', () => {
    it('a pick that failed is said first, then any failure of the list, then the refusal', () => {
        const view = entryComboboxOf(
            input({ view: viewOf([]), pickFailure: 'We couldn’t add that.', refusal: 'Choose a food first.' }),
            COPY,
        );

        expect(view.alertAnnouncement).toBe(
            `We couldn’t add that. ${shared.ingredientPickerSearch.failed} Choose a food first.`,
        );
    });
});

describe('entryComboboxOf — what each option does', () => {
    it('decodes every option back to the pick it stands for', () => {
        const view = entryComboboxOf(
            input({
                view: viewOf([BOTH, sourceAnswered('usda', GARBANZO), COMPLETE_FRAME]),
                offersCreateOwnFood: true,
            }),
            COPY,
        );

        expect(view.optionFor('authored:food_mine')).toMatchObject({ kind: 'food', food: { group: 'authored' } });
        expect(view.optionFor('catalog:food_cp')).toMatchObject({ kind: 'food', food: { group: 'catalog' } });
        expect(view.optionFor('remote:usda:sealed.g')).toEqual({
            kind: 'remoteFood',
            food: { group: 'remote', source: 'usda', hit: GARBANZO },
        });
        expect(view.optionFor('more:findByName')).toEqual({ kind: 'findByName' });
        expect(view.optionFor('more:useAsWritten')).toEqual({ kind: 'useAsWritten' });
        expect(view.optionFor('createOwnFood')).toEqual({ kind: 'createOwnFood' });
    });

    it('decodes nothing for a key it did not list', () => {
        expect(entryComboboxOf(input(), COPY).optionFor('remote:usda:nope')).toBeUndefined();
    });

    it('keys every option uniquely, even when two sources hold one name', () => {
        const view = entryComboboxOf(
            input({
                view: viewOf([
                    databaseFrame({ authored: [authoredResult('x', 'Egg')], catalog: [catalogResult('x', 'Egg')] }),
                    sourceAnswered('usda', remoteItem('Egg', 'sealed.1')),
                    sourceAnswered('fdc', remoteItem('Egg', 'sealed.2')),
                ]),
            }),
            COPY,
        );
        const keys = view.groups.flatMap((group) => group.options).map((option) => option.key);

        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe('entryComboboxOf — properties over every state', () => {
    const states: readonly [string, EntrySearchView][] = [
        ['idle', { kind: 'idle' }],
        ['too short', { kind: 'tooShort', minimum: 3 }],
        ['searching', viewOf([], 'asking')],
        ['offline', { kind: 'offline' }],
        ['failed', viewOf([])],
        ['running', viewOf([BOTH, sourceAnswered('usda', GARBANZO)], 'asking')],
        ['complete', viewOf([BOTH, sourceBusy('fdc', 1), COMPLETE_FRAME])],
    ];

    it.each(states)('an inactive field lists and says nothing while %s', (_case, view) => {
        const silent = entryComboboxOf(input({ active: false, view }), COPY);

        expect(silent.groups).toEqual([]);
        expect(silent.status).toBeUndefined();
        expect(silent.trailingStatus).toEqual([]);
        expect(silent.countAnnouncement).toBe('');
        expect(silent.alertAnnouncement).toBe('');
    });
});
