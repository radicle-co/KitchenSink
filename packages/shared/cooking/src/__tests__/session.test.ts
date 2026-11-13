import { describe, expect, it } from 'vitest';

import { isInvalidStepIndexError, isInvalidTotalStepsError } from '../errors.js';
import { advance, createSession, goBack, sessionStatus } from '../session.js';
import type { CookingSession } from '../types.js';

/**
 * The cooking session's step navigation (FR-032, FR-033): a pure reducer over `CookingSession`.
 *
 * Every assertion is written to fail if the logic is broken, not merely to execute it: boundary cases assert the
 * *whole* resulting session, purity is enforced with frozen inputs (a `push` into `completedSteps` throws rather than
 * quietly passing), and error cases assert the specific custom error via its type guard, because a bare `.toThrow()`
 * also passes against an unimplemented stub.
 */

/** A three-step session at step 0, deep-frozen so any in-place mutation raises a `TypeError`. */
function makeFrozenSession(overrides: Partial<CookingSession> = {}): CookingSession {
    const session: CookingSession = {
        ...createSession({ recipeId: 'recipe-01', totalSteps: 3, startedAt: '2026-08-09T10:00:00.000Z' }),
        ...overrides,
    };

    Object.freeze(session.completedSteps);

    return Object.freeze(session);
}

describe('session — createSession rejects an unusable step count', () => {
    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects totalSteps = %s', (totalSteps) => {
        let thrown: unknown;

        try {
            createSession({ recipeId: 'recipe-01', totalSteps, startedAt: '2026-08-09T10:00:00.000Z' });
        } catch (error) {
            thrown = error;
        }

        expect(isInvalidTotalStepsError(thrown)).toBe(true);
    });

    it('reports the offending value on the error', () => {
        let thrown: unknown;

        try {
            createSession({ recipeId: 'recipe-01', totalSteps: 0, startedAt: '2026-08-09T10:00:00.000Z' });
        } catch (error) {
            thrown = error;
        }

        expect(isInvalidStepIndexError(thrown)).toBe(false);
        expect(thrown).toMatchObject({ name: 'InvalidTotalStepsError', totalSteps: 0 });
    });
});

describe('session — createSession starts a session at the first step', () => {
    it('produces an empty session at step 0', () => {
        const session = createSession({
            recipeId: 'recipe-01',
            totalSteps: 5,
            startedAt: '2026-08-09T10:00:00.000Z',
        });

        expect(session).toStrictEqual({
            recipeId: 'recipe-01',
            startedAt: '2026-08-09T10:00:00.000Z',
            currentStepIndex: 0,
            completedSteps: [],
        });
    });
});

describe('session — totalSteps boundary values', () => {
    it('accepts the minimum valid count of 1', () => {
        const session = createSession({
            recipeId: 'recipe-01',
            totalSteps: 1,
            startedAt: '2026-08-09T10:00:00.000Z',
        });

        expect(session.currentStepIndex).toBe(0);
    });

    it('accepts a large count', () => {
        const session = createSession({
            recipeId: 'recipe-01',
            totalSteps: 200,
            startedAt: '2026-08-09T10:00:00.000Z',
        });

        expect(sessionStatus(session, 200)).toBe('idle');
    });
});

describe('session — advance moves forward and records the departed step', () => {
    it('moves to the next step and completes the one just left', () => {
        const advanced = advance(makeFrozenSession(), 3);

        expect(advanced.currentStepIndex).toBe(1);
        expect(advanced.completedSteps).toStrictEqual([0]);
    });

    it('accumulates completed steps across the whole recipe', () => {
        const atLast = advance(advance(makeFrozenSession(), 3), 3);

        expect(atLast.currentStepIndex).toBe(2);
        expect(atLast.completedSteps).toStrictEqual([0, 1]);
    });

    it('leaves every unrelated field untouched', () => {
        const advanced = advance(makeFrozenSession(), 3);

        expect(advanced.recipeId).toBe('recipe-01');
        expect(advanced.startedAt).toBe('2026-08-09T10:00:00.000Z');
    });

    it('rejects an unusable step count', () => {
        let thrown: unknown;

        try {
            advance(makeFrozenSession(), 0);
        } catch (error) {
            thrown = error;
        }

        expect(isInvalidTotalStepsError(thrown)).toBe(true);
    });
});

