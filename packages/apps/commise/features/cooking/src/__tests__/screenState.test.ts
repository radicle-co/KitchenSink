import { describe, expect, it } from 'vitest';

import { cookingReadStateOf, cookingSessionStateOf, type CookingReadInput } from '../screenState.js';

const read: CookingReadInput = { read: 'ready', offline: false, stepCount: 6 };

/**
 * The screen the cook sees before a session exists is ONE of five states, decided from the read and the step count. The
 * cases are the precedence between them: the read first, then an empty recipe.
 */
describe('cookingReadStateOf', () => {
    it('is loading while the read is in flight, whatever the step count says', () => {
        expect(cookingReadStateOf({ ...read, read: 'pending' })).toEqual({ kind: 'loading' });
        expect(cookingReadStateOf({ ...read, read: 'pending', stepCount: 0 })).toEqual({ kind: 'loading' });
    });

    it('is the load error once the read failed, and says whether the cook is offline', () => {
        expect(cookingReadStateOf({ ...read, read: 'failed' })).toEqual({ kind: 'error', offline: false });
        expect(cookingReadStateOf({ ...read, read: 'failed', offline: true })).toEqual({
            kind: 'error',
            offline: true,
        });
        expect(cookingReadStateOf({ ...read, read: 'failed', stepCount: 0 })).toEqual({
            kind: 'error',
            offline: false,
        });
    });

    it('is gone when the recipe can no longer be read, even offline or with no steps', () => {
        expect(cookingReadStateOf({ ...read, read: 'gone', offline: true })).toEqual({ kind: 'gone' });
        expect(cookingReadStateOf({ ...read, read: 'gone', stepCount: 0 })).toEqual({ kind: 'gone' });
    });

    it('is no steps for a readable recipe with none', () => {
        expect(cookingReadStateOf({ ...read, stepCount: 0 })).toEqual({ kind: 'noSteps' });
    });

    it('is ready for a readable recipe with steps, where the session takes over', () => {
        expect(cookingReadStateOf(read)).toEqual({ kind: 'ready' });
    });
});

/** Once a session exists, the screen is the step, the step with every line ticked, or Done. */
describe('cookingSessionStateOf', () => {
    const session = { sessionStatus: 'cooking', everyLineTicked: false } as const;

    it('is the step while cooking with lines still to tick', () => {
        expect(cookingSessionStateOf(session)).toEqual({ kind: 'step' });
    });

    it('is next coming once every line of the step is ticked', () => {
        expect(cookingSessionStateOf({ ...session, everyLineTicked: true })).toEqual({ kind: 'nextComing' });
    });

    it('is done once the session is complete, ahead of next coming', () => {
        expect(cookingSessionStateOf({ sessionStatus: 'complete', everyLineTicked: true })).toEqual({ kind: 'done' });
        expect(cookingSessionStateOf({ sessionStatus: 'complete', everyLineTicked: false })).toEqual({ kind: 'done' });
    });
});
