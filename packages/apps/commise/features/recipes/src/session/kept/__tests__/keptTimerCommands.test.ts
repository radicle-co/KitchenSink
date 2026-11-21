/**
 * The kept `timer` command and the limit on `restoreSession`. The command runs the cooking-core reducer on
 * the timers as just re-read, so the limit, the ordinals and the rematch have one owner and are read inside the
 * lock (ADR-0094 section 6). `restoreSession` re-admits an End's timers through the reducer's `readmit`, refused whole
 * at the limit.
 */
import { describe, expect, it } from 'vitest';

import { applyKeptCommand, snapshotForEnd, type KeptCommand, type KeptOutcome } from '../keptCommands.js';
import { activeTimerOf } from '../keptTimerAdapter.js';
import type { KeptDocument } from '../keptRecord.js';

import {
    HOUR,
    iso,
    makeCooking,
    makeDoc,
    makeEnded,
    makePaused,
    makeTimer,
    T0,
    timerId,
} from '../__fixtures__/keptFixtures.js';

const NOW = T0 + HOUR / 2;
const run = (doc: KeptDocument, command: KeptCommand): KeptOutcome => applyKeptCommand(doc, command, iso(NOW));

const applied = (outcome: KeptOutcome): KeptDocument => {
    if (outcome.kind !== 'applied') {
        throw new Error(`expected applied, got ${outcome.kind}`);
    }

    return outcome.doc;
};

const START = {
    kind: 'start',
    id: timerId(9),
    recipeId: 'r1',
    stepIndex: 3,
    stepDigest: 's1:0000000d',
    label: undefined,
    origin: { kind: 'offer', lineIndex: null },
    durationMs: 10 * 60_000,
    nowMs: NOW,
} as const;

describe('the kept timer command', () => {
    it('starts a timer in the record: running, with the end, the origin and no label', () => {
        const doc = applied(run(makeDoc(), { type: 'timer', command: { ...START, limit: 1 }, undo: undefined }));

        expect(doc.rev).toBe(2);
        expect(doc.timers).toEqual([
            {
                id: timerId(9),
                recipeId: 'r1',
                stepIndex: 3,
                stepDigest: 's1:0000000d',
                ordinal: 1,
                run: 1,
                durationMs: 10 * 60_000,
                origin: { kind: 'offer', lineIndex: null },
                state: 'running',
                endsAt: iso(NOW + 10 * 60_000),
            },
        ]);
    });

    // The limit is read from the document as just re-read, so a second start that finds the
    // first one stored is refused, and nothing is written for it.
    it('refuses a start at the limit, read from the document as re-read, and writes nothing', () => {
        const stored = makeDoc({ timers: [makeTimer({ id: timerId(1), endsAt: iso(NOW + HOUR) })] });
        const outcome = run(stored, { type: 'timer', command: { ...START, limit: 1 }, undo: undefined });

        expect(outcome).toEqual({ kind: 'refused', reason: 'limit' });
    });

    it('allows a start up to the limit, and gives it the lowest free ordinal on its step', () => {
        const stored = makeDoc({ timers: [makeTimer({ id: timerId(1), endsAt: iso(NOW + HOUR) })] });
        const doc = applied(run(stored, { type: 'timer', command: { ...START, limit: 2 }, undo: undefined }));

        expect(doc.timers.map((t) => [t.id, t.ordinal])).toEqual([
            [timerId(1), 1],
            [timerId(9), 2],
        ]);
    });

    it("counts the cook's held Undo when it numbers a start (the record does not hold the Undo)", () => {
        const held = { ...activeTimerOf(makePaused({ id: timerId(5), ordinal: 1 })) };

        if (held.kind !== 'paused') {
            throw new Error('expected a paused timer');
        }

        const doc = applied(run(makeDoc(), { type: 'timer', command: { ...START, limit: 5 }, undo: held }));

        expect(doc.timers[0]?.ordinal).toBe(2);
    });

    it('a pause keeps the instant the cook paused at, and pausedAt is that instant', () => {
        const stored = makeDoc({ timers: [makeTimer({ endsAt: iso(NOW + HOUR) })] });
        const doc = applied(
            run(stored, {
                type: 'timer',
                command: { kind: 'pause', id: timerId(1), run: 1, nowMs: NOW },
                undo: undefined,
            }),
        );

        expect(doc.timers[0]).toMatchObject({ state: 'paused', remainingMs: HOUR, pausedAt: iso(NOW) });
    });

    it('is unchanged when the command does nothing (a stale pause of a paused timer)', () => {
        const stored = makeDoc({ timers: [makePaused()] });

        expect(
            run(stored, {
                type: 'timer',
                command: { kind: 'pause', id: timerId(1), run: 1, nowMs: NOW },
                undo: undefined,
            }),
        ).toEqual({ kind: 'unchanged' });
    });

    it('settles first as the reducer does: a timer past its end is ringing in the record, with the event dropped', () => {
        const stored = makeDoc({ timers: [makeTimer({ endsAt: iso(NOW - 1000) })] });
        const doc = applied(run(stored, { type: 'timer', command: { kind: 'ring', nowMs: NOW }, undo: undefined }));

        expect(doc.timers[0]).toMatchObject({ state: 'ringing', endedAt: iso(NOW - 1000) });
    });

    it("keeps an endedAway timer's announcedAt through a command that does not touch it", () => {
        const away = makeEnded('endedAway', { announcedAt: iso(T0 + 5) });
        const stored = makeDoc({ timers: [away, makeTimer({ id: timerId(2), endsAt: iso(NOW + HOUR), ordinal: 2 })] });
        const doc = applied(
            run(stored, {
                type: 'timer',
                command: { kind: 'pause', id: timerId(2), run: 1, nowMs: NOW },
                undo: undefined,
            }),
        );

        expect(doc.timers[0]).toEqual(away);
    });

    // A timer whose recipe has no steps is not moved, so it keeps its step and ordinal.
    it('a rematch with no move for a timer keeps its step and ordinal (a recipe with no steps)', () => {
        const stored = makeDoc({ timers: [makeTimer({ stepIndex: 4, ordinal: 2 })] });

        expect(
            run(stored, { type: 'timer', command: { kind: 'rematch', moves: [], nowMs: NOW }, undo: undefined }),
        ).toEqual({ kind: 'unchanged' });
    });

    it('a rematch moves a timer to the step it matched, and keeps its digest and ordinal when free', () => {
        const stored = makeDoc({ timers: [makeTimer({ stepIndex: 3 })] });
        const doc = applied(
            run(stored, {
                type: 'timer',
                command: {
                    kind: 'rematch',
                    moves: [{ id: timerId(1), stepIndex: 1, stepDigest: 's1:00000001' }],
                    nowMs: NOW,
                },
                undo: undefined,
            }),
        );

        expect(doc.timers[0]).toMatchObject({ stepIndex: 1, stepDigest: 's1:00000001', ordinal: 1 });
    });

    it("does not touch the entries or other recipes' timers", () => {
        const stored = makeDoc({
            entries: { r1: makeCooking() },
            timers: [makeTimer({ recipeId: 'other', endsAt: iso(NOW + HOUR) })],
        });
        const doc = applied(run(stored, { type: 'timer', command: { ...START, limit: 5 }, undo: undefined }));

        expect(doc.entries).toEqual(stored.entries);
        expect(doc.timers[0]).toEqual(stored.timers[0]);
    });
});