describe('session — advance clamps at the last step', () => {
    it('never produces an out-of-range index', () => {
        const atLast = advance(advance(makeFrozenSession(), 3), 3);

        const pastEnd = advance(atLast, 3);

        expect(pastEnd.currentStepIndex).toBe(2);
        expect(pastEnd.completedSteps).toStrictEqual([0, 1, 2]);
    });

    it('repeating the terminal advance changes nothing further', () => {
        const finished = advance(advance(advance(makeFrozenSession(), 3), 3), 3);

        const again = advance(finished, 3);

        expect(again).toStrictEqual(finished);
    });

    it('a single-step recipe completes without ever moving', () => {
        const session = createSession({
            recipeId: 'recipe-01',
            totalSteps: 1,
            startedAt: '2026-08-09T10:00:00.000Z',
        });

        const finished = advance(session, 1);

        expect(finished.currentStepIndex).toBe(0);
        expect(finished.completedSteps).toStrictEqual([0]);
    });

    it('clamps a restored index that the recipe no longer contains', () => {
        // The recipe shrank while the session was persisted; the index must land inside the new
        // range instead of walking further off the end.
        const stale = makeFrozenSession({ currentStepIndex: 7 });

        const advanced = advance(stale, 3);

        expect(advanced.currentStepIndex).toBe(2);
        expect(advanced.completedSteps).toStrictEqual([2]);
    });
});

describe('session — advance repairs a non-finite index', () => {
    it.each([Number.NaN, Number.POSITIVE_INFINITY])('treats index %s as the first step', (index) => {
        const advanced = advance(makeFrozenSession({ currentStepIndex: index }), 3);

        expect(advanced.currentStepIndex).toBe(1);
        expect(advanced.completedSteps).toStrictEqual([0]);
    });
});

describe('session — goBack clamps at the first step', () => {
    it('steps back one position', () => {
        const atSecond = advance(makeFrozenSession(), 3);

        expect(goBack(atSecond).currentStepIndex).toBe(0);
    });

    it('is a no-op at step 0 and keeps the session intact', () => {
        const session = makeFrozenSession();

        expect(goBack(session)).toStrictEqual(session);
    });

    it('never loses the place — completed steps survive going back (FR-033)', () => {
        const atLast = advance(advance(makeFrozenSession(), 3), 3);

        const back = goBack(atLast);

        expect(back.currentStepIndex).toBe(1);
        expect(back.completedSteps).toStrictEqual([0, 1]);
    });

    it('repairs a corrupt negative index rather than propagating it', () => {
        const corrupt = makeFrozenSession({ currentStepIndex: -4 });

        expect(goBack(corrupt).currentStepIndex).toBe(0);
    });
});

describe('session — completedSteps never contains duplicates', () => {
    it('advancing, going back and advancing again records the step once', () => {
        const bounced = advance(goBack(advance(makeFrozenSession(), 3)), 3);

        expect(bounced.completedSteps).toStrictEqual([0]);
        expect(bounced.currentStepIndex).toBe(1);
    });

    it('a long bounce over two steps still records each exactly once', () => {
        let session = makeFrozenSession();
        session = advance(session, 3);
        session = advance(session, 3);
        session = goBack(session);
        session = goBack(session);
        session = advance(session, 3);
        session = advance(session, 3);

        expect(session.completedSteps).toStrictEqual([0, 1]);
        expect(new Set(session.completedSteps).size).toBe(session.completedSteps.length);
    });
});

