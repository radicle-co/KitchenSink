/**
 * The adapter between the kept record's timer (ISO instants, `state`) and the reducer's timer (ms, `kind`). The label
 * is never stored (ADR-0094 section 2), so it is dropped on the way out and absent on the way in.
 */
import type { ActiveTimer } from '@kitchensink/cooking-core';
import { describe, expect, it } from 'vitest';

import { HOUR, iso, makeEnded, makePaused, makeTimer, T0, timerId } from '../__fixtures__/keptFixtures.js';
import { activeTimerOf, keptTimerOf } from '../keptTimerAdapter.js';
import { keptTimerSchema } from '../keptRecord.js';

const SHARED = {
    id: timerId(1),
    recipeId: 'r1',
    stepIndex: 3,
    stepDigest: 's1:0000000d',
    ordinal: 1,
    run: 1,
    durationMs: HOUR,
    origin: { kind: 'added' },
} as const;

describe('activeTimerOf', () => {
    it('reads a running timer: the end becomes ms, and there is no label', () => {
        expect(activeTimerOf(makeTimer())).toEqual({
            ...SHARED,
            kind: 'running',
            endsAt: T0 + HOUR,
            label: undefined,
        });
    });

    it("reads a paused timer with the time left (pausedAt is the record's own, not the reducer's)", () => {
        expect(activeTimerOf(makePaused({ remainingMs: 1234 }))).toEqual({
            ...SHARED,
            kind: 'paused',
            remainingMs: 1234,
            label: undefined,
        });
    });

    it('reads a ringing and an endedAway timer at the instant each ended', () => {
        expect(activeTimerOf(makeEnded('ringing', { endedAt: iso(T0 + 5) }))).toEqual({
            ...SHARED,
            kind: 'ringing',
            endedAt: T0 + 5,
            label: undefined,
        });
        expect(activeTimerOf(makeEnded('endedAway', { endedAt: iso(T0 + 7), announcedAt: iso(T0 + 9) }))).toEqual({
            ...SHARED,
            kind: 'endedAway',
            endedAt: T0 + 7,
            label: undefined,
        });
    });
});

describe('keptTimerOf', () => {
    const now = T0 + 10 * HOUR;
    const base = { ...SHARED, label: { kind: 'typed', text: 'secret roast' } } as const;

    it('writes each state as the record holds it, with the instants as ISO strings and no label', () => {
        const all: readonly ActiveTimer[] = [
            { ...base, kind: 'running', endsAt: T0 + HOUR },
            { ...base, kind: 'paused', remainingMs: 4321 },
            { ...base, kind: 'ringing', endedAt: T0 + 5 },
            { ...base, kind: 'endedAway', endedAt: T0 + 7 },
        ];

        for (const timer of all) {
            const written = keptTimerOf(timer, undefined, now);

            expect(keptTimerSchema.safeParse(written).success).toBe(true);
            expect(JSON.stringify(written)).not.toContain('secret roast');
        }

        expect(keptTimerOf(all[0], undefined, now)).toMatchObject({
            state: 'running',
            endsAt: iso(T0 + HOUR),
        });
        expect(keptTimerOf(all[3], undefined, now)).toMatchObject({
            state: 'endedAway',
            endedAt: iso(T0 + 7),
        });
    });

    it('pausedAt carries from a paused prior, and is the clock when there is none', () => {
        const paused: ActiveTimer = { ...base, kind: 'paused', remainingMs: 4321 };

        expect(keptTimerOf(paused, makePaused({ pausedAt: iso(T0 + 3) }), now)).toMatchObject({
            pausedAt: iso(T0 + 3),
        });
        expect(keptTimerOf(paused, makeTimer(), now)).toMatchObject({ pausedAt: iso(now) });
        expect(keptTimerOf(paused, undefined, now)).toMatchObject({ pausedAt: iso(now) });
    });

    it('announcedAt carries only from an endedAway prior of the same run', () => {
        const away: ActiveTimer = { ...base, kind: 'endedAway', endedAt: T0 + 7 };
        const prior = makeEnded('endedAway', { announcedAt: iso(T0 + 9) });

        expect(keptTimerOf(away, prior, now)).toMatchObject({ announcedAt: iso(T0 + 9) });
        expect(keptTimerOf({ ...away, run: 2 }, prior, now)).not.toHaveProperty('announcedAt');
        expect(keptTimerOf(away, makeEnded('ringing'), now)).not.toHaveProperty('announcedAt');
        expect(keptTimerOf(away, undefined, now)).not.toHaveProperty('announcedAt');
    });

    it('carries the origin both ways, so an offered timer is still offered after a round trip', () => {
        const offered = makeTimer({ origin: { kind: 'offer', lineIndex: null } });

        expect(activeTimerOf(offered)).toMatchObject({ origin: { kind: 'offer', lineIndex: null } });
        expect(keptTimerOf(activeTimerOf(offered), offered, now)).toMatchObject({
            origin: { kind: 'offer', lineIndex: null },
        });
    });

    it('round-trips a stored timer of each state', () => {
        const stored = [
            makeTimer(),
            makePaused({ pausedAt: iso(T0 + 3) }),
            makeEnded('ringing'),
            makeEnded('endedAway', { announcedAt: iso(T0 + 9) }),
        ];

        for (const timer of stored) {
            expect(keptTimerOf(activeTimerOf(timer), timer, now)).toEqual(timer);
        }
    });
});
