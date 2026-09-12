/**
 * REWRITTEN for plan 002 S7.8: what the ingredient entry's food list shows, from the ONE progressive answer
 * (`docs/design/rowEditorOpenDecisions.md`, "S7 list contract" P1 to P6; ADR-0055 points 5 and 9). It replaces the S5
 * two halves and their one settle. L1 to L4 still govern the database part:
 *
 * - the database part settles once, at its frame: `Your foods` then `Food catalog`, each in food's order, each at most
 *   {@link FOOD_GROUP_CAP} foods, each failing on its own (L3), and a nameless food dropped (L4.3);
 * - each remote source then adds its part in the order its frame arrived, a group capped like the others;
 * - the answer is running until it ends: complete, incomplete (its body ended without `complete`, or the overall
 *   deadline), or failed when it ended with nothing arrived (P6);
 * - a read parked offline before it ran is offline, and the answer it resumes as remembers that (P1, P2);
 * - nothing already shown moves when a frame arrives (P2): checked over every prefix of {@link FRAME_SEQUENCES}.
 */
import { EMPTY_PROGRESSIVE_ANSWER, type ProgressiveAnswer } from '@kitchensink/food-service-client';
import { MIN_SEARCH_QUERY_LENGTH } from '@kitchensink/recipe-core/resolution/search-minimum';
import { describe, expect, it } from 'vitest';

