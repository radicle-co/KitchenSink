import { describe, expect, it } from 'vitest';

import { applyKeptCommand, snapshotForEnd, type KeptCommand, type KeptOutcome } from '../keptCommands.js';
import type { KeptDocument } from '../keptRecord.js';

import {
    HOUR,
    iso,
    makeCooking,
    makeDoc,
    makePage,
    makePaused,
    makeTimer,
    T0,
    timerId,
} from '../__fixtures__/keptFixtures.js';

const NOW = iso(T0 + HOUR);
const digestOf = (n: string): string => `s1:${n.padStart(8, '0')}`;
const STEPS = ['a', 'b', 'c', 'd', 'e'].map(digestOf);
const step = (index: number) => ({ index, digest: STEPS[index] ?? digestOf('z') });

const run = (doc: KeptDocument, command: KeptCommand, now = NOW): KeptOutcome => applyKeptCommand(doc, command, now);

const applied = (outcome: KeptOutcome): KeptDocument => {
    if (outcome.kind !== 'applied') {
        throw new Error(`expected applied, got ${outcome.kind}`);
    }

    return outcome.doc;
};

describe('absent-entry rule (ADR-0094 section 6)', () => {
    const doc = makeDoc({ entries: { other: makeCooking() } });

    it.each<KeptCommand>([
        { type: 'setStep', recipeId: 'r1', step: step(1) },
        {
            type: 'tickLine',
            recipeId: 'r1',
            line: { stepIndex: 0, stepDigest: STEPS[0] ?? '', lineIndex: 0 },
            ticked: true,
        },
        { type: 'finish', recipeId: 'r1' },
    ])('$type on a recipe with no cooking entry changes nothing (mutant: applied to a stale copy)', (command) => {
        expect(run(doc, command)).toEqual({ kind: 'unchanged' });
        expect(run(makeDoc({ entries: { r1: makePage() } }), command)).toEqual({ kind: 'unchanged' });
    });

    it('tickPage on an absent entry creates a page entry; unticking nothing changes nothing', () => {
        const next = applied(run(doc, { type: 'tickPage', recipeId: 'r1', ingredientId: 'butter', ticked: true }));

        expect(next.entries['r1']).toEqual({ kind: 'page', ticks: ['butter'], lastTouch: NOW });
        expect(next.rev).toBe(doc.rev + 1);
        expect(run(doc, { type: 'tickPage', recipeId: 'r1', ingredientId: 'butter', ticked: false })).toEqual({
            kind: 'unchanged',
        });
    });
});

describe('page ticks', () => {
    it('ticks and unticks on a page entry and on a cooking entry, idempotently', () => {
        const page = makeDoc({ entries: { r1: makePage({ ticks: ['salt'] }) } });
        const ticked = applied(run(page, { type: 'tickPage', recipeId: 'r1', ingredientId: 'butter', ticked: true }));

        expect(ticked.entries['r1']).toMatchObject({ kind: 'page', ticks: ['salt', 'butter'] });
        expect(run(ticked, { type: 'tickPage', recipeId: 'r1', ingredientId: 'butter', ticked: true })).toEqual({
            kind: 'unchanged',
        });

        const cooking = makeDoc({ entries: { r1: makeCooking({ ticks: ['salt'] }) } });
        const off = applied(run(cooking, { type: 'tickPage', recipeId: 'r1', ingredientId: 'salt', ticked: false }));

        expect(off.entries['r1']).toMatchObject({ kind: 'cooking', ticks: [] });
    });

    it('finish of another recipe leaves a page entry (AE19)', () => {
        const doc = makeDoc({ entries: { r1: makePage({ ticks: ['salt'] }), r2: makeCooking() } });
        const next = applied(run(doc, { type: 'finish', recipeId: 'r2' }));

        expect(next.entries['r1']).toEqual(doc.entries['r1']);
        expect(next.entries['r2']).toBeUndefined();
    });
});

describe('startSession (r4)', () => {
    it('makes a session at the page step with the page ticks and servings (mutant: the start resets ticks)', () => {
        const doc = makeDoc({ entries: { r1: makePage({ ticks: ['salt'], servings: 6, pageStep: step(3) }) } });
        const next = applied(run(doc, { type: 'startSession', recipeId: 'r1', step: step(3) }));

        expect(next.entries['r1']).toEqual({
            kind: 'cooking',
            step: step(3),
            marks: [],
            lineTicks: [],
            ticks: ['salt'],
            servings: 6,
            lastTouch: NOW,
        });
    });

    it('makes a session at the given step from nothing', () => {
        const next = applied(run(makeDoc(), { type: 'startSession', recipeId: 'r1', step: step(0) }));

        expect(next.entries['r1']).toMatchObject({ kind: 'cooking', step: step(0), ticks: [] });
    });

    it('over a cooking entry joins it, writes nothing, and returns that entry step (mutant: overwrites)', () => {
        const doc = makeDoc({ entries: { r1: makeCooking({ step: step(3), ticks: ['butter'] }) } });
        const outcome = run(doc, { type: 'startSession', recipeId: 'r1', step: step(0) });

        expect(outcome).toEqual({ kind: 'joined', step: step(3) });
    });
});

