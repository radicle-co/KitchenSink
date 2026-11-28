/**
 * `holdClearPolicy` (ADR-0106, plan KTD-5): who may clear a correction hold, and when. The expectations are written by hand from the
 * rule, never derived from the function.
 */
import { describe, expect, it } from 'vitest';

import { holdClearPolicy, type ChainAnswer } from '../holdClearPolicy.js';
import type { SourceAnswerKind } from '../sourceCorrectionScopePolicy.js';

const chain = (...answers: SourceAnswerKind[]): ChainAnswer[] =>
    answers.map((answer, i) => ({ id: `row${i}`, answer }));
const earned = (answers: SourceAnswerKind[], held = true) =>
    holdClearPolicy({ cause: 'earnedRewrite', held, chain: chain(...answers) });

describe('holdClearPolicy: staff clear', () => {
    const staff = (over: { held?: boolean; latest?: string | null; expected?: string | null }) =>
        holdClearPolicy({
            cause: 'staff',
            held: over.held ?? true,
            latestCorrectionId: over.latest === undefined ? 'row0' : over.latest,
            expectedCorrectionId: over.expected === undefined ? 'row0' : over.expected,
        });

    it('clears a held recipe whose newest correction id is the one the staff member saw', () => {
        expect(staff({})).toEqual({ kind: 'clear' });
    });

    it('refuses a recipe that is not held, before it looks at the correction id', () => {
        expect(staff({ held: false, expected: 'stale' })).toEqual({ kind: 'refuse', reason: 'notHeld' });
    });

    it('refuses a correction id that is not the newest row', () => {
        expect(staff({ expected: 'row9' })).toEqual({ kind: 'refuse', reason: 'correctionNotLatest' });
    });

    it('accepts null only when the chain has no row ("still no row")', () => {
        expect(staff({ latest: null, expected: null })).toEqual({ kind: 'clear' });
        expect(staff({ latest: 'row0', expected: null })).toEqual({ kind: 'refuse', reason: 'correctionNotLatest' });
        expect(staff({ latest: null, expected: 'row0' })).toEqual({ kind: 'refuse', reason: 'correctionNotLatest' });
    });
});

describe('holdClearPolicy: earned rewrite (every correction row in the chain must be third-party)', () => {
    it.each([
        ['one book row', ['book']],
        ['one paid-site row', ['paidSite']],
        ['one web-page row', ['webPage']],
        ['a clone row and an ancestor row, both third-party and different', ['book', 'paidSite']],
        ['a later third-party row over an earlier third-party row', ['webPage', 'book', 'paidSite']],
    ] as const)('clears for %s', (_name, answers) => {
        expect(earned([...answers])).toEqual({ kind: 'clear' });
    });

    it.each([
        ['an own row only', ['own']],
        ['an own row anywhere in the chain (old, under a later book row)', ['book', 'own']],
        ['a clone third-party row and an ancestor later corrected to own', ['book', 'webPage', 'own']],
    ] as const)('refuses %s as ownAnswerInChain', (_name, answers) => {
        expect(earned([...answers])).toEqual({ kind: 'refuse', reason: 'ownAnswerInChain' });
    });

    it.each([
        ['a person row only', ['person']],
        ['a person row under a later book row', ['book', 'person']],
    ] as const)('refuses %s as fromPersonAnswerInChain', (_name, answers) => {
        expect(earned([...answers])).toEqual({ kind: 'refuse', reason: 'fromPersonAnswerInChain' });
    });

    it('names own before person when both are present', () => {
        expect(earned(['person', 'own'])).toEqual({ kind: 'refuse', reason: 'ownAnswerInChain' });
    });

    it('refuses a broken chain (no row anywhere) as noCorrectionRow: fail closed', () => {
        expect(earned([])).toEqual({ kind: 'refuse', reason: 'noCorrectionRow' });
    });

    it('refuses a recipe that is not held as notHeld, before it reads the chain', () => {
        expect(earned([], false)).toEqual({ kind: 'refuse', reason: 'notHeld' });
        expect(earned(['book'], false)).toEqual({ kind: 'refuse', reason: 'notHeld' });
    });
});
