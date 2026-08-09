import { describe, expect, it } from 'vitest';

import {
    advance,
    createSession,
    goBack,
    goToStep,
    isInvalidStepIndexError,
    isInvalidTotalStepsError,
    pause,
    resume,
    sessionStatus,
} from '../session.js';
import type { CookingSession } from '../types.js';

/**
 * T-002 / MOD-004 — cooking session state machine and step navigation (FR-032, FR-033 /
 * REQ-001..003, REQ-008..010).
 *
 * The V-Model unit-test plan for MOD-004 was written against a stateful, callback-emitting class
 * (`initialise` / `goNext` / `goPrev` / `onStepChange`). The shipped module is a **pure reducer**
 * over `CookingSession`, so the scenario ids below carry the plan's letters where the intent is
 * genuinely the same (A invalid `totalSteps`, B index clamping, C last-step clamp, D first-step
 * clamp, E normal navigation, G state transitions, H `totalSteps` BVA) and add I..M for the
 * behaviour the class-shaped plan had no equivalent of (validated jumps, the no-duplicate property,
 * purity, JSON round-trip, derived status). UTP-004-F (unsubscribe) has no analogue and is dropped —
 * a pure function emits nothing.
 *
 * Every assertion is written to fail if the logic is broken, not merely to execute it: boundary
 * cases assert the *whole* resulting session, purity is enforced with frozen inputs (a `push` into
 * `completedSteps` throws rather than quietly passing), and error cases assert the specific custom
 * error via its type guard, because a bare `.toThrow()` also passes against an unimplemented stub.
 */

/** A three-step session at step 0, deep-frozen so any in-place mutation raises a `TypeError`. */
function makeFrozenSession(overrides: Partial<CookingSession> = {}): CookingSession {
    const session: CookingSession = {
        ...createSession({ recipeId: 'recipe-01', totalSteps: 3, startedAt: '2026-08-09T10:00:00.000Z' }),
        ...overrides,
    };

    Object.freeze(session.completedSteps);
    Object.freeze(session.checkedIngredientIds);
    Object.freeze(session.activeTimers);

    return Object.freeze(session);
}

