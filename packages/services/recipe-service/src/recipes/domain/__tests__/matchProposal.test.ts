/**
 * The pure rules the paste matcher applies to one (line, food) before anything is stored or sent (ADR-0071).
 *
 * Three questions, each with a way of getting it wrong that would cost money or a wrong match:
 *
 *  1. **Which judgement does the proposal ask for?** The verdict key must equal what the save path computes if the cook
 *     keeps this food, or a kept line is asked about twice. The first food of a line carries the line's measure and a
 *     second food carries none, which is how the editor saves a pasted line (`pastedLines.ts`).
 *  2. **May the gate be asked at all?** A blank line is skipped and an over-cap one REFUSED, never truncated, and
 *     identity is always asked for a paste proposal (no band or curated skip).
 *  3. **Which candidates does the cook see?** At most five, the proposal first, and a default that applies is never
 *     cut off by the limit, because whether a default applies decides the line's state.
 */
import { describe, expect, it } from 'vitest';

import { ABSENT_QUANTITY, type IngredientQuantity } from '@kitchensink/recipe-core';

import {
    MAX_MATCH_CANDIDATES,
    candidatesFor,
    defaultApplies,
    isDefaultRung,
    matchJudgementOf,
    proposalVerificationDecision,
} from '../matchProposal.js';

const EXACT_TWO: IngredientQuantity = { kind: 'exact', value: 2 };
const LINE = { sourceLine: '2 cups whole milk', quantity: EXACT_TWO, unit: 'cup' as string | null };

describe('matchJudgementOf — the judgement a proposal asks for', () => {
    it('keys the FIRST food on the line’s own measure, with no stated measure', () => {
        expect(matchJudgementOf(LINE, 0, 'F-milk')).toStrictEqual({
            sourceLine: '2 cups whole milk',
            foodRefId: 'F-milk',
            quantityLow: 2,
            quantityHigh: null,
            unit: 'cup',
            statedMeasure: null,
        });
    });

    it('keys a SECOND food with no measure — the line gave one amount, and the editor saves it on the first', () => {
        expect(matchJudgementOf({ ...LINE, sourceLine: 'salt and pepper' }, 1, 'F-pepper')).toMatchObject({
            quantityLow: null,
            quantityHigh: null,
            unit: null,
        });
    });

    it('keys a RANGE on both bounds and a missing unit as null', () => {
        expect(
            matchJudgementOf({ ...LINE, quantity: { kind: 'range', low: 2, high: 3 }, unit: null }, 0, 'F'),
        ).toMatchObject({ quantityLow: 2, quantityHigh: 3, unit: null });
    });

    it('keys an ABSENT amount as null, never zero', () => {
        expect(matchJudgementOf({ ...LINE, quantity: ABSENT_QUANTITY }, 0, 'F')).toMatchObject({ quantityLow: null });
    });

    it('answers nothing for a blank source line — there is nothing to judge', () => {
        expect(matchJudgementOf({ ...LINE, sourceLine: '   ' }, 0, 'F')).toBeUndefined();
    });
});

describe('proposalVerificationDecision — may the gate be asked, and about what', () => {
    it('asks IDENTITY and quantity for a root proposal', () => {
        expect(proposalVerificationDecision('2 cups whole milk', 'root')).toMatchObject({
            kind: 'verify',
            aspects: ['identity', 'quantity'],
        });
    });

    it('asks identity for a variant proposal too', () => {
        expect(proposalVerificationDecision('1 brisket, flat cut', 'variant')).toMatchObject({
            kind: 'verify',
            aspects: ['identity', 'quantity'],
        });
    });

    it('⛔ REFUSES an over-cap line rather than truncating it', () => {
        expect(proposalVerificationDecision('x'.repeat(401), 'root').kind).toBe('reject');
    });

    it('skips a blank line', () => {
        expect(proposalVerificationDecision(' ', 'root').kind).toBe('skip');
    });
});

describe('isDefaultRung and defaultApplies — the default signal (owner ruling 1)', () => {
    it('reads only the `default` rung as a default', () => {
        expect(isDefaultRung('default')).toBe(true);
        expect(isDefaultRung('exact')).toBe(false);
        expect(isDefaultRung(null)).toBe(false);
        expect(isDefaultRung(undefined)).toBe(false);
    });

    it('a default applies when ANY candidate carries the default rung', () => {
        expect(defaultApplies([{ kind: 'root', id: 'A', rung: 'head' }])).toBe(false);
        expect(
            defaultApplies([
                { kind: 'root', id: 'A', rung: 'head' },
                { kind: 'root', id: 'B', rung: 'default' },
            ]),
        ).toBe(true);
    });
});

describe('candidatesFor — what the cook may choose from', () => {
    const ranked = (count: number, defaultAt?: number) =>
        Array.from({ length: count }, (_, index) => ({
            food: { kind: 'root' as const, id: `F-${String(index)}` },
            rung: index === defaultAt ? 'default' : 'head',
        }));

    it('is the ranked shortlist when the proposal heads it', () => {
        expect(candidatesFor({ kind: 'root', id: 'F-0' }, ranked(3))).toStrictEqual([
            { kind: 'root', id: 'F-0', rung: 'head' },
            { kind: 'root', id: 'F-1', rung: 'head' },
            { kind: 'root', id: 'F-2', rung: 'head' },
        ]);
    });

    it('puts a curated or memo proposal FIRST when the shortlist does not hold it, with no rung of its own', () => {
        expect(candidatesFor({ kind: 'root', id: 'F-curated' }, ranked(2))[0]).toStrictEqual({
            kind: 'root',
            id: 'F-curated',
            rung: null,
        });
    });

    it('never lists the proposal twice, and keeps its rung from the shortlist', () => {
        const list = candidatesFor({ kind: 'root', id: 'F-1' }, ranked(3));

        expect(list.map((candidate) => candidate.id)).toStrictEqual(['F-1', 'F-0', 'F-2']);
        expect(list[0]?.rung).toBe('head');
    });

    it(`keeps at most ${String(MAX_MATCH_CANDIDATES)}, and ⛔ never cuts off a default that applies`, () => {
        const list = candidatesFor({ kind: 'root', id: 'F-curated' }, ranked(5, 4));

        expect(list).toHaveLength(MAX_MATCH_CANDIDATES);
        expect(list.some((candidate) => candidate.rung === 'default')).toBe(true);
    });

    it('lists only the shortlist when nothing was proposed', () => {
        expect(candidatesFor(undefined, ranked(2)).map((candidate) => candidate.id)).toStrictEqual(['F-0', 'F-1']);
    });

    it('carries an absent rung as null', () => {
        expect(candidatesFor(undefined, [{ food: { kind: 'variant', id: 'V' }, rung: undefined }])).toStrictEqual([
            { kind: 'variant', id: 'V', rung: null },
        ]);
    });
});
