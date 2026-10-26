/**
 * Truth table for when an item may be saved. CHECKING_WAIT does not exist as a number anywhere: it is a parameter.
 */
import { describe, expect, it } from 'vitest';

import type { LineFacts } from '../migrationBindingPolicy.js';
import { isReadyToSave, type ReadinessInput } from '../migrationSaveReadiness.js';

const WAIT = 10_000;
const line = (state: LineFacts['state'], cookChoice: LineFacts['cookChoice'] = undefined): LineFacts => ({
    state,
    reason: state === 'confident' ? 'exactName' : state === 'checking' ? 'awaitingReview' : 'noProposal',
    proposedFoodId: state === 'confident' || state === 'checking' ? 'p' : undefined,
    candidates: [{ foodId: 'p', isDefault: false }],
    cookChoice,
});

const base: ReadinessInput = {
    mode: 'keepAsWritten',
    itemReview: 'pending',
    reviewClosed: false,
    matchedForMs: 0,
    checkingWaitMs: WAIT,
    lines: [],
};
const ready = (patch: Partial<ReadinessInput>) => isReadyToSave({ ...base, ...patch });

describe('bindBest', () => {
    it('is ready once matched, however long ago', () => {
        expect(ready({ mode: 'bindBest', matchedForMs: 0, lines: [line('confident')] })).toBe(true);
    });

    it('waits while not yet matched', () => {
        expect(ready({ mode: 'bindBest', matchedForMs: undefined, lines: [line('confident')] })).toBe(false);
    });

    it('does not wait for a checking line (it binds the proposal)', () => {
        expect(ready({ mode: 'bindBest', matchedForMs: 0, lines: [line('checking')] })).toBe(true);
    });
});

describe('keepAsWritten', () => {
    it('is ready when matched and no line is checking', () => {
        expect(ready({ lines: [line('confident'), line('needsChoice'), line('noMatch')] })).toBe(true);
    });

    it('waits while not matched', () => {
        expect(ready({ matchedForMs: undefined, lines: [] })).toBe(false);
    });

    it('waits on a checking line before the wait has passed', () => {
        expect(ready({ matchedForMs: WAIT - 1, lines: [line('checking')] })).toBe(false);
    });

    it('still waits AT the wait (strictly longer than)', () => {
        expect(ready({ matchedForMs: WAIT, lines: [line('checking')] })).toBe(false);
    });

    it('is ready once matched longer than the wait', () => {
        expect(ready({ matchedForMs: WAIT + 1, lines: [line('checking')] })).toBe(true);
    });

    it('does not wait on a checking line the cook already decided', () => {
        expect(ready({ lines: [line('checking', { kind: 'asWritten' })] })).toBe(true);
        expect(ready({ lines: [line('checking', { kind: 'food', foodId: 'x' })] })).toBe(true);
    });

    it('ignores the review flags', () => {
        expect(ready({ itemReview: 'skipped', reviewClosed: true, lines: [line('checking')] })).toBe(false);
    });
});

describe('review', () => {
    const review = (patch: Partial<ReadinessInput>) => ready({ mode: 'review', ...patch });

    it('is ready when no line is open', () => {
        expect(review({ lines: [line('confident'), line('checking', { kind: 'asWritten' })] })).toBe(true);
    });

    it('is not ready while a line is open', () => {
        for (const state of ['default', 'needsChoice', 'checking', 'noMatch'] as const) {
            expect(review({ lines: [line(state)] }), state).toBe(false);
        }
    });

    it('is ready when the review is closed, even with open lines and even long-checking ones', () => {
        expect(review({ reviewClosed: true, lines: [line('checking'), line('needsChoice')] })).toBe(true);
    });

    it('is ready when closed even before any match arrived', () => {
        expect(review({ reviewClosed: true, matchedForMs: undefined, lines: [] })).toBe(true);
    });

    it('is not ready before the match arrived while the review is open', () => {
        expect(review({ matchedForMs: undefined, lines: [] })).toBe(false);
    });

    it('the wait does not apply (the cook, not a clock, ends a review)', () => {
        expect(review({ matchedForMs: WAIT * 10, lines: [line('checking')] })).toBe(false);
    });
});
