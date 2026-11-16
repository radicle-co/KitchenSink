/**
 * The v1 record is a one-way door (ADR 0094 section 2), so its bytes are frozen here by a literal written by hand. A
 * rename that the writer and the reader share would pass a round trip, and only this test catches it. A second test
 * classifies every timer field by where its value comes from (staff S63), so a new field fails until someone decides.
 */
import { describe, expect, it } from 'vitest';

import { parseKeptDocument, serializeKeptDocument, type KeptDocument } from '../keptRecord.js';

import { makeEnded, makePaused, makeTimer, timerId } from '../__fixtures__/keptFixtures.js';

const GOLDEN_V1 =
    '{"v":1,"rev":7,"entries":{"r1":{"kind":"cooking","step":{"index":2,"digest":"s1:0000000c"},' +
    '"marks":[{"index":0,"digest":"s1:0000000a"}],"lineTicks":[{"stepIndex":1,"stepDigest":"s1:0000000b","lineIndex":3}],' +
    '"ticks":["salt"],"servings":4,"lastTouch":"2026-06-01T12:00:00.123Z"},' +
    '"r2":{"kind":"page","ticks":["oil"],"lastTouch":"2026-06-01T12:00:00.000Z"}},' +
    '"timers":[' +
    '{"id":"01890a5d-ac96-774b-8cb9-b22e1d4a0001","recipeId":"r1","stepIndex":2,"stepDigest":"s1:0000000c",' +
    '"ordinal":1,"run":1,"durationMs":5400000,"state":"running","endsAt":"2026-06-01T13:30:00.250Z"},' +
    '{"id":"01890a5d-ac96-774b-8cb9-b22e1d4a0002","recipeId":"r1","stepIndex":2,"stepDigest":"s1:0000000c",' +
    '"ordinal":2,"run":3,"durationMs":600000,"state":"paused","remainingMs":123456,' +
    '"pausedAt":"2026-06-01T12:05:00.500Z"},' +
    '{"id":"01890a5d-ac96-774b-8cb9-b22e1d4a0003","recipeId":"r2","stepIndex":0,"stepDigest":"s1:0000000a",' +
    '"ordinal":1,"run":2,"durationMs":5000,"state":"ringing","endedAt":"2026-06-01T12:00:05.001Z"},' +
    '{"id":"01890a5d-ac96-774b-8cb9-b22e1d4a0004","recipeId":"r2","stepIndex":1,"stepDigest":"s1:0000000b",' +
    '"ordinal":2,"run":1,"durationMs":86400000,"state":"endedAway","endedAt":"2026-06-02T12:00:00.000Z",' +
    '"announcedAt":"2026-06-02T12:30:00.999Z"}]}';

const EXPECTED_V1: KeptDocument = {
    v: 1,
    rev: 7,
    entries: {
        r1: {
            kind: 'cooking',
            step: { index: 2, digest: 's1:0000000c' },
            marks: [{ index: 0, digest: 's1:0000000a' }],
            lineTicks: [{ stepIndex: 1, stepDigest: 's1:0000000b', lineIndex: 3 }],
            ticks: ['salt'],
            servings: 4,
            lastTouch: '2026-06-01T12:00:00.123Z',
        },
        r2: { kind: 'page', ticks: ['oil'], lastTouch: '2026-06-01T12:00:00.000Z' },
    },
    timers: [
        {
            id: timerId(1),
            recipeId: 'r1',
            stepIndex: 2,
            stepDigest: 's1:0000000c',
            ordinal: 1,
            run: 1,
            durationMs: 5_400_000,
            state: 'running',
            endsAt: '2026-06-01T13:30:00.250Z',
        },
        {
            id: timerId(2),
            recipeId: 'r1',
            stepIndex: 2,
            stepDigest: 's1:0000000c',
            ordinal: 2,
            run: 3,
            durationMs: 600_000,
            state: 'paused',
            remainingMs: 123_456,
            pausedAt: '2026-06-01T12:05:00.500Z',
        },
        {
            id: timerId(3),
            recipeId: 'r2',
            stepIndex: 0,
            stepDigest: 's1:0000000a',
            ordinal: 1,
            run: 2,
            durationMs: 5_000,
            state: 'ringing',
            endedAt: '2026-06-01T12:00:05.001Z',
        },
        {
            id: timerId(4),
            recipeId: 'r2',
            stepIndex: 1,
            stepDigest: 's1:0000000b',
            ordinal: 2,
            run: 1,
            durationMs: 86_400_000,
            state: 'endedAway',
            endedAt: '2026-06-02T12:00:00.000Z',
            announcedAt: '2026-06-02T12:30:00.999Z',
        },
    ],
};

