import { describe, expect, it } from 'vitest';

import { isInvalidStepIndexError, isInvalidTotalStepsError } from '../errors.js';
import { advance, createSession, goBack, sessionStatus } from '../session.js';
import type { CookingSession } from '../types.js';
import { makeOneLineSteps } from '../__fixtures__/cookingSteps.js';

const THREE = makeOneLineSteps(3);

/**
 * The cooking session's step navigation (FR-032, FR-033): a pure reducer over `CookingSession`.
 *
 * Every assertion is written to fail if the logic is broken, not merely to execute it: boundary cases assert the
 * *whole* resulting session, purity is enforced with frozen inputs (a `push` into `completedSteps` throws rather than
 * quietly passing), and error cases assert the specific custom error via its type guard, because a bare `.toThrow()`
 * also passes against an unimplemented stub.
 */

/** A session over {@link THREE} at step 0, deep-frozen so any in-place mutation raises a `TypeError`. */
function makeFrozenSession(overrides: Partial<CookingSession> = {}): CookingSession {
    const session: CookingSession = {
        ...createSession({ recipeId: 'recipe-01', steps: THREE, startedAt: '2026-08-09T10:00:00.000Z' }),
        ...overrides,
    };

    Object.freeze(session.completedSteps);

    return Object.freeze(session);
}

describe('session — createSession rejects a recipe with no steps', () => {
    it('reports a step count of 0 on the error', () => {
        let thrown: unknown;

        try {
            createSession({ recipeId: 'recipe-01', steps: [], startedAt: '2026-08-09T10:00:00.000Z' });
        } catch (error) {
            thrown = error;
        }

        expect(isInvalidTotalStepsError(thrown)).toBe(true);
        expect(isInvalidStepIndexError(thrown)).toBe(false);
        expect(thrown).toMatchObject({ name: 'InvalidTotalStepsError', totalSteps: 0 });
    });
});

