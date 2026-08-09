/**
 * Unit tests for the pure presentation logic behind Cooking Mode's timer surfaces (FR-034).
 *
 * These are the Humble Object's decisions, proved without a renderer: whether a step earns a badge at all,
 * and how a millisecond remainder reads as a clock. The component specs assert the same behaviour through
 * the rendered leaves; this file pins the boundaries a renderer makes awkward to reach (non-finite input,
 * the rounding direction, minutes past two digits).
 */
import { describe, expect, it } from 'vitest';

import type { RecipeStepView } from '@kitchensink/recipe-core';

import { formatRemaining, stepTimerDurationMs } from '../timerModel';

const TEMPLATE = '{minutes}:{seconds}';

function makeStep(overrides: Partial<RecipeStepView> = {}): RecipeStepView {
    return { stepNumber: 1, instruction: 'Simmer the sauce', ...overrides };
}

describe('stepTimerDurationMs', () => {
    it('converts the step duration from SECONDS to milliseconds (mutation lens: the 60x unit bug)', () => {
        expect(stepTimerDurationMs(makeStep({ timerSeconds: 90 }))).toBe(90_000);
        expect(stepTimerDurationMs(makeStep({ timerSeconds: 1500 }))).toBe(1_500_000);
    });

    it('reports no duration for a step that declares no timer', () => {
        expect(stepTimerDurationMs(makeStep({ timerSeconds: undefined }))).toBeUndefined();
    });

    it('reports no duration for a zero-length timer, which is not a timer', () => {
        expect(stepTimerDurationMs(makeStep({ timerSeconds: 0 }))).toBeUndefined();
    });

    it('reports no duration for a negative or non-finite value rather than a nonsense countdown', () => {
        expect(stepTimerDurationMs(makeStep({ timerSeconds: -30 }))).toBeUndefined();
        expect(stepTimerDurationMs(makeStep({ timerSeconds: Number.NaN }))).toBeUndefined();
        expect(stepTimerDurationMs(makeStep({ timerSeconds: Number.POSITIVE_INFINITY }))).toBeUndefined();
    });
});

describe('formatRemaining', () => {
    it.each([
        [0, '0:00'],
        [1, '0:01'],
        [999, '0:01'],
        [9_000, '0:09'],
        [59_000, '0:59'],
        [60_000, '1:00'],
        [90_000, '1:30'],
        [1_500_000, '25:00'],
        [3_600_000, '60:00'],
        [7_260_000, '121:00'],
    ])('renders %ims as %s', (remainingMs, expected) => {
        expect(formatRemaining(remainingMs, TEMPLATE)).toBe(expected);
    });

    it('rounds the final second UP, so a running timer never reads 0:00 while time remains', () => {
        expect(formatRemaining(1, TEMPLATE)).toBe('0:01');
        expect(formatRemaining(1_000, TEMPLATE)).toBe('0:01');
        expect(formatRemaining(1_001, TEMPLATE)).toBe('0:02');
    });

    it('clamps an overshot or non-finite remainder to 0:00 instead of counting backwards', () => {
        expect(formatRemaining(-1, TEMPLATE)).toBe('0:00');
        expect(formatRemaining(-4_000, TEMPLATE)).toBe('0:00');
        expect(formatRemaining(Number.NaN, TEMPLATE)).toBe('0:00');
    });

    it('substitutes into the LOCALIZED template rather than hard-coding a colon separator', () => {
        expect(formatRemaining(90_000, '{minutes} min {seconds} s')).toBe('1 min 30 s');
    });
});