describe('the two "Start from step 1" commands (qse r4)', () => {
    const doc = makeDoc({
        entries: { r1: makeCooking({ step: step(3), ticks: ['butter'], marks: [step(1)] }) },
        timers: [makeTimer({ recipeId: 'r1' })],
    });

    it('Resume reset: a new entry at step 1 with no marks or ticks, and the recipe timers end', () => {
        const next = applied(run(doc, { type: 'resetSession', recipeId: 'r1', step: step(0) }));

        expect(next.entries['r1']).toEqual({
            kind: 'cooking',
            step: step(0),
            marks: [],
            lineTicks: [],
            ticks: [],
            lastTouch: NOW,
        });
        expect(next.timers).toEqual([]);
    });

    it('Before you start: startSession at step 1 leaves the record as it was and returns step 4', () => {
        expect(run(doc, { type: 'startSession', recipeId: 'r1', step: step(0) })).toEqual({
            kind: 'joined',
            step: step(3),
        });
    });
});

describe('session commands', () => {
    const doc = makeDoc({ entries: { r1: makeCooking({ step: step(1) }) }, timers: [makeTimer({ recipeId: 'r1' })] });

    it('setStep moves the step and touches the entry; rev goes up by one', () => {
        const next = applied(run(doc, { type: 'setStep', recipeId: 'r1', step: step(2) }));

        expect(next.entries['r1']).toMatchObject({ step: step(2), lastTouch: NOW });
        expect(next.rev).toBe(doc.rev + 1);
    });

    it('tickLine ticks and unticks one line, idempotently', () => {
        const line = { stepIndex: 1, stepDigest: step(1).digest, lineIndex: 0 };
        const on = applied(run(doc, { type: 'tickLine', recipeId: 'r1', line, ticked: true }));

        expect(on.entries['r1']).toMatchObject({ lineTicks: [line] });
        expect(run(on, { type: 'tickLine', recipeId: 'r1', line, ticked: true })).toEqual({ kind: 'unchanged' });
        expect(applied(run(on, { type: 'tickLine', recipeId: 'r1', line, ticked: false })).entries['r1']).toMatchObject(
            {
                lineTicks: [],
            },
        );
    });

    it('finish removes the entry and keeps the timers (ADR-0094 section 2)', () => {
        const next = applied(run(doc, { type: 'finish', recipeId: 'r1' }));

        expect(next.entries['r1']).toBeUndefined();
        expect(next.timers).toEqual(doc.timers);
    });

    it("endSession removes the entry and its timers, not another recipe's", () => {
        const other = makeTimer({ id: timerId(2), recipeId: 'r2' });
        const next = applied(run({ ...doc, timers: [...doc.timers, other] }, { type: 'endSession', recipeId: 'r1' }));

        expect(next.entries['r1']).toBeUndefined();
        expect(next.timers).toEqual([other]);
    });
});

describe('rebind (ADR-0094 section 9)', () => {
    const stepsNow = ['a', 'c', 'd', 'e'].map(digestOf);

    it('with no steps (gone or noSteps) it changes nothing (redteam r3 c)', () => {
        const doc = makeDoc({ entries: { r1: makeCooking({ step: { index: 4, digest: digestOf('c') } }) } });

        expect(run(doc, { type: 'rebind', recipeId: 'r1', stepDigests: [] })).toEqual({ kind: 'unchanged' });
    });

    it('marks and line ticks move with their single step; one with no single match is dropped (ADR-0094 section 9)', () => {
        const entry = makeCooking({
            step: { index: 2, digest: digestOf('c') },
            marks: [
                { index: 2, digest: digestOf('c') },
                { index: 1, digest: digestOf('b') },
            ],
            lineTicks: [
                { stepIndex: 3, stepDigest: digestOf('d'), lineIndex: 1 },
                { stepIndex: 1, stepDigest: digestOf('b'), lineIndex: 0 },
            ],
        });
        const next = applied(
            run(makeDoc({ entries: { r1: entry } }), { type: 'rebind', recipeId: 'r1', stepDigests: stepsNow }),
        );

        expect(next.entries['r1']).toMatchObject({
            step: { index: 1, digest: digestOf('c') },
            marks: [{ index: 1, digest: digestOf('c') }],
            lineTicks: [{ stepIndex: 2, stepDigest: digestOf('d'), lineIndex: 1 }],
        });
    });
});