describe('the v1 kept record, frozen', () => {
    it('reads the hand-written literal as the expected document, with nothing dropped', () => {
        expect(parseKeptDocument(GOLDEN_V1)).toEqual({ kind: 'ok', doc: EXPECTED_V1, droppedTimerIds: [] });
    });

    it('writes the expected document as the literal, byte for byte (field names and order)', () => {
        expect(serializeKeptDocument(EXPECTED_V1)).toBe(GOLDEN_V1);
    });
});

/** Where a stored timer field gets its value (staff S63): the reducer, the record alone, or nowhere. */
const COMMON = ['id', 'recipeId', 'stepIndex', 'stepDigest', 'ordinal', 'run', 'durationMs', 'state'] as const;

const FIELD_SOURCES = {
    running: { reducer: [...COMMON, 'endsAt'], recordOnly: [] },
    paused: { reducer: [...COMMON, 'remainingMs'], recordOnly: ['pausedAt'] },
    ringing: { reducer: [...COMMON, 'endedAt'], recordOnly: [] },
    endedAway: { reducer: [...COMMON, 'endedAt'], recordOnly: ['announcedAt'] },
} as const;

/** The reducer holds these and the record does not: `name` has no stored label (R8a) and `undo` is held in memory. */
const NOT_STORED = ['name', 'undo'] as const;

describe('every v1 timer field has a classified source', () => {
    const everyField = {
        running: makeTimer(),
        paused: makePaused(),
        ringing: makeEnded('ringing'),
        endedAway: makeEnded('endedAway', { announcedAt: '2026-06-01T12:30:00.000Z' }),
    };

    it.each(Object.entries(everyField))('%s: its stored fields are exactly the classified ones', (state, timer) => {
        const sources = FIELD_SOURCES[state as keyof typeof FIELD_SOURCES];

        expect(Object.keys(timer).sort()).toEqual([...sources.reducer, ...sources.recordOnly].sort());
    });

    it('a field the reducer holds and the record does not is listed as not stored', () => {
        const stored = new Set<string>(Object.values(FIELD_SOURCES).flatMap((s) => [...s.reducer, ...s.recordOnly]));

        for (const name of NOT_STORED) {
            expect(stored.has(name)).toBe(false);
        }
    });

    // shortcut: a hand list of the reducer's fields as of #288 at 55f73e9f5, because cooking-core on this base is the
    // older reducer. T3 replaces it with `satisfies` over `keyof` each timer kind once #288 is on main, so a reducer
    // field with no v1 home then fails `tsc` and not only this test.
    const REDUCER_FIELDS = {
        running: [...COMMON.filter((f) => f !== 'state'), 'name', 'kind', 'endsAt'],
        paused: [...COMMON.filter((f) => f !== 'state'), 'name', 'kind', 'remainingMs'],
        ringing: [...COMMON.filter((f) => f !== 'state'), 'name', 'kind', 'endedAt'],
        endedAway: [...COMMON.filter((f) => f !== 'state'), 'name', 'kind', 'endedAt'],
    } as const;

    it.each(Object.entries(REDUCER_FIELDS))(
        '%s: every reducer field is stored, or listed as not stored (a reducer field with no v1 home fails here)',
        (state, fields) => {
            const sources = FIELD_SOURCES[state as keyof typeof FIELD_SOURCES];
            const stored = new Set<string>(sources.reducer.map((f) => (f === 'state' ? 'kind' : f)));
            const notStored = new Set<string>(NOT_STORED);
            const homeless = fields.filter((f) => !stored.has(f) && !notStored.has(f));

            expect(homeless).toEqual([]);
            // The other way: every field classified as the reducer's is a field the reducer holds.
            const held = new Set<string>(fields);

            expect(sources.reducer.map((f) => (f === 'state' ? 'kind' : f)).filter((f) => !held.has(f))).toEqual([]);
        },
    );
});
