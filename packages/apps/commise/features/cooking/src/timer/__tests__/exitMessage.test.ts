/**
 * What cooking mode says on the way out about this recipe's timer. Every expected string is filled from the catalogue
 * by the house helper, so a reworded key moves the test with it; the literal strings are only the labels the cook
 * typed. Each row names the mutant it kills.
 */
import { fillTemplate, resolveMessages } from '@commise/i18n';
import type { TimerState } from '@kitchensink/cooking-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeCookingRecipe } from '../../__fixtures__/makeCookingRecipe.js';
import { cookingMessages } from '../../messages.js';
import { createTimerStore } from '../timerStore.js';
import { EXIT_MESSAGE_MS, exitMessageOf } from '../exitMessage.js';

const en = resolveMessages(cookingMessages, 'en');
const MINUTE = 60_000;
const START = Date.parse('2026-11-20T10:00:00.000Z');
const STEP = { stepIndex: 2, stepDigest: 's1:0000000d', label: undefined, origin: { kind: 'added' } } as const;

beforeEach(() => {
    vi.useFakeTimers({ now: START });
});

afterEach(() => {
    vi.useRealTimers();
});

/** One timer of `recipeId` in the given state, made by the real store so its shape is the app's. */
function stateOf(
    kind: 'running' | 'paused' | 'ringing',
    overrides: { recipeId?: string; label?: { kind: 'typed'; text: string } } = {},
): TimerState {
    const store = createTimerStore();
    const disconnect = store.connect();
    const id = store.start({
        ...STEP,
        ...(overrides.label === undefined ? {} : { label: overrides.label }),
        recipeId: overrides.recipeId ?? 'r1',
        durationMs: 5 * MINUTE,
    });
    const run = store.getSnapshot().timers[0]?.run ?? 1;

    if (id === undefined) {
        throw new Error('the store refused the first timer');
    }

    if (kind === 'paused') {
        store.command({ kind: 'pause', id, run });
    }

    if (kind === 'ringing') {
        vi.advanceTimersByTime(6 * MINUTE);
    }

    const state = store.getSnapshot();
    disconnect();

    return state;
}

const message = (state: TimerState, overrides: { recipeId?: string; nowMs?: number; recipe?: false } = {}) =>
    exitMessageOf({
        state,
        recipeId: overrides.recipeId ?? 'r1',
        recipe: overrides.recipe === false ? undefined : makeCookingRecipe({ id: 'r1', title: 'Soup' }),
        copy: en,
        running: en.exit.timerRunningWeb,
        nowMs: overrides.nowMs ?? START,
    });

describe('exitMessageOf', () => {
    it('says a running timer keeps running, named by its typed label', () => {
        const state = stateOf('running', { label: { kind: 'typed', text: 'Rice' } });

        expect(message(state)).toBe(fillTemplate(en.exit.timerRunningWeb, { label: 'Rice' }));
    });

    it('says a paused timer is paused (mutant: the running text for every live timer)', () => {
        const state = stateOf('paused', { label: { kind: 'typed', text: 'Rice' } });

        expect(message(state)).toBe(fillTemplate(en.exit.timerPaused, { label: 'Rice' }));
    });

    it('prefers the running timer over a paused one (mutant: first live timer of any kind)', () => {
        const paused = stateOf('paused', { label: { kind: 'typed', text: 'Beans' } });
        const running = stateOf('running', { label: { kind: 'typed', text: 'Rice' } });
        const both = { ...running, timers: [...paused.timers, ...running.timers] };

        expect(message(both)).toBe(fillTemplate(en.exit.timerRunningWeb, { label: 'Rice' }));
    });

    it('says nothing for a ringing timer, which already has the cook’s attention (mutant: any held timer)', () => {
        expect(message(stateOf('ringing'))).toBeUndefined();
    });

    it('says nothing for an ended-away timer', () => {
        const ringing = stateOf('ringing').timers.find((timer) => timer.kind === 'ringing');

        if (ringing === undefined) {
            throw new Error('the case needs a ringing timer');
        }

        const state: TimerState = { timers: [{ ...ringing, kind: 'endedAway' }], undo: undefined };

        expect(message(state)).toBeUndefined();
    });

    it('says nothing with no timer', () => {
        expect(message({ timers: [], undo: undefined })).toBeUndefined();
    });

    it('says nothing for a running timer with no time left, which rings now (mutant: no time-left check)', () => {
        const state = stateOf('running');

        expect(message(state, { nowMs: START + 5 * MINUTE })).toBeUndefined();
    });

    it('says nothing when only another recipe’s timer runs (mutant: no recipe id filter)', () => {
        const state = stateOf('running', { recipeId: 'other' });

        expect(message(state)).toBeUndefined();
    });

    it('names an unnamed timer by its step, in this recipe and while it loads, never by the recipe title', () => {
        const state = stateOf('running');
        const stepName = fillTemplate(en.timer.stepLabel, { n: 3 });

        expect(message(state, { recipe: false })).toBe(fillTemplate(en.exit.timerRunningWeb, { label: stepName }));
        expect(message(state)).not.toContain('Soup');
    });

    it('takes the template of the platform it is given (mutant: the web text fixed)', () => {
        const state = stateOf('running');

        expect(
            exitMessageOf({
                state,
                recipeId: 'r1',
                recipe: undefined,
                copy: en,
                running: en.exit.timerRunningNative,
                nowMs: START,
            }),
        ).toBe(fillTemplate(en.exit.timerRunningNative, { label: fillTemplate(en.timer.stepLabel, { n: 3 }) }));
    });
});

describe('EXIT_MESSAGE_MS', () => {
    it('is longer than the 6 s of an Undo, so two sentences can be read', () => {
        expect(EXIT_MESSAGE_MS).toBe(8000);
    });
});
