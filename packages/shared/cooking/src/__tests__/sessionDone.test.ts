import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { makeOneLineSteps } from '../__fixtures__/cookingSteps.js';
import { advance, createSession, goBack, sessionStatus } from '../session.js';

/**
 * Done is the session reducer's own rule: Next on the last step is `advance`, which records the last step, and
 * `sessionStatus` then derives `complete`. No `finish` command exists, so this pins the boundary from both sides:
 * `complete` never appears while a step is unrecorded, and does appear after the advance from the last step. "Cook it
 * again" is a fresh `createSession`, which is not complete.
 */

const START = { recipeId: 'roast', startedAt: '2026-11-13T10:00:00.000Z' };

describe('session — Done is reached only from the last step', () => {
    it('advancing through a 6-step recipe is complete only after Next on step 6', () => {
        const steps = makeOneLineSteps(6);
        let session = createSession({ ...START, steps });

        for (let step = 0; step < 5; step++) {
            expect(sessionStatus(session, steps)).not.toBe('complete');
            session = advance(session, steps);
        }

        expect(session.currentStepIndex).toBe(5);
        expect(sessionStatus(session, steps)).toBe('cooking');

        session = advance(session, steps);

        expect(sessionStatus(session, steps)).toBe('complete');
    });

    it('a one-step recipe is complete after its single Next', () => {
        const steps = makeOneLineSteps(1);
        const session = advance(createSession({ ...START, steps }), steps);

        expect(sessionStatus(session, steps)).toBe('complete');
    });

    it('ghost indices past the recipe do not make a 3-step recipe complete', () => {
        const steps = makeOneLineSteps(3);
        const session = { ...createSession({ ...START, steps }), completedSteps: [1, 5, 6] };

        expect(sessionStatus(session, steps)).toBe('cooking');
    });

    it('Cook it again starts a fresh (idle) session at step 0', () => {
        const steps = makeOneLineSteps(6);
        const again = createSession({ ...START, steps });

        expect(again.currentStepIndex).toBe(0);
        expect(again.completedSteps).toEqual([]);
        expect(sessionStatus(again, steps)).toBe('idle');
    });

    it('no sequence of Next and Back reaches complete without Next on the last step', () => {
        fc.assert(
            fc.property(fc.integer({ min: 2, max: 8 }), fc.array(fc.boolean(), { maxLength: 30 }), (total, moves) => {
                const steps = makeOneLineSteps(total);
                let session = createSession({ ...START, steps });
                let lastRecorded = false;

                for (const next of moves) {
                    if (next) {
                        lastRecorded ||= session.currentStepIndex === total - 1;
                        session = advance(session, steps);
                    } else {
                        session = goBack(session, steps);
                    }

                    if (sessionStatus(session, steps) === 'complete') {
                        expect(lastRecorded).toBe(true);
                    }
                }
            }),
        );
    });
});
