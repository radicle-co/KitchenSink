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

import { lineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import {
    MAX_MATCH_CANDIDATES,
    MATCH_JUDGEMENT_VERSION,
    candidatesFor,
    isDefaultRung,
    matchJudgementDigestOf,
    matchJudgementOf,
    proposalVerificationDecision,
    rankTierOf,
} from '../matchProposal.js';
import { isCurrentMatch } from '../parseJobMatch.js';

const EXACT_TWO: IngredientQuantity = { kind: 'exact', value: 2 };
const LINE = { sourceLine: '2 cups whole milk', quantity: EXACT_TWO, unit: 'cup' as string | null };

describe('matchJudgementOf — the judgement a proposal asks for', () => {
    it('keys the FIRST food on the line’s own measure, with no stated measure', () => {
        expect(matchJudgementOf(LINE, 0, 'whole milk', 'F-milk')).toStrictEqual({
            sourceLine: '2 cups whole milk',
            foodRefId: 'F-milk',
            quantityLow: 2,
            quantityHigh: null,
            unit: 'cup',
            statedMeasure: null,
        });
    });

    it('keys a SECOND food with no measure — the line gave one amount, and the editor saves it on the first', () => {
        expect(matchJudgementOf({ ...LINE, sourceLine: 'salt and pepper' }, 1, 'pepper', 'F-pepper')).toMatchObject({
            quantityLow: null,
            quantityHigh: null,
            unit: null,
        });
    });

    it('keys a SECOND food of a line that states no amount on the line’s words, as the editor saves it', () => {
        const toTaste = { sourceLine: 'salt and pepper to taste', quantity: ABSENT_QUANTITY, unit: 'to taste' };

        expect(matchJudgementOf(toTaste, 1, 'pepper', 'F-pepper')).toMatchObject({
            quantityLow: null,
            quantityHigh: null,
            unit: 'to taste',
        });
    });

    it('keys a RANGE on both bounds and a missing unit as null', () => {
        expect(
            matchJudgementOf({ ...LINE, quantity: { kind: 'range', low: 2, high: 3 }, unit: null }, 0, 'milk', 'F'),
        ).toMatchObject({ quantityLow: 2, quantityHigh: 3, unit: null });
    });

    it('keys an ABSENT amount as null, never zero', () => {
        expect(matchJudgementOf({ ...LINE, quantity: ABSENT_QUANTITY }, 0, 'milk', 'F')).toMatchObject({
            quantityLow: null,
        });
    });

    it('keys a counted line on its size word, the unit the editor saves (ADR-0026 §8)', () => {
        expect(
            matchJudgementOf(
                { sourceLine: '3 large eggs', quantity: { kind: 'exact', value: 3 }, unit: null },
                0,
                'large eggs',
                'F-eggs',
            ),
        ).toMatchObject({ quantityLow: 3, unit: 'large' });
    });

    it('answers nothing for a blank source line — there is nothing to judge', () => {
        expect(matchJudgementOf({ ...LINE, sourceLine: '   ' }, 0, 'milk', 'F')).toBeUndefined();
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

describe('isDefaultRung — the default signal (owner ruling 1)', () => {
    it('reads only the `default` rung as a default', () => {
        expect(isDefaultRung('default')).toBe(true);
        expect(isDefaultRung('exact')).toBe(false);
        expect(isDefaultRung(null)).toBe(false);
    });
});

/**
 * A rung is parsed to recipe-core's `RankTier` once, where it enters the recipe domain (ADR-0071 review, F6): food owns
 * the vocabulary and may publish a rung this build does not know yet, which reads as NO rung rather than a string a
 * later comparison silently fails to match.
 */
describe('rankTierOf — a rung as this build knows it', () => {
    it.each(['base', 'covered', 'head', 'tokenSet', 'default', 'synonym', 'exact'] as const)('keeps %s', (rung) => {
        expect(rankTierOf(rung)).toBe(rung);
    });

    it.each([undefined, null, '', 'superExact'])('reads %j as no rung', (rung) => {
        expect(rankTierOf(rung)).toBeNull();
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

    it('⛔ carries a rung this build does not know as null, never as a stray string', () => {
        expect(candidatesFor(undefined, [{ food: { kind: 'root', id: 'R' }, rung: 'superExact' }])).toStrictEqual([
            { kind: 'root', id: 'R', rung: null },
        ]);
    });

    it('carries an absent rung as null', () => {
        expect(candidatesFor(undefined, [{ food: { kind: 'variant', id: 'V' }, rung: undefined }])).toStrictEqual([
            { kind: 'variant', id: 'V', rung: null },
        ]);
    });
});

/**
 * The JUDGEMENT DIGEST a match row is stored under (ADR-0071 review): the line's digest, the food's phrase and the
 * measure the editor would save for that food. A row is current only while the current parse produces the same digest,
 * so a reparse of the SAME text that reads a different food or measure is matched afresh, which the line digest alone
 * could never see.
 */
describe('matchJudgementDigestOf — what a stored match was computed from', () => {
    /** An identity digest, so a case can read what was hashed. */
    const echo = (input: string): string => input;
    const DIGEST = lineDigest('2 cups whole milk', echo);
    const slot = (overrides: Record<string, unknown> = {}) => ({
        lineDigest: DIGEST,
        line: { sourceLine: '2 cups whole milk', quantity: EXACT_TWO, unit: 'cup', statedMeasure: '2 cups' },
        foodIndex: 0,
        phrase: 'whole milk',
        ...overrides,
    });

    it('is versioned, and the same for the same inputs', () => {
        expect(matchJudgementDigestOf(slot(), echo)).toBe(matchJudgementDigestOf(slot(), echo));
        expect(matchJudgementDigestOf(slot(), echo).startsWith(`${MATCH_JUDGEMENT_VERSION}:`)).toBe(true);
    });

    it.each([
        ['another phrase', { phrase: 'skim milk' }],
        [
            'another amount',
            {
                line: {
                    sourceLine: '2 cups whole milk',
                    quantity: { kind: 'exact', value: 3 },
                    unit: 'cup',
                    statedMeasure: '3 cups',
                },
            },
        ],
        [
            'another unit',
            { line: { sourceLine: '2 cups whole milk', quantity: EXACT_TWO, unit: 'cup', statedMeasure: '2 mugs' } },
        ],
        ['another line', { lineDigest: lineDigest('2 cups milk', echo) }],
        ['another food of the line', { foodIndex: 1 }],
    ])('moves with %s', (_label, overrides) => {
        expect(matchJudgementDigestOf(slot(overrides), echo)).not.toBe(matchJudgementDigestOf(slot(), echo));
    });

    it('does not move with a reparse that saves the same measure in the same words', () => {
        const reparsed = slot({
            line: { sourceLine: '2 cups whole milk', quantity: EXACT_TWO, unit: 'cups', statedMeasure: '2 cups' },
        });

        expect(matchJudgementDigestOf(reparsed, echo)).toBe(matchJudgementDigestOf(slot(), echo));
    });
});

describe('isCurrentMatch — the one currency rule the matcher and the job view share', () => {
    const echo = (input: string): string => input;
    const DIGEST = lineDigest('2 cups whole milk', echo);
    const row = { lineDigest: DIGEST, judgementDigest: 'j1:a' };

    it('is current when the line’s STORED digest and the judgement both still match', () => {
        expect(isCurrentMatch(row, { lineDigest: DIGEST, judgementDigest: 'j1:a' })).toBe(true);
    });

    it('⛔ is stale when the line was edited (its stored digest moved)', () => {
        expect(
            isCurrentMatch(row, { lineDigest: lineDigest('3 cups whole milk', echo), judgementDigest: 'j1:a' }),
        ).toBe(false);
    });

    it('⛔ is stale when the same text was reparsed into another judgement', () => {
        expect(isCurrentMatch(row, { lineDigest: DIGEST, judgementDigest: 'j1:b' })).toBe(false);
    });
});
