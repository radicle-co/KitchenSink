/**
 * Turning a snapshot line plus the paste match view into the facts `bindingOf` decides on (ADR-0072 §7, §10).
 *
 * The things only this adapter can get wrong: the cook's pick applies only against the judgement they saw; a variant pick
 * keeps its kind; a spent budget is read off the SHIPPED reason key; and a reason this build does not know can never read
 * as a confident match (a newer server's key must degrade to "ask the cook", not to "bind it").
 */
import { describe, expect, it } from 'vitest';

import type { ParseProposalMatch } from '../../../recipes/parseJobs.schema.js';
import { BUDGET_SPENT_REASON, foodRefOfId, lineFactsOf } from '../importLineFacts.js';

const root = (id: string) => ({ kind: 'root' as const, id, name: id });
const MATCH: ParseProposalMatch = {
    state: 'confident',
    reason: 'exactName',
    proposed: root('p'),
    candidates: [
        { ...root('p'), isDefault: false },
        { kind: 'variant', id: 'v1', name: 'v1', isDefault: true },
    ],
};
const DIGEST = 'jd-1';
const facts = (match: ParseProposalMatch, pick = undefined as Parameters<typeof lineFactsOf>[0]['pick']) =>
    lineFactsOf({ match, pick, judgementDigest: DIGEST });

describe('lineFactsOf', () => {
    it('carries the state, the reason, the shown proposal and the candidates', () => {
        expect(facts(MATCH)).toStrictEqual({
            state: 'confident',
            reason: 'exactName',
            proposedFoodId: 'p',
            candidates: [
                { foodId: 'p', isDefault: false },
                { foodId: 'v1', isDefault: true },
            ],
            budgetSpent: false,
            cookChoice: undefined,
        });
    });

    it('has no proposed food when the view shows none', () => {
        expect(
            facts({ ...MATCH, state: 'needsChoice', reason: 'noProposal', proposed: null }).proposedFoodId,
        ).toBeUndefined();
    });

    describe('the cook’s pick', () => {
        it('applies against the digest it was made on: a food, a variant, or keep as written', () => {
            expect(facts(MATCH, { foodId: 'x', againstDigest: DIGEST }).cookChoice).toStrictEqual({
                kind: 'food',
                foodId: 'x',
            });
            expect(facts(MATCH, { foodVariantId: 'v9', againstDigest: DIGEST }).cookChoice).toStrictEqual({
                kind: 'food',
                foodId: 'v9',
            });
            expect(facts(MATCH, { asWritten: true, againstDigest: DIGEST }).cookChoice).toStrictEqual({
                kind: 'asWritten',
            });
        });

        it('⛔ is ignored once the judgement changed under it (the cook chose against something else)', () => {
            expect(facts(MATCH, { foodId: 'x', againstDigest: 'an-older-digest' }).cookChoice).toBeUndefined();
        });
    });

    describe('the spent budget (ADR-0072 §10)', () => {
        it('is read off the shipped reason key', () => {
            expect(BUDGET_SPENT_REASON).toBe('reviewBudgetSpent');
            expect(
                facts({
                    state: 'needsChoice',
                    reason: BUDGET_SPENT_REASON,
                    proposed: null,
                    candidates: MATCH.candidates,
                }).budgetSpent,
            ).toBe(true);
            expect(facts(MATCH).budgetSpent).toBe(false);
        });
    });

    describe('a reason this build does not know', () => {
        it('⛔ never reads as confident, and is never a budget spent', () => {
            const answered = facts({ ...MATCH, reason: 'someNewerReason' });

            expect(answered.state).toBe('needsChoice');
            expect(answered.budgetSpent).toBe(false);
        });

        it('keeps a non-confident state as it is', () => {
            expect(facts({ ...MATCH, state: 'checking', reason: 'someNewerReason' }).state).toBe('checking');
        });
    });
});

describe('foodRefOfId', () => {
    it('finds the kind of a food from what the view showed, so the importer binds a root and a variant correctly', () => {
        expect(foodRefOfId(MATCH, undefined, 'p')).toStrictEqual({ kind: 'root', id: 'p' });
        expect(foodRefOfId(MATCH, undefined, 'v1')).toStrictEqual({ kind: 'variant', id: 'v1' });
        expect(foodRefOfId(MATCH, undefined, 'zzz')).toBeUndefined();
    });

    it('⛔ takes the kind of a food the COOK picked from the pick itself, not from the shortlist (a search result is no candidate)', () => {
        expect(
            foodRefOfId(MATCH, { foodVariantId: 'v-found-by-search', againstDigest: DIGEST }, 'v-found-by-search'),
        ).toStrictEqual({
            kind: 'variant',
            id: 'v-found-by-search',
        });
        expect(
            foodRefOfId(MATCH, { foodId: 'r-found-by-search', againstDigest: DIGEST }, 'r-found-by-search'),
        ).toStrictEqual({
            kind: 'root',
            id: 'r-found-by-search',
        });
    });
});