import {
    COMPLETE_FRAME,
    FRAME_SEQUENCES,
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
import {
    FOOD_GROUP_CAP,
    entrySearchViewOf,
    foodPickOf,
    progressiveReadOf,
    remoteFoodsOf,
    remotePickOf,
    servedFoodsOf,
    type EntrySearchView,
    type ProgressiveRead,
    type ProgressiveReadFacts,
} from '../foodSuggestions.model.js';

/** Facts of a read that has not started, has no answer and has not run out of time, in a focused app. */
const facts = (over: Partial<ProgressiveReadFacts> = {}): ProgressiveReadFacts => ({
    data: undefined,
    status: 'pending',
    fetchStatus: 'idle',
    databaseExpired: false,
    overallExpired: false,
    appIsFocused: true,
    resumed: false,
    ...over,
});

const DATABASE = databaseFrame({ catalog: [catalogResult('c1')] });

describe('progressiveReadOf', () => {
    it('is parked when the read is held offline in a focused app', () => {
        expect(progressiveReadOf(facts({ fetchStatus: 'paused' }))).toStrictEqual({ kind: 'parked' });
    });

    // TanStack also holds a read for want of focus, and a backgrounded app is not offline.
    it('is still asking when the read is held in an app without focus', () => {
        expect(progressiveReadOf(facts({ fetchStatus: 'paused', appIsFocused: false }))).toStrictEqual({
            kind: 'asking',
            answer: EMPTY_PROGRESSIVE_ANSWER,
            resumed: false,
        });
    });

    // The deadlines do not run while parked, so a fired one never turns an offline read into a failure.
    it('stays parked even when a deadline reads as fired', () => {
        expect(
            progressiveReadOf(facts({ fetchStatus: 'paused', databaseExpired: true, overallExpired: true })),
        ).toStrictEqual({ kind: 'parked' });
    });

    it.each<[string, Partial<ProgressiveReadFacts>]>([
        ['before it starts', { fetchStatus: 'idle' }],
        ['while it fetches', { fetchStatus: 'fetching' }],
    ])('is asking %s, inside its deadlines', (_case, over) => {
        expect(progressiveReadOf(facts(over))).toStrictEqual({
            kind: 'asking',
            answer: EMPTY_PROGRESSIVE_ANSWER,
            resumed: false,
        });
    });

    it('is asking with the answer so far while frames still arrive', () => {
        const data = answerOf(DATABASE);

        expect(progressiveReadOf(facts({ data, status: 'success', fetchStatus: 'fetching' }))).toStrictEqual({
            kind: 'asking',
            answer: data,
            resumed: false,
        });
    });

    // P2: "At that deadline, with no database frame yet, the whole answer stops."
    it('has ended with nothing when the database deadline fires before the database frame', () => {
        expect(progressiveReadOf(facts({ fetchStatus: 'fetching', databaseExpired: true }))).toStrictEqual({
            kind: 'ended',
            answer: EMPTY_PROGRESSIVE_ANSWER,
            resumed: false,
        });
    });

    it('is not ended by the database deadline once the database frame is in', () => {
        const data = answerOf(DATABASE);

        expect(
            progressiveReadOf(facts({ data, status: 'success', fetchStatus: 'fetching', databaseExpired: true })),
        ).toMatchObject({ kind: 'asking' });
    });

    // P3: the loader always ends; what arrived stays.
    it('has ended with what arrived when the overall deadline fires', () => {
        const data = answerOf(DATABASE, sourceAnswered('usda', remoteItem('Egg, duck')));

        expect(
            progressiveReadOf(facts({ data, status: 'success', fetchStatus: 'fetching', overallExpired: true })),
        ).toStrictEqual({ kind: 'ended', answer: data, resumed: false });
    });

    it.each<[string, Partial<ProgressiveReadFacts>]>([
        ['completed', { data: answerOf(DATABASE, COMPLETE_FRAME), status: 'success' }],
        ['whose body ended without complete', { data: answerOf(DATABASE), status: 'success' }],
        ['whose body broke after a frame', { data: answerOf(DATABASE), status: 'error' }],
        ['that failed before any frame', { status: 'error' }],
    ])('has ended for a read %s', (_case, over) => {
        expect(progressiveReadOf(facts(over))).toStrictEqual({
            kind: 'ended',
            answer: over.data ?? EMPTY_PROGRESSIVE_ANSWER,
            resumed: false,
        });
    });

    it('carries whether the answer resumed from a parked read', () => {
        expect(progressiveReadOf(facts({ fetchStatus: 'fetching', resumed: true }))).toMatchObject({ resumed: true });
    });
});

/** The view of `read` for a settled, searchable text. */
const viewOf = (read: ProgressiveRead): EntrySearchView =>
    entrySearchViewOf({ trimmed: 'egg', debouncedTrimmed: 'egg', read });

const asking = (answer: ProgressiveAnswer, resumed = false): ProgressiveRead => ({ kind: 'asking', answer, resumed });
const ended = (answer: ProgressiveAnswer, resumed = false): ProgressiveRead => ({ kind: 'ended', answer, resumed });

describe('entrySearchViewOf — before a search runs', () => {
    const read = asking(answerOf(databaseFrame({ catalog: [catalogResult('c1')] })));

    it('is idle with nothing typed', () => {
        expect(entrySearchViewOf({ trimmed: '', debouncedTrimmed: '', read })).toStrictEqual({ kind: 'idle' });
    });

    it('is too short below the search minimum, and says what the minimum is', () => {
        expect(entrySearchViewOf({ trimmed: 'eg', debouncedTrimmed: 'eg', read })).toStrictEqual({
            kind: 'tooShort',
            minimum: MIN_SEARCH_QUERY_LENGTH,
        });
    });

    // Below the minimum no search will run, so waiting on the debounce would spin forever.
    it('is too short below the minimum even while the debounce lags', () => {
        expect(entrySearchViewOf({ trimmed: 'eg', debouncedTrimmed: 'egg', read })).toStrictEqual({
            kind: 'tooShort',
            minimum: MIN_SEARCH_QUERY_LENGTH,
        });
    });

    // P2: "A new text starts a new answer": the read is for the debounced text, so its foods are never shown for this one.
    it('is searching while the debounce lags, and never shows the previous text’s foods', () => {
        expect(entrySearchViewOf({ trimmed: 'eggs', debouncedTrimmed: 'egg', read })).toStrictEqual({
            kind: 'searching',
            resumed: false,
        });
    });

    it('is searching while the debounce lags, even with the read parked', () => {
        expect(entrySearchViewOf({ trimmed: 'eggs', debouncedTrimmed: 'egg', read: { kind: 'parked' } })).toStrictEqual(
            { kind: 'searching', resumed: false },
        );
    });
});

describe('entrySearchViewOf — the answer’s states (P6)', () => {
    it('is offline while the read is parked', () => {
        expect(viewOf({ kind: 'parked' })).toStrictEqual({ kind: 'offline' });
    });

    it.each([false, true])('is searching, resumed %s, while no database frame has arrived', (resumed) => {
        expect(viewOf(asking(EMPTY_PROGRESSIVE_ANSWER, resumed))).toStrictEqual({ kind: 'searching', resumed });
    });

    // P6: "Nothing arrived covers a transport error, a 5xx, a rate-limit refusal of the search itself, and the
    // database deadline."
    it.each([false, true])('has failed, resumed %s, when it ended with nothing arrived', (resumed) => {
        expect(viewOf(ended(EMPTY_PROGRESSIVE_ANSWER, resumed))).toStrictEqual({ kind: 'failed', resumed });
    });

    it('is served and running once the database frame is in and the answer still runs', () => {
        expect(viewOf(asking(answerOf(DATABASE)))).toMatchObject({ kind: 'served', progress: 'running' });
    });

    it('is served and complete once the complete frame is in', () => {
        expect(viewOf(ended(answerOf(DATABASE, COMPLETE_FRAME)))).toMatchObject({
            kind: 'served',
            progress: 'complete',
        });
    });

    it('is served and incomplete when it ended after the database frame without complete', () => {
        expect(viewOf(ended(answerOf(DATABASE)))).toMatchObject({ kind: 'served', progress: 'incomplete' });
    });

    it('remembers that a served answer resumed from a parked read', () => {
        expect(viewOf(asking(answerOf(DATABASE), true))).toMatchObject({ kind: 'served', resumed: true });
    });
});

describe('entrySearchViewOf — the database part (L1 to L4)', () => {
    it('serves both groups when both answered', () => {
        expect(
            viewOf(ended(answerOf(databaseFrame({ authored: [authoredResult('a')], catalog: [catalogResult('b')] })))),
        ).toMatchObject({
            database: {
                authored: { kind: 'answered', foods: [{ group: 'authored', hit: authoredResult('a') }] },
                catalog: { kind: 'answered', foods: [{ group: 'catalog', hit: catalogResult('b') }] },
            },
        });
    });

    it.each<['authored' | 'catalog']>([['authored'], ['catalog']])(
        'keeps the %s group unavailable, not empty, when it failed alone',
        (group) => {
            const frame = databaseFrame({ [group]: 'unavailable' });

            expect(viewOf(ended(answerOf(frame)))).toMatchObject({
                database: { [group]: { kind: 'unavailable' } },
            });
        },
    );

    it('keeps food’s order', () => {
        const view = viewOf(
            ended(answerOf(databaseFrame({ catalog: ['c', 'a', 'b'].map((id) => catalogResult(id)) }))),
        );

        expect(servedFoodsOf(view).map((option) => option.hit.id)).toStrictEqual(['c', 'a', 'b']);
    });

    it(`shows at most ${FOOD_GROUP_CAP} foods in each database group`, () => {
        const authored = Array.from({ length: 12 }, (_, index) => authoredResult(`a${index}`));
        const catalog = Array.from({ length: 12 }, (_, index) => catalogResult(`c${index}`));
        const view = viewOf(ended(answerOf(databaseFrame({ authored, catalog }))));

        expect(FOOD_GROUP_CAP).toBe(10);
        expect(servedFoodsOf(view).map((option) => option.hit.id)).toStrictEqual([
            ...authored.slice(0, 10).map((hit) => hit.id),
            ...catalog.slice(0, 10).map((hit) => hit.id),
        ]);
    });

    // L4.3: the schema allows a null name, and a nameless option has nothing to show or to say.
    it('drops a food with no name or a blank one before counting to the cap', () => {
        const catalog = [
            catalogResult('c0'),
            catalogResult('nameless', null),
            catalogResult('blank', '  '),
            ...Array.from({ length: 10 }, (_, index) => catalogResult(`c${index + 1}`)),
        ];
        const view = viewOf(ended(answerOf(databaseFrame({ catalog }))));

        expect(servedFoodsOf(view).map((option) => option.hit.id)).toStrictEqual([
            'c0',
            ...Array.from({ length: 9 }, (_, index) => `c${index + 1}`),
        ]);
    });
});

describe('entrySearchViewOf — each remote source’s part (P1, P4, P5)', () => {
    it('adds each source’s part in the order its frame arrived', () => {
        const view = viewOf(
            ended(
                answerOf(
                    DATABASE,
                    sourceUnavailable('cnf'),
                    sourceAnswered('usda', remoteItem('Egg, duck')),
                    sourceBusy('fdc', 5_000),
                    sourceLimited('nzfcd', 9_000),
                ),
            ),
        );

        expect(view).toMatchObject({
            remote: [
                { kind: 'unavailable', source: 'cnf' },
                {
                    kind: 'answered',
                    source: 'usda',
                    foods: [{ group: 'remote', source: 'usda', hit: remoteItem('Egg, duck') }],
                },
                { kind: 'busy', source: 'fdc' },
                { kind: 'limited', source: 'nzfcd', retryAt: 9_000 },
            ],
        });
    });

    // P4: "The client slices whatever a frame holds. So a larger page from a source cannot lengthen the list."
    it(`shows at most ${FOOD_GROUP_CAP} foods from each source, in the source’s order`, () => {
        const items = Array.from({ length: 14 }, (_, index) => remoteItem(`Egg ${index}`));
        const view = viewOf(ended(answerOf(DATABASE, sourceAnswered('usda', ...items))));

        expect(remoteFoodsOf(view).map((option) => option.hit.name)).toStrictEqual(
            items.slice(0, 10).map((item) => item.name),
        );
    });

    it('keeps a source that answered with no food as answered and empty', () => {
        expect(viewOf(ended(answerOf(DATABASE, sourceAnswered('usda'))))).toMatchObject({
            remote: [{ kind: 'answered', source: 'usda', foods: [] }],
        });
    });

    it('lists no remote food until the database part is in', () => {
        expect(remoteFoodsOf(viewOf(asking(EMPTY_PROGRESSIVE_ANSWER)))).toStrictEqual([]);
    });
});

/** Every option a served view lists, as its key, in the order the list shows them. */
const optionKeysOf = (view: EntrySearchView): readonly string[] => [
    ...servedFoodsOf(view).map((option) => `${option.group}:${option.hit.id}`),
    ...remoteFoodsOf(view).map((option) => `remote:${option.source}:${option.hit.reference}`),
];

// P2: "No frame moves an option that is on screen. Every frame adds at the end."
describe('entrySearchViewOf — nothing already shown moves when a frame arrives', () => {
    it.each(FRAME_SEQUENCES)('$name', ({ frames }) => {
        let shown: readonly string[] = [];

        frames.forEach((_frame, index) => {
            const next = optionKeysOf(viewOf(asking(answerOf(...frames.slice(0, index + 1)))));

            expect(next.slice(0, shown.length)).toStrictEqual(shown);
            shown = next;
        });
    });
});

describe('servedFoodsOf and remoteFoodsOf', () => {
    it('serves the database foods, the cook’s then the catalog’s, and the remote foods apart', () => {
        const view = viewOf(
            ended(
                answerOf(
                    databaseFrame({ authored: [authoredResult('a')], catalog: [catalogResult('b')] }),
                    sourceAnswered('usda', remoteItem('Egg, duck')),
                ),
            ),
        );

        expect(servedFoodsOf(view)).toStrictEqual([
            { group: 'authored', hit: authoredResult('a') },
            { group: 'catalog', hit: catalogResult('b') },
        ]);
        expect(remoteFoodsOf(view)).toStrictEqual([{ group: 'remote', source: 'usda', hit: remoteItem('Egg, duck') }]);
    });

    it.each<[string, EntrySearchView]>([
        ['searching', viewOf(asking(EMPTY_PROGRESSIVE_ANSWER))],
        ['offline', viewOf({ kind: 'parked' })],
        ['failed', viewOf(ended(EMPTY_PROGRESSIVE_ANSWER))],
        ['idle', entrySearchViewOf({ trimmed: '', debouncedTrimmed: '', read: { kind: 'parked' } })],
    ])('serves nothing while %s', (_case, view) => {
        expect(servedFoodsOf(view)).toStrictEqual([]);
        expect(remoteFoodsOf(view)).toStrictEqual([]);
    });
});

describe('foodPickOf', () => {
    it('picks one of the cook’s own foods by its id', () => {
        expect(foodPickOf({ group: 'authored', hit: { id: 'food_9', name: 'my egg', score: 1 } })).toStrictEqual({
            kind: 'catalogFood',
            foodId: 'food_9',
            name: 'my egg',
        });
    });

    it('picks a catalog root by its id when the result names no variant', () => {
        expect(foodPickOf({ group: 'catalog', hit: { id: 'food_1', name: 'egg', score: 1 } })).toStrictEqual({
            kind: 'catalogFood',
            foodId: 'food_1',
            name: 'egg',
        });
    });

    // §S2: picking a result binds the variant the search matched.
    it('binds the variant a catalog result names', () => {
        const hit = {
            id: 'food_1',
            name: 'beef brisket',
            score: 1,
            variant: { id: 'variant_7', parts: [{ attribute: 'cut' as const, text: 'flat' }] },
        };

        expect(foodPickOf({ group: 'catalog', hit })).toStrictEqual({
            kind: 'catalogVariant',
            foodVariantId: 'variant_7',
        });
    });
});

describe('remotePickOf', () => {
    // ADR-0055 point 10: a remote food is picked by the reference food issued, never the source's key.
    it('picks a remote food by its reference, with the name its root will carry and its source', () => {
        expect(
            remotePickOf({ group: 'remote', source: 'usda', hit: remoteItem('Egg, duck', 'sealed.1') }),
        ).toStrictEqual({ kind: 'remoteFood', reference: 'sealed.1', name: 'Egg, duck', source: 'usda' });
    });
});