describe('session — createSession starts a session at the first step', () => {
    it('produces an empty session at step 0', () => {
        const session = createSession({
            recipeId: 'recipe-01',
            steps: makeOneLineSteps(5),
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

describe('session — step count boundary values', () => {
    it('accepts the minimum valid count of 1', () => {
        const session = createSession({
            recipeId: 'recipe-01',
            steps: makeOneLineSteps(1),
            startedAt: '2026-08-09T10:00:00.000Z',
        });

        expect(session.currentStepIndex).toBe(0);
    });

    it('accepts a large count', () => {
        const session = createSession({
            recipeId: 'recipe-01',
            steps: makeOneLineSteps(200),
            startedAt: '2026-08-09T10:00:00.000Z',
        });

        expect(sessionStatus(session, makeOneLineSteps(200))).toBe('idle');
    });
});

describe('session — advance moves forward and records the departed step', () => {
    it('moves to the next step and completes the one just left', () => {
        const advanced = advance(makeFrozenSession(), THREE);

        expect(advanced.currentStepIndex).toBe(1);
        expect(advanced.completedSteps).toStrictEqual([0]);
    });

    it('accumulates completed steps across the whole recipe', () => {
        const atLast = advance(advance(makeFrozenSession(), THREE), THREE);

        expect(atLast.currentStepIndex).toBe(2);
        expect(atLast.completedSteps).toStrictEqual([0, 1]);
    });

    it('leaves every unrelated field untouched', () => {
        const advanced = advance(makeFrozenSession(), THREE);

        expect(advanced.recipeId).toBe('recipe-01');
        expect(advanced.startedAt).toBe('2026-08-09T10:00:00.000Z');
    });

    it('rejects a recipe with no steps', () => {
        let thrown: unknown;

        try {
            advance(makeFrozenSession(), []);
        } catch (error) {
            thrown = error;
        }

        expect(isInvalidTotalStepsError(thrown)).toBe(true);
    });
});

describe('session — advance stops at the last step', () => {
    it('never produces an out-of-range index', () => {
        const atLast = advance(advance(makeFrozenSession(), THREE), THREE);

        const pastEnd = advance(atLast, THREE);

        expect(pastEnd.currentStepIndex).toBe(2);
        expect(pastEnd.completedSteps).toStrictEqual([0, 1, 2]);
    });

    it('repeating the terminal advance changes nothing further', () => {
        const finished = advance(advance(advance(makeFrozenSession(), THREE), THREE), THREE);

        const again = advance(finished, THREE);

        expect(again).toStrictEqual(finished);
    });

    it('a single-step recipe completes without ever moving', () => {
        const session = createSession({
            recipeId: 'recipe-01',
            steps: makeOneLineSteps(1),
            startedAt: '2026-08-09T10:00:00.000Z',
        });

        const finished = advance(session, makeOneLineSteps(1));

        expect(finished.currentStepIndex).toBe(0);
        expect(finished.completedSteps).toStrictEqual([0]);
    });
});

/**
 * Every transition rejects a step index the recipe does not have, as `stepPlace` and the line ticks do. Nothing in
 * this release stores a session, so an index outside the recipe is a caller bug, and repairing it would record a step
 * the cook never cooked.
 */
describe('session — a step index the recipe does not have is rejected', () => {
    it.each([7, 3, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'advance, goBack and sessionStatus reject index %s of three, naming the index and the count',
        (index) => {
            const session = makeFrozenSession({ currentStepIndex: index });
            const named = expect.toSatisfy(
                (error) => isInvalidStepIndexError(error) && Object.is(error.index, index) && error.totalSteps === 3,
            );

            expect(() => advance(session, THREE)).toThrow(named);
            expect(() => goBack(session, THREE)).toThrow(named);
            expect(() => sessionStatus(session, THREE)).toThrow(named);
            // Nothing is recorded: the throw returns no session, and the frozen input still has no completed step.
            expect(session.completedSteps).toStrictEqual([]);
        },
    );

    it('goBack rejects an unusable step count', () => {
        expect(() => goBack(makeFrozenSession(), [])).toThrow(expect.toSatisfy(isInvalidTotalStepsError));
    });
});

describe('session — goBack stops at the first step', () => {
    it('steps back one position', () => {
        const atSecond = advance(makeFrozenSession(), THREE);

        expect(goBack(atSecond, THREE).currentStepIndex).toBe(0);
    });

    it('is a no-op at step 0 and keeps the session intact', () => {
        const session = makeFrozenSession();

        expect(goBack(session, THREE)).toStrictEqual(session);
    });

    it('never loses the place — completed steps survive going back (FR-033)', () => {
        const atLast = advance(advance(makeFrozenSession(), THREE), THREE);

        const back = goBack(atLast, THREE);

        expect(back.currentStepIndex).toBe(1);
        expect(back.completedSteps).toStrictEqual([0, 1]);
    });
});

describe('session — completedSteps never contains duplicates', () => {
    it('advancing, going back and advancing again records the step once', () => {
        const bounced = advance(goBack(advance(makeFrozenSession(), THREE), THREE), THREE);

        expect(bounced.completedSteps).toStrictEqual([0]);
        expect(bounced.currentStepIndex).toBe(1);
    });

    it('a long bounce over two steps still records each exactly once', () => {
        let session = makeFrozenSession();
        session = advance(session, THREE);
        session = advance(session, THREE);
        session = goBack(session, THREE);
        session = goBack(session, THREE);
        session = advance(session, THREE);
        session = advance(session, THREE);

        expect(session.completedSteps).toStrictEqual([0, 1]);
        expect(new Set(session.completedSteps).size).toBe(session.completedSteps.length);
    });
});

describe('session — sessionStatus derives the statechart position', () => {
    it('a fresh session is idle', () => {
        expect(sessionStatus(makeFrozenSession(), THREE)).toBe('idle');
    });

    it('a session with progress is cooking', () => {
        expect(sessionStatus(advance(makeFrozenSession(), THREE), THREE)).toBe('cooking');
    });

    it('returning to step 0 with work behind it is cooking, not idle', () => {
        // Position alone must not decide the status: this session sits at index 0 exactly like a
        // fresh one, and only `completedSteps` distinguishes them.
        const back = goBack(advance(makeFrozenSession(), THREE), THREE);

        expect(back.currentStepIndex).toBe(0);
        expect(sessionStatus(back, THREE)).toBe('cooking');
    });

    it('advancing through every step completes the session', () => {
        const finished = advance(advance(advance(makeFrozenSession(), THREE), THREE), THREE);

        expect(sessionStatus(finished, THREE)).toBe('complete');
    });

    it('reaching the last step is not yet complete', () => {
        const atLast = advance(advance(makeFrozenSession(), THREE), THREE);

        expect(atLast.currentStepIndex).toBe(2);
        expect(sessionStatus(atLast, THREE)).toBe('cooking');
    });

    it('reviewing an earlier step after finishing stays complete', () => {
        const finished = advance(advance(advance(makeFrozenSession(), THREE), THREE), THREE);

        expect(sessionStatus(goBack(finished, THREE), THREE)).toBe('complete');
    });

    it('a session away from step 0 with nothing completed is cooking, not idle', () => {
        expect(sessionStatus(makeFrozenSession({ currentStepIndex: 2 }), THREE)).toBe('cooking');
    });

    it('a partially completed set is not complete', () => {
        const partial = makeFrozenSession({ currentStepIndex: 2, completedSteps: [0, 2] });

        expect(sessionStatus(partial, THREE)).toBe('cooking');
    });

    it('completed steps left over from a longer recipe do not fake completion', () => {
        // The recipe grew from 3 to 5 steps between sessions; the old completions must not be read
        // as "the whole recipe is done".
        const stale = makeFrozenSession({ currentStepIndex: 2, completedSteps: [0, 1, 2] });

        expect(sessionStatus(stale, makeOneLineSteps(5))).toBe('cooking');
    });

    it('rejects a recipe with no steps', () => {
        let thrown: unknown;

        try {
            sessionStatus(makeFrozenSession(), []);
        } catch (error) {
            thrown = error;
        }

        expect(isInvalidTotalStepsError(thrown)).toBe(true);
    });
});

describe('session — every transition is pure', () => {
    it('no operation mutates the session it was given', () => {
        const session = advance(makeFrozenSession(), THREE);
        Object.freeze(session.completedSteps);
        Object.freeze(session);
        const before = structuredClone(session);

        advance(session, THREE);
        goBack(session, THREE);
        sessionStatus(session, THREE);

        expect(session).toStrictEqual(before);
    });

    it('every transition returns a new object, never the input', () => {
        const session = makeFrozenSession();

        expect(advance(session, THREE)).not.toBe(session);
        expect(goBack(session, THREE)).not.toBe(session);
    });

    it('the completed-step array is copied, so the new session cannot corrupt the old', () => {
        const session = advance(makeFrozenSession(), THREE);

        const next = advance(session, THREE);

        expect(next.completedSteps).not.toBe(session.completedSteps);
        expect(session.completedSteps).toStrictEqual([0]);
    });
});

describe('session — a session survives a JSON round trip', () => {
    it('a mid-navigation session is deep-equal after persist and restore', () => {
        const midway = goBack(advance(advance(makeFrozenSession(), THREE), THREE), THREE);

        const restored: CookingSession = JSON.parse(JSON.stringify(midway));

        expect(restored).toStrictEqual(midway);
    });

    it('navigation continues correctly from a restored session', () => {
        const midway = advance(makeFrozenSession(), THREE);
        const restored: CookingSession = JSON.parse(JSON.stringify(midway));

        const advanced = advance(restored, THREE);

        expect(advanced.currentStepIndex).toBe(2);
        expect(advanced.completedSteps).toStrictEqual([0, 1]);
    });
});