describe('End then Undo (ADR-0094 section 8)', () => {
    const entry = makeCooking({ step: step(2), ticks: ['butter'], lastTouch: iso(T0) });
    const timer = makeTimer({ recipeId: 'r1', stepIndex: 2, stepDigest: step(2).digest, ordinal: 2 });
    const before = makeDoc({ entries: { r1: entry }, timers: [timer] });

    it('snapshotForEnd captures the entry and its timers, or nothing', () => {
        expect(snapshotForEnd(before, 'r1')).toEqual({ recipeId: 'r1', entry, timers: [timer] });
        expect(snapshotForEnd(before, 'nope')).toBeUndefined();
        expect(snapshotForEnd(makeDoc({ entries: { r1: makePage() } }), 'r1')).toBeUndefined();
    });

    it('brings the entry and its timers back unchanged in one write', () => {
        const ended = applied(run(before, { type: 'endSession', recipeId: 'r1' }));
        const snapshot = snapshotForEnd(before, 'r1');

        if (snapshot === undefined) {
            throw new Error('no snapshot');
        }

        const back = applied(run(ended, { type: 'restoreSession', snapshot }));

        expect(back.entries).toEqual(before.entries);
        expect(back.timers).toEqual(before.timers);
        expect(back.rev).toBe(ended.rev + 1);
    });

    it('is dropped when a cooking entry for the recipe now exists', () => {
        const snapshot = snapshotForEnd(before, 'r1');

        if (snapshot === undefined) {
            throw new Error('no snapshot');
        }

        expect(run(before, { type: 'restoreSession', snapshot })).toEqual({ kind: 'unchanged' });
    });

    it('redteam r3 a: ticks made on the page entry in the window are merged, not overwritten', () => {
        const snapshot = snapshotForEnd(before, 'r1');
        const ended = applied(run(before, { type: 'endSession', recipeId: 'r1' }));
        const withPage = applied(run(ended, { type: 'tickPage', recipeId: 'r1', ingredientId: 'salt', ticked: true }));

        if (snapshot === undefined) {
            throw new Error('no snapshot');
        }

        const back = applied(run(withPage, { type: 'restoreSession', snapshot }));

        expect(back.entries['r1']).toMatchObject({ kind: 'cooking', ticks: ['butter', 'salt'] });
    });

    it.each([
        ['the page entry is newer, so its servings win', iso(T0 + HOUR), 6],
        ['the snapshot is newer, so its servings win', iso(T0 - HOUR), 4],
    ])('redteam r3 b: %s', (_name, pageTouch, expected) => {
        const snapshot = snapshotForEnd(
            makeDoc({ entries: { r1: makeCooking({ servings: 4, lastTouch: iso(T0) }) } }),
            'r1',
        );

        if (snapshot === undefined) {
            throw new Error('no snapshot');
        }

        const withPage = makeDoc({ entries: { r1: makePage({ servings: 6, lastTouch: pageTouch }) } });
        const back = applied(run(withPage, { type: 'restoreSession', snapshot }));

        expect(back.entries['r1']).toMatchObject({ kind: 'cooking', servings: expected });
    });
});

describe('prune', () => {
    const old = iso(T0 - 25 * HOUR);

    it('removes an ended session with its timers and a 24 h-old page entry, keeps a live session, in one result', () => {
        const doc = makeDoc({
            entries: {
                ended: makeCooking({ lastTouch: old }),
                live: makeCooking(),
                stalePage: makePage({ lastTouch: old }),
            },
            timers: [
                makePaused({ id: timerId(1), recipeId: 'ended', remainingMs: 1, pausedAt: old }),
                makeTimer({ id: timerId(2), recipeId: 'live', endsAt: iso(T0 + 5 * HOUR) }),
            ],
        });
        const next = applied(run(doc, { type: 'prune' }, iso(T0)));

        expect(Object.keys(next.entries)).toEqual(['live']);
        expect(next.timers.map((t) => t.id)).toEqual([timerId(2)]);
        expect(next.rev).toBe(doc.rev + 1);
    });

    it('removes a session-less timer 24 h after its end and nothing else; no change gives unchanged', () => {
        const gone = makeTimer({ recipeId: 'x', endsAt: old });
        const doc = makeDoc({ timers: [gone] });

        expect(applied(run(doc, { type: 'prune' }, iso(T0))).timers).toEqual([]);
        expect(run(makeDoc({ entries: { live: makeCooking() } }), { type: 'prune' }, iso(T0))).toEqual({
            kind: 'unchanged',
        });
    });
});
