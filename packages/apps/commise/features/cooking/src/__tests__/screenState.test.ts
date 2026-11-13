import { describe, expect, it } from 'vitest';

import { cookingScreenStateOf, type CookingScreenInput } from '../screenState.js';

const ready: CookingScreenInput = {
    read: 'ready',
    offline: false,
    stepCount: 6,
    sessionStatus: 'cooking',
    everyLineTicked: false,
};

/**
 * The screen the cook sees is ONE of seven states, decided in one place from the read, the step count, the session and
 * the ticks (plans/0002-s1-step-by-step.md, build "Approach"). The cases are the precedence between them.
 */
describe('cookingScreenStateOf', () => {
    it('is loading while the read is in flight, whatever the session says', () => {
        expect(cookingScreenStateOf({ ...ready, read: 'pending', sessionStatus: 'complete' })).toEqual({
            kind: 'loading',
        });
    });

    it('is the load error once the read failed, and says whether the cook is offline', () => {
        expect(cookingScreenStateOf({ ...ready, read: 'failed' })).toEqual({ kind: 'error', offline: false });
        expect(cookingScreenStateOf({ ...ready, read: 'failed', offline: true })).toEqual({
            kind: 'error',
            offline: true,
        });
    });

    it('is gone when the recipe can no longer be read, even offline', () => {
        expect(cookingScreenStateOf({ ...ready, read: 'gone', offline: true })).toEqual({ kind: 'gone' });
    });

    it('is no steps for a readable recipe with none', () => {
        expect(cookingScreenStateOf({ ...ready, stepCount: 0 })).toEqual({ kind: 'noSteps' });
    });

    it('is the step while cooking with lines still to tick', () => {
        expect(cookingScreenStateOf(ready)).toEqual({ kind: 'step' });
    });

    it('is next coming once every line of the step is ticked', () => {
        expect(cookingScreenStateOf({ ...ready, everyLineTicked: true })).toEqual({ kind: 'nextComing' });
    });

    it('is done once the session is complete, ahead of next coming', () => {
        expect(cookingScreenStateOf({ ...ready, sessionStatus: 'complete', everyLineTicked: true })).toEqual({
            kind: 'done',
        });
    });

    it('puts no steps ahead of done, because nothing can have been cooked', () => {
        expect(cookingScreenStateOf({ ...ready, stepCount: 0, sessionStatus: 'complete' })).toEqual({
            kind: 'noSteps',
        });
    });
});