describe('session — sessionStatus derives the statechart position', () => {
    it('a fresh session is idle', () => {
        expect(sessionStatus(makeFrozenSession(), 3)).toBe('idle');
    });

    it('a session with progress is cooking', () => {
        expect(sessionStatus(advance(makeFrozenSession(), 3), 3)).toBe('cooking');
    });

    it('returning to step 0 with work behind it is cooking, not idle', () => {
        // Position alone must not decide the status: this session sits at index 0 exactly like a
        // fresh one, and only `completedSteps` distinguishes them.
        const back = goBack(advance(makeFrozenSession(), 3));

        expect(back.currentStepIndex).toBe(0);
        expect(sessionStatus(back, 3)).toBe('cooking');
    });

    it('advancing through every step completes the session', () => {
        const finished = advance(advance(advance(makeFrozenSession(), 3), 3), 3);

        expect(sessionStatus(finished, 3)).toBe('complete');
    });

    it('reaching the last step is not yet complete', () => {
        const atLast = advance(advance(makeFrozenSession(), 3), 3);

        expect(atLast.currentStepIndex).toBe(2);
        expect(sessionStatus(atLast, 3)).toBe('cooking');
    });

    it('reviewing an earlier step after finishing stays complete', () => {
        const finished = advance(advance(advance(makeFrozenSession(), 3), 3), 3);

        expect(sessionStatus(goBack(finished), 3)).toBe('complete');
    });

    it('a session away from step 0 with nothing completed is cooking, not idle', () => {
        expect(sessionStatus(makeFrozenSession({ currentStepIndex: 2 }), 3)).toBe('cooking');
    });

    it('a partially completed set is not complete', () => {
        const partial = makeFrozenSession({ currentStepIndex: 2, completedSteps: [0, 2] });

        expect(sessionStatus(partial, 3)).toBe('cooking');
    });

    it('completed steps left over from a longer recipe do not fake completion', () => {
        // The recipe grew from 3 to 5 steps between sessions; the old completions must not be read
        // as "the whole recipe is done".
        const stale = makeFrozenSession({ currentStepIndex: 2, completedSteps: [0, 1, 2] });

        expect(sessionStatus(stale, 5)).toBe('cooking');
    });

    it('rejects an unusable step count', () => {
        let thrown: unknown;

        try {
            sessionStatus(makeFrozenSession(), -1);
        } catch (error) {
            thrown = error;
        }

        expect(isInvalidTotalStepsError(thrown)).toBe(true);
    });
});

describe('session — every transition is pure', () => {
    it('no operation mutates the session it was given', () => {
        const session = advance(makeFrozenSession(), 3);
        Object.freeze(session.completedSteps);
        Object.freeze(session);
        const before = structuredClone(session);

        advance(session, 3);
        goBack(session);
        sessionStatus(session, 3);

        expect(session).toStrictEqual(before);
    });

    it('every transition returns a new object, never the input', () => {
        const session = makeFrozenSession();

        expect(advance(session, 3)).not.toBe(session);
        expect(goBack(session)).not.toBe(session);
    });

    it('the completed-step array is copied, so the new session cannot corrupt the old', () => {
        const session = advance(makeFrozenSession(), 3);

        const next = advance(session, 3);

        expect(next.completedSteps).not.toBe(session.completedSteps);
        expect(session.completedSteps).toStrictEqual([0]);
    });
});

describe('session — a session survives a JSON round trip', () => {
    it('a mid-navigation session is deep-equal after persist and restore', () => {
        const midway = goBack(advance(advance(makeFrozenSession(), 3), 3));

        const restored: CookingSession = JSON.parse(JSON.stringify(midway));

        expect(restored).toStrictEqual(midway);
    });

    it('navigation continues correctly from a restored session', () => {
        const midway = advance(makeFrozenSession(), 3);
        const restored: CookingSession = JSON.parse(JSON.stringify(midway));

        const advanced = advance(restored, 3);

        expect(advanced.currentStepIndex).toBe(2);
        expect(advanced.completedSteps).toStrictEqual([0, 1]);
    });
});