describe('restoreSession, re-admitted through the reducer', () => {
    const entry = makeCooking();
    const ended = (timers: KeptDocument['timers']): ReturnType<typeof snapshotForEnd> =>
        snapshotForEnd(makeDoc({ entries: { r1: entry }, timers }), 'r1');
    const snapshotOf = (timers: KeptDocument['timers']) => {
        const snapshot = ended(timers);

        if (snapshot === undefined) {
            throw new Error('no snapshot');
        }

        return snapshot;
    };

    it('is refused whole past the limit: the entry does not come back either, and nothing is written', () => {
        const snapshot = snapshotOf([
            makeTimer({ id: timerId(1), endsAt: iso(NOW + HOUR) }),
            makePaused({ id: timerId(2), ordinal: 2 }),
        ]);
        const other = makeDoc({ timers: [makeTimer({ id: timerId(3), recipeId: 'other', endsAt: iso(NOW + HOUR) })] });

        expect(run(other, { type: 'restoreSession', snapshot, limit: 2 })).toEqual({
            kind: 'refused',
            reason: 'limit',
        });
    });

    it('is allowed exactly at the limit', () => {
        const snapshot = snapshotOf([makeTimer({ id: timerId(1), endsAt: iso(NOW + HOUR) })]);
        const other = makeDoc({
            timers: [makeTimer({ id: timerId(3), recipeId: 'other', stepIndex: 0, endsAt: iso(NOW + HOUR) })],
        });
        const back = applied(run(other, { type: 'restoreSession', snapshot, limit: 2 }));

        expect(back.entries['r1']).toEqual(entry);
        expect(back.timers.map((t) => t.id)).toEqual([timerId(3), timerId(1)]);
    });

    it('a timer past its end comes back ringing, at its own end', () => {
        const snapshot = snapshotOf([makeTimer({ id: timerId(1), endsAt: iso(NOW - 1000) })]);
        const back = applied(run(makeDoc(), { type: 'restoreSession', snapshot, limit: 10 }));

        expect(back.timers[0]).toMatchObject({ state: 'ringing', endedAt: iso(NOW - 1000) });
    });

    it('an ordinal that another timer now holds on the step is renumbered to the lowest free one', () => {
        const snapshot = snapshotOf([makeTimer({ id: timerId(1), ordinal: 1, endsAt: iso(NOW + HOUR) })]);
        const held = makeDoc({ timers: [makeTimer({ id: timerId(4), ordinal: 1, endsAt: iso(NOW + HOUR) })] });
        const back = applied(run(held, { type: 'restoreSession', snapshot, limit: 10 }));

        expect(back.timers.find((t) => t.id === timerId(1))?.ordinal).toBe(2);
    });

    it('keeps announcedAt of an endedAway timer it brings back', () => {
        const away = makeEnded('endedAway', { announcedAt: iso(T0 + 5) });
        const back = applied(run(makeDoc(), { type: 'restoreSession', snapshot: snapshotOf([away]), limit: 10 }));

        expect(back.timers[0]).toEqual(away);
    });
});