describe('session — UTP-004-A: createSession rejects an unusable step count', () => {
    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'UTS-004-A1/A2: rejects totalSteps = %s',
        (totalSteps) => {
            let thrown: unknown;

            try {
                createSession({ recipeId: 'recipe-01', totalSteps, startedAt: '2026-08-09T10:00:00.000Z' });
            } catch (error) {
                thrown = error;
            }

            expect(isInvalidTotalStepsError(thrown)).toBe(true);
        },
    );

    it('UTS-004-A3: reports the offending value on the error', () => {
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

describe('session — UTP-004-B: createSession starts a session at the first step (REQ-008)', () => {
    it('UTS-004-B1: produces an empty session at step 0', () => {
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
            checkedIngredientIds: [],
            scaleFactor: 1,
            activeTimers: [],
        });
    });

    it('UTS-004-B2: omits pausedAt entirely rather than setting it to undefined', () => {
        const session = createSession({
            recipeId: 'recipe-01',
            totalSteps: 5,
            startedAt: '2026-08-09T10:00:00.000Z',
        });

        // `JSON.stringify` drops `undefined` values, so an explicit `pausedAt: undefined` would make
        // a persisted session differ from its restored copy.
        expect('pausedAt' in session).toBe(false);
    });
});

describe('session — UTP-004-H: totalSteps boundary values', () => {
    it('UTS-004-H1: accepts the minimum valid count of 1', () => {
        const session = createSession({
            recipeId: 'recipe-01',
            totalSteps: 1,
            startedAt: '2026-08-09T10:00:00.000Z',
        });

        expect(session.currentStepIndex).toBe(0);
    });

    it('UTS-004-H2: accepts a large count', () => {
        const session = createSession({
            recipeId: 'recipe-01',
            totalSteps: 200,
            startedAt: '2026-08-09T10:00:00.000Z',
        });

        expect(sessionStatus(session, 200)).toBe('idle');
    });
});

describe('session — UTP-004-E: advance moves forward and records the departed step (REQ-002)', () => {
    it('UTS-004-E1: moves to the next step and completes the one just left', () => {
        const advanced = advance(makeFrozenSession(), 3);

        expect(advanced.currentStepIndex).toBe(1);
        expect(advanced.completedSteps).toStrictEqual([0]);
    });

    it('UTS-004-E2: accumulates completed steps across the whole recipe', () => {
        const atLast = advance(advance(makeFrozenSession(), 3), 3);

        expect(atLast.currentStepIndex).toBe(2);
        expect(atLast.completedSteps).toStrictEqual([0, 1]);
    });

    it('UTS-004-E3: leaves every unrelated field untouched', () => {
        const session = makeFrozenSession({
            checkedIngredientIds: ['ing-1'],
            scaleFactor: 2,
        });

        const advanced = advance(session, 3);

        expect(advanced.recipeId).toBe('recipe-01');
        expect(advanced.startedAt).toBe('2026-08-09T10:00:00.000Z');
        expect(advanced.checkedIngredientIds).toStrictEqual(['ing-1']);
        expect(advanced.scaleFactor).toBe(2);
        expect(advanced.activeTimers).toStrictEqual([]);
    });

    it('UTS-004-E4: rejects an unusable step count', () => {
        let thrown: unknown;

        try {
            advance(makeFrozenSession(), 0);
        } catch (error) {
            thrown = error;
        }

        expect(isInvalidTotalStepsError(thrown)).toBe(true);
    });
});

describe('session — UTP-004-C: advance clamps at the last step', () => {
    it('UTS-004-C1: never produces an out-of-range index', () => {
        const atLast = advance(advance(makeFrozenSession(), 3), 3);

        const pastEnd = advance(atLast, 3);

        expect(pastEnd.currentStepIndex).toBe(2);
        expect(pastEnd.completedSteps).toStrictEqual([0, 1, 2]);
    });

    it('UTS-004-C2: repeating the terminal advance changes nothing further', () => {
        const finished = advance(advance(advance(makeFrozenSession(), 3), 3), 3);

        const again = advance(finished, 3);

        expect(again).toStrictEqual(finished);
    });

    it('UTS-004-C3: a single-step recipe completes without ever moving', () => {
        const session = createSession({
            recipeId: 'recipe-01',
            totalSteps: 1,
            startedAt: '2026-08-09T10:00:00.000Z',
        });

        const finished = advance(session, 1);

        expect(finished.currentStepIndex).toBe(0);
        expect(finished.completedSteps).toStrictEqual([0]);
    });

    it('UTS-004-C4: clamps a restored index that the recipe no longer contains', () => {
        // The recipe shrank while the session was persisted; the index must land inside the new
        // range instead of walking further off the end.
        const stale = makeFrozenSession({ currentStepIndex: 7 });

        const advanced = advance(stale, 3);

        expect(advanced.currentStepIndex).toBe(2);
        expect(advanced.completedSteps).toStrictEqual([2]);
    });
});

describe('session — UTP-004-D: goBack clamps at the first step (REQ-003)', () => {
    it('UTS-004-D1: steps back one position', () => {
        const atSecond = advance(makeFrozenSession(), 3);

        expect(goBack(atSecond).currentStepIndex).toBe(0);
    });

    it('UTS-004-D2: is a no-op at step 0 and keeps the session intact', () => {
        const session = makeFrozenSession();

        expect(goBack(session)).toStrictEqual(session);
    });

    it('UTS-004-D3: never loses the place — completed steps survive going back (FR-033)', () => {
        const atLast = advance(advance(makeFrozenSession(), 3), 3);

        const back = goBack(atLast);

        expect(back.currentStepIndex).toBe(1);
        expect(back.completedSteps).toStrictEqual([0, 1]);
    });

    it('UTS-004-D4: repairs a corrupt negative index rather than propagating it', () => {
        const corrupt = makeFrozenSession({ currentStepIndex: -4 });

        expect(goBack(corrupt).currentStepIndex).toBe(0);
    });
});

describe('session — UTP-004-J: completedSteps never contains duplicates', () => {
    it('UTS-004-J1: advancing, going back and advancing again records the step once', () => {
        const bounced = advance(goBack(advance(makeFrozenSession(), 3)), 3);

        expect(bounced.completedSteps).toStrictEqual([0]);
        expect(bounced.currentStepIndex).toBe(1);
    });

    it('UTS-004-J2: a long bounce over two steps still records each exactly once', () => {
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

describe('session — UTP-004-I: goToStep validates the requested index', () => {
    it('UTS-004-I1: jumps to a valid step', () => {
        const jumped = goToStep(makeFrozenSession(), 2, 3);

        expect(jumped.currentStepIndex).toBe(2);
    });

    it('UTS-004-I2: accepts both range boundaries', () => {
        const session = makeFrozenSession();

        expect(goToStep(session, 0, 3).currentStepIndex).toBe(0);
        expect(goToStep(session, 2, 3).currentStepIndex).toBe(2);
    });

    it('UTS-004-I3: does not invent completed steps for the ones it skipped', () => {
        const jumped = goToStep(makeFrozenSession(), 2, 3);

        expect(jumped.completedSteps).toStrictEqual([]);
    });

    it.each([3, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('UTS-004-I4: rejects the index %s', (index) => {
        let thrown: unknown;

        try {
            goToStep(makeFrozenSession(), index, 3);
        } catch (error) {
            thrown = error;
        }

        expect(isInvalidStepIndexError(thrown)).toBe(true);
    });

    it('UTS-004-I5: reports the offending index and range on the error', () => {
        let thrown: unknown;

        try {
            goToStep(makeFrozenSession(), 9, 3);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toMatchObject({ name: 'InvalidStepIndexError', index: 9, totalSteps: 3 });
    });

    it('UTS-004-I6: rejects an unusable step count before looking at the index', () => {
        let thrown: unknown;

        try {
            goToStep(makeFrozenSession(), 0, 0);
        } catch (error) {
            thrown = error;
        }

        expect(isInvalidTotalStepsError(thrown)).toBe(true);
    });
});

describe('session — UTP-004-M: pause and resume', () => {
    it('UTS-004-M1: pause records the timestamp without moving the session', () => {
        const midway = advance(makeFrozenSession(), 3);

        const paused = pause(midway, '2026-08-09T10:30:00.000Z');

        expect(paused.pausedAt).toBe('2026-08-09T10:30:00.000Z');
        expect(paused.currentStepIndex).toBe(1);
        expect(paused.completedSteps).toStrictEqual([0]);
    });

    it('UTS-004-M2: resume removes the key entirely rather than setting it to undefined', () => {
        const paused = pause(makeFrozenSession(), '2026-08-09T10:30:00.000Z');

        const resumed = resume(paused);

        expect('pausedAt' in resumed).toBe(false);
    });

    it('UTS-004-M3: a pause/resume round trip restores the exact session (FR-033)', () => {
        const midway = advance(makeFrozenSession(), 3);

        expect(resume(pause(midway, '2026-08-09T10:30:00.000Z'))).toStrictEqual(midway);
    });

    it('UTS-004-M4: resuming a session that was never paused is safe', () => {
        const session = makeFrozenSession();

        expect(resume(session)).toStrictEqual(session);
    });

    it('UTS-004-M5: pausing twice keeps the most recent timestamp', () => {
        const first = pause(makeFrozenSession(), '2026-08-09T10:30:00.000Z');

        expect(pause(first, '2026-08-09T11:00:00.000Z').pausedAt).toBe('2026-08-09T11:00:00.000Z');
    });
});

describe('session — UTP-004-G: sessionStatus derives the statechart position', () => {
    it('UTS-004-G1: a fresh session is idle', () => {
        expect(sessionStatus(makeFrozenSession(), 3)).toBe('idle');
    });

    it('UTS-004-G2: a session with progress is cooking', () => {
        expect(sessionStatus(advance(makeFrozenSession(), 3), 3)).toBe('cooking');
    });

    it('UTS-004-G3: returning to step 0 with work behind it is cooking, not idle', () => {
        // Position alone must not decide the status: this session sits at index 0 exactly like a
        // fresh one, and only `completedSteps` distinguishes them.
        const back = goBack(advance(makeFrozenSession(), 3));

        expect(back.currentStepIndex).toBe(0);
        expect(sessionStatus(back, 3)).toBe('cooking');
    });

    it('UTS-004-G4: a paused session is paused', () => {
        const paused = pause(advance(makeFrozenSession(), 3), '2026-08-09T10:30:00.000Z');

        expect(sessionStatus(paused, 3)).toBe('paused');
    });

    it('UTS-004-G5: resuming returns the session to cooking', () => {
        const paused = pause(advance(makeFrozenSession(), 3), '2026-08-09T10:30:00.000Z');

        expect(sessionStatus(resume(paused), 3)).toBe('cooking');
    });

    it('UTS-004-G6: pausing a fresh session still reads as paused, and resuming returns it to idle', () => {
        const paused = pause(makeFrozenSession(), '2026-08-09T10:30:00.000Z');

        expect(sessionStatus(paused, 3)).toBe('paused');
        expect(sessionStatus(resume(paused), 3)).toBe('idle');
    });

    it('UTS-004-G7: advancing through every step completes the session', () => {
        const finished = advance(advance(advance(makeFrozenSession(), 3), 3), 3);

        expect(sessionStatus(finished, 3)).toBe('complete');
    });

    it('UTS-004-G8: reaching the last step is not yet complete', () => {
        const atLast = advance(advance(makeFrozenSession(), 3), 3);

        expect(atLast.currentStepIndex).toBe(2);
        expect(sessionStatus(atLast, 3)).toBe('cooking');
    });

    it('UTS-004-G9: reviewing an earlier step after finishing stays complete', () => {
        const finished = advance(advance(advance(makeFrozenSession(), 3), 3), 3);

        expect(sessionStatus(goBack(finished), 3)).toBe('complete');
    });

    it('UTS-004-G10: pause outranks completion, because only pause is explicit state', () => {
        const finished = advance(advance(advance(makeFrozenSession(), 3), 3), 3);

        expect(sessionStatus(pause(finished, '2026-08-09T11:00:00.000Z'), 3)).toBe('paused');
    });

    it('UTS-004-G11: a partially completed set is not complete', () => {
        const partial = makeFrozenSession({ currentStepIndex: 2, completedSteps: [0, 2] });

        expect(sessionStatus(partial, 3)).toBe('cooking');
    });

    it('UTS-004-G12: completed steps left over from a longer recipe do not fake completion', () => {
        // The recipe grew from 3 to 5 steps between sessions; the old completions must not be read
        // as "the whole recipe is done".
        const stale = makeFrozenSession({ currentStepIndex: 2, completedSteps: [0, 1, 2] });

        expect(sessionStatus(stale, 5)).toBe('cooking');
    });

    it('UTS-004-G13: rejects an unusable step count', () => {
        let thrown: unknown;

        try {
            sessionStatus(makeFrozenSession(), -1);
        } catch (error) {
            thrown = error;
        }

        expect(isInvalidTotalStepsError(thrown)).toBe(true);
    });
});

describe('session — UTP-004-K: every transition is pure', () => {
    it('UTS-004-K1: no operation mutates the session it was given', () => {
        const session = advance(makeFrozenSession(), 3);
        Object.freeze(session.completedSteps);
        Object.freeze(session.checkedIngredientIds);
        Object.freeze(session.activeTimers);
        Object.freeze(session);
        const before = structuredClone(session);

        advance(session, 3);
        goBack(session);
        goToStep(session, 2, 3);
        pause(session, '2026-08-09T10:30:00.000Z');
        resume(session);
        sessionStatus(session, 3);

        expect(session).toStrictEqual(before);
    });

    it('UTS-004-K2: every transition returns a new object, never the input', () => {
        const session = makeFrozenSession();

        expect(advance(session, 3)).not.toBe(session);
        expect(goBack(session)).not.toBe(session);
        expect(goToStep(session, 1, 3)).not.toBe(session);
        expect(pause(session, '2026-08-09T10:30:00.000Z')).not.toBe(session);
        expect(resume(session)).not.toBe(session);
    });

    it('UTS-004-K3: the completed-step array is copied, so the new session cannot corrupt the old', () => {
        const session = advance(makeFrozenSession(), 3);

        const next = advance(session, 3);

        expect(next.completedSteps).not.toBe(session.completedSteps);
        expect(session.completedSteps).toStrictEqual([0]);
    });
});

describe('session — UTP-004-L: a session survives a JSON round trip', () => {
    it('UTS-004-L1: a mid-navigation session is deep-equal after persist and restore', () => {
        const midway = goToStep(advance(makeFrozenSession({ checkedIngredientIds: ['ing-1'] }), 3), 2, 3);

        const restored: CookingSession = JSON.parse(JSON.stringify(midway));

        expect(restored).toStrictEqual(midway);
    });

    it('UTS-004-L2: a paused session round-trips including its optional timestamp', () => {
        const paused = pause(advance(makeFrozenSession(), 3), '2026-08-09T10:30:00.000Z');

        const restored: CookingSession = JSON.parse(JSON.stringify(paused));

        expect(restored).toStrictEqual(paused);
        expect(sessionStatus(restored, 3)).toBe('paused');
    });

    it('UTS-004-L3: navigation continues correctly from a restored session', () => {
        const midway = advance(makeFrozenSession(), 3);
        const restored: CookingSession = JSON.parse(JSON.stringify(midway));

        const advanced = advance(restored, 3);

        expect(advanced.currentStepIndex).toBe(2);
        expect(advanced.completedSteps).toStrictEqual([0, 1]);
    });
});
