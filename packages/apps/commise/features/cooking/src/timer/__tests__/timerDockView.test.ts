/**
 * The dock's view of the timer list: which rows it draws, what each says, and whether the offer shows. Every timer
 * state has its own row with exact copy; the held Undo slot and another recipe's timer draw no row.
 */
import { stepDigestsOf, timerOrder } from '@kitchensink/cooking-core';
import type { ActiveTimer, TimerState } from '@kitchensink/cooking-core';
import { describe, expect, it } from 'vitest';

import { makeCookingRecipe } from '../../__fixtures__/makeCookingRecipe.js';
import { cookingMessages } from '../../messages.js';
import { timerDockView } from '../timerDockView.js';

const copy = cookingMessages.en;
const NOW = 1_000_000;
const recipe = makeCookingRecipe({
    steps: [
        { stepNumber: 1, instruction: 'Chop.' },
        { stepNumber: 2, instruction: 'Roast 20 minutes.' },
    ],
});
const digest = stepDigestsOf(recipe.steps)[1] ?? '';

const base = {
    id: 't1',
    run: 1,
    recipeId: 'r1',
    stepIndex: 1,
    stepDigest: digest,
    ordinal: 1,
    label: undefined,
    origin: { kind: 'added' },
    durationMs: 270_000,
} as const;

const running = (over: Partial<Extract<ActiveTimer, { kind: 'running' }>> = {}): ActiveTimer => ({
    ...base,
    kind: 'running',
    endsAt: NOW + 270_000,
    ...over,
});

const viewOf = (state: Partial<TimerState>, at = NOW) =>
    timerDockView({
        order: timerOrder({ timers: [], undo: undefined, ...state }),
        recipe,
        nowMs: at,
        copy,
        locale: 'en',
    });

describe('timerDockView', () => {
    it('draws a running timer as a countdown with its place and spoken name', () => {
        const { rows } = viewOf({ timers: [running()] });

        expect(rows).toEqual([
            {
                kind: 'running',
                id: 't1',
                run: 1,
                figure: '4:30',
                meta: 'Step\u00a02',
                accessibilityLabel: 'Step\u00a02, 4 minutes 30 seconds left',
                pauseLabel: 'Pause Step 2 timer',
                cancelLabel: 'Cancel Step 2 timer',
            },
        ]);
    });

    it('draws a paused timer with its kept time and the word Paused', () => {
        const { rows } = viewOf({ timers: [{ ...base, kind: 'paused', remainingMs: 65_000 }] });

        expect(rows).toEqual([
            expect.objectContaining({
                kind: 'paused',
                figure: '1:05',
                status: 'Paused',
                accessibilityLabel: 'Step\u00a02, paused, 1 minute 5 seconds left',
                resumeLabel: 'Resume Step 2 timer',
                cancelLabel: 'Cancel Step 2 timer',
            }),
        ]);
    });

    it.each([
        ['ringing', { kind: 'ringing', endedAt: NOW - 1000 } as const],
        ['endedAway', { kind: 'endedAway', endedAt: NOW - 1000 } as const],
    ])('draws a %s timer as done, with only Stop', (_name, state) => {
        const { rows } = viewOf({ timers: [{ ...base, ...state }] });

        expect(rows).toEqual([
            expect.objectContaining({
                kind: 'done',
                figure: '0:00',
                status: 'Done',
                accessibilityLabel: 'Step\u00a02 timer done',
                stopLabel: 'Stop Step 2 timer',
            }),
        ]);
    });

    // A finished timer sorts first in the list (it waits for the cook), then the others.
    it('keeps the step part when the cook typed a name, in the meta and in each spoken name', () => {
        const label = { kind: 'typed', text: 'Roast' } as const;
        const rows = viewOf({
            timers: [
                running({ label }),
                { ...base, id: 't2', label, kind: 'paused', remainingMs: 60_000 },
                { ...base, id: 't3', label, kind: 'ringing', endedAt: NOW },
            ],
        }).rows;

        expect(rows.map((row) => row.accessibilityLabel)).toEqual([
            'Roast timer done, step\u00a02',
            'Roast, 4 minutes 30 seconds left, step\u00a02',
            'Roast, paused, 1 minute left, step\u00a02',
        ]);
        expect(rows[1]).toEqual(
            expect.objectContaining({ meta: 'Roast \u00b7 step\u00a02', pauseLabel: 'Pause Roast timer' }),
        );
    });

    it('rounds a part of a second up, so the figure and the spoken time agree', () => {
        const { rows } = viewOf({ timers: [running({ endsAt: NOW + 4_001 })] }, NOW);

        expect(rows[0]?.figure).toBe('0:05');
        expect(rows[0]?.accessibilityLabel).toContain('5 seconds left');
    });

    it('draws no row for the held Undo slot, and still shows the offer', () => {
        const held = { ...base, kind: 'running', endsAt: NOW + 1000 } as const;
        const view = viewOf({ timers: [], undo: held });

        expect(view).toEqual({ rows: [], offerShown: true });
    });

    it("draws no row for another recipe's timer, and hides the offer while it runs", () => {
        const view = viewOf({ timers: [running({ recipeId: 'other' })] });

        expect(view).toEqual({ rows: [], offerShown: false });
    });

    it('shows the offer only when no timer is live', () => {
        expect(viewOf({}).offerShown).toBe(true);
        expect(viewOf({ timers: [running()] }).offerShown).toBe(false);
    });

    it('draws one row per timer, in the list order, each keyed by its own id and run', () => {
        const second = running({ id: 't2', run: 3, ordinal: 2 });
        const { rows } = viewOf({ timers: [running(), second] });

        expect(rows.map((row) => [row.id, row.run])).toEqual([
            ['t1', 1],
            ['t2', 3],
        ]);
    });
});
