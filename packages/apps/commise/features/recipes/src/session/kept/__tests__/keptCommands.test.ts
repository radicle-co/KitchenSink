import { describe, expect, it } from 'vitest';

import {
    applyKeptCommand,
    lowestFreeOrdinal,
    snapshotForEnd,
    type KeptCommand,
    type KeptOutcome,
} from '../keptCommands.js';
import type { KeptDocument } from '../keptRecord.js';

import { HOUR, iso, makeCooking, makeDoc, makePage, makeTimer, T0, timerId } from './keptFixtures.js';

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

describe('absent-entry rule (KTD5)', () => {
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

describe('page ticks and R11a', () => {
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

    it('finish removes the entry and keeps the timers (S3 R12a)', () => {
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

describe('timer commands', () => {
    const running = makeTimer({ state: 'running', endsAt: iso(T0 + 2 * HOUR) });
    const doc = makeDoc({ timers: [running] });

    it('startTimer on an empty record adds the timer with ordinal 1', () => {
        const { ordinal: _o, ...fresh } = makeTimer();
        const next = applied(
            run(makeDoc(), {
                type: 'startTimer',
                timer: {
                    id: fresh.id,
                    recipeId: 'r1',
                    stepIndex: 3,
                    stepDigest: fresh.stepDigest,
                    endsAt: iso(T0 + HOUR),
                },
                stepDigests: STEPS,
            }),
        );

        expect(next.timers).toEqual([expect.objectContaining({ id: fresh.id, state: 'running', ordinal: 1 })]);
    });

    it('refuses a second timer while one is held and leaves the record (S3 one-timer rule; mutant: replaces)', () => {
        const outcome = run(doc, {
            type: 'startTimer',
            timer: {
                id: timerId(2),
                recipeId: 'r1',
                stepIndex: 3,
                stepDigest: running.stepDigest,
                endsAt: iso(T0 + HOUR),
            },
            stepDigests: STEPS,
        });

        expect(outcome).toEqual({ kind: 'refused', reason: 'timerLimit' });
    });

    it('pause stores the remaining time and pausedAt, resume restarts from now and clears pausedAt', () => {
        const paused = applied(
            run(doc, { type: 'pauseTimer', id: running.id, expect: { state: 'running', endsAt: running.endsAt } }),
        );

        expect(paused.timers[0]).toMatchObject({ state: 'paused', remainingMs: HOUR, pausedAt: NOW });
        expect(paused.timers[0]?.endsAt).toBeUndefined();

        const later = iso(T0 + 10 * HOUR);
        const resumed = applied(
            run(paused, { type: 'resumeTimer', id: running.id, expect: { state: 'paused' } }, later),
        );

        expect(resumed.timers[0]).toMatchObject({ state: 'running', endsAt: iso(T0 + 11 * HOUR) });
        expect(resumed.timers[0]?.pausedAt).toBeUndefined();
        expect(resumed.timers[0]?.remainingMs).toBeUndefined();
    });

    it('drops a command whose expectation no longer holds, or that names an unknown id', () => {
        expect(run(doc, { type: 'pauseTimer', id: running.id, expect: { state: 'paused' } })).toEqual({
            kind: 'unchanged',
        });
        expect(run(doc, { type: 'pauseTimer', id: running.id, expect: { state: 'running', endsAt: iso(T0) } })).toEqual(
            { kind: 'unchanged' },
        );
        expect(run(doc, { type: 'cancelTimer', id: timerId(9), expect: { state: 'running' } })).toEqual({
            kind: 'unchanged',
        });
    });

    it('qse-r2 2: pause and cancel act on the timer by id, never timers[0]', () => {
        const second = makeTimer({ id: timerId(2), recipeId: 'r2', endsAt: iso(T0 + 3 * HOUR) });
        const two = makeDoc({ timers: [running, second] });
        const paused = applied(run(two, { type: 'pauseTimer', id: second.id, expect: { state: 'running' } }));

        expect(paused.timers[0]).toEqual(running);
        expect(paused.timers[1]).toMatchObject({ id: second.id, state: 'paused' });

        const cancelled = applied(run(two, { type: 'cancelTimer', id: second.id, expect: { state: 'running' } }));

        expect(cancelled.timers).toEqual([running]);
    });
});

describe('lowestFreeOrdinal (S6 R2, B2)', () => {
    const held = (stepIndex: number, ordinal: number | undefined, state: 'running' | 'endedAway' = 'running') =>
        makeTimer({ id: timerId(ordinal ?? 9), recipeId: 'r1', stepIndex, ordinal, state });

    it('gives 2 when 1 and 3 are held on the step, and 1 on another step (mutant: from id order)', () => {
        const timers = [held(3, 1), held(3, 3)];

        expect(lowestFreeOrdinal(timers, 'r1', 3)).toBe(2);
        expect(lowestFreeOrdinal(timers, 'r1', 4)).toBe(1);
        expect(lowestFreeOrdinal(timers, 'other', 3)).toBe(1);
    });

    it('counts a timer in any state, and reads a missing ordinal as 1 (B2)', () => {
        expect(lowestFreeOrdinal([held(3, 1, 'endedAway'), held(3, 2)], 'r1', 3)).toBe(3);
        expect(lowestFreeOrdinal([held(3, undefined)], 'r1', 3)).toBe(2);
    });
});

describe('rebind (B1, B6, KTD7)', () => {
    const stepsNow = ['a', 'c', 'd', 'e'].map(digestOf);

    it('a timer follows its step when step b is deleted (B1)', () => {
        const doc = makeDoc({ timers: [makeTimer({ recipeId: 'r1', stepIndex: 2, stepDigest: digestOf('c') })] });
        const next = applied(run(doc, { type: 'rebind', recipeId: 'r1', stepDigests: stepsNow }));

        expect(next.timers[0]?.stepIndex).toBe(1);
    });

    it('a timer whose step has no single match keeps its clamped index and still exists', () => {
        const doc = makeDoc({ timers: [makeTimer({ recipeId: 'r1', stepIndex: 9, stepDigest: digestOf('gone') })] });
        const next = applied(run(doc, { type: 'rebind', recipeId: 'r1', stepDigests: stepsNow }));

        expect(next.timers[0]?.stepIndex).toBe(3);
    });

    it('with no steps (gone or noSteps) it changes nothing (redteam r3 c)', () => {
        const doc = makeDoc({ timers: [makeTimer({ recipeId: 'r1', stepIndex: 4, ordinal: 2 })] });

        expect(run(doc, { type: 'rebind', recipeId: 'r1', stepDigests: [] })).toEqual({ kind: 'unchanged' });
    });

    it('a moved timer takes the lowest free ordinal when another holds its number on the new step (B6)', () => {
        const held = makeTimer({ id: timerId(1), recipeId: 'r1', stepIndex: 1, stepDigest: digestOf('c'), ordinal: 1 });
        const moved = makeTimer({
            id: timerId(2),
            recipeId: 'r1',
            stepIndex: 2,
            stepDigest: digestOf('c'),
            ordinal: 1,
        });
        const next = applied(
            run(makeDoc({ timers: [held, moved] }), { type: 'rebind', recipeId: 'r1', stepDigests: stepsNow }),
        );

        expect(next.timers.map((t) => [t.stepIndex, t.ordinal])).toEqual([
            [1, 1],
            [1, 2],
        ]);
    });

    it('marks and line ticks move with their single step; one with no single match is dropped (KTD7)', () => {
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

describe('End then Undo (KTD13, r3-undo)', () => {
    const entry = makeCooking({ step: step(2), ticks: ['butter'], lastTouch: iso(T0) });
    const timer = makeTimer({ recipeId: 'r1', stepIndex: 2, stepDigest: step(2).digest, ordinal: 2 });
    const before = makeDoc({ entries: { r1: entry }, timers: [timer] });

    it('snapshotForEnd captures the entry and its timers, or nothing', () => {
        expect(snapshotForEnd(before, 'r1')).toEqual({ recipeId: 'r1', entry, timers: [timer] });
        expect(snapshotForEnd(before, 'nope')).toBeUndefined();
    });

    it('brings the entry and its timers back unchanged in one write', () => {
        const ended = applied(run(before, { type: 'endSession', recipeId: 'r1' }));
        const snapshot = snapshotForEnd(before, 'r1');

        if (snapshot === undefined) {
            throw new Error('no snapshot');
        }

        const back = applied(run(ended, { type: 'restoreSession', snapshot, stepDigests: STEPS }));

        expect(back.entries).toEqual(before.entries);
        expect(back.timers).toEqual(before.timers);
        expect(back.rev).toBe(ended.rev + 1);
    });

    it('is dropped when a cooking entry for the recipe now exists', () => {
        const snapshot = snapshotForEnd(before, 'r1');

        if (snapshot === undefined) {
            throw new Error('no snapshot');
        }

        expect(run(before, { type: 'restoreSession', snapshot, stepDigests: STEPS })).toEqual({ kind: 'unchanged' });
    });

    it('is refused whole when another timer was started in the window (po P24)', () => {
        const snapshot = snapshotForEnd(before, 'r1');
        const ended = applied(run(before, { type: 'endSession', recipeId: 'r1' }));
        const other = makeTimer({ id: timerId(5), recipeId: 'r2' });

        if (snapshot === undefined) {
            throw new Error('no snapshot');
        }

        expect(run({ ...ended, timers: [other] }, { type: 'restoreSession', snapshot, stepDigests: STEPS })).toEqual({
            kind: 'refused',
            reason: 'timerLimit',
        });
    });

    it('redteam r3 a: ticks made on the page entry in the window are merged, not overwritten', () => {
        const snapshot = snapshotForEnd(before, 'r1');
        const ended = applied(run(before, { type: 'endSession', recipeId: 'r1' }));
        const withPage = applied(run(ended, { type: 'tickPage', recipeId: 'r1', ingredientId: 'salt', ticked: true }));

        if (snapshot === undefined) {
            throw new Error('no snapshot');
        }

        const back = applied(run(withPage, { type: 'restoreSession', snapshot, stepDigests: STEPS }));

        expect(back.entries['r1']).toMatchObject({ kind: 'cooking', ticks: ['butter', 'salt'] });
    });

    it('redteam r3 c: with no steps (gone) the timer keeps its stepIndex and ordinal', () => {
        const snapshot = snapshotForEnd(before, 'r1');
        const ended = applied(run(before, { type: 'endSession', recipeId: 'r1' }));

        if (snapshot === undefined) {
            throw new Error('no snapshot');
        }

        const back = applied(run(ended, { type: 'restoreSession', snapshot, stepDigests: undefined }));

        expect(back.timers[0]).toMatchObject({ stepIndex: 2, ordinal: 2 });
    });
});

describe('prune (RT4)', () => {
    const old = iso(T0 - 25 * HOUR);

    it('removes an ended session with its timers and a 24 h-old page entry, keeps a live session, in one result', () => {
        const doc = makeDoc({
            entries: {
                ended: makeCooking({ lastTouch: old }),
                live: makeCooking(),
                stalePage: makePage({ lastTouch: old }),
            },
            timers: [
                makeTimer({
                    id: timerId(1),
                    recipeId: 'ended',
                    state: 'paused',
                    endsAt: undefined,
                    remainingMs: 1,
                    pausedAt: old,
                }),
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
