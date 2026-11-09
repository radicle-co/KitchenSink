/**
 * The paste review and the saved badge must never disagree about the SAME verdict (ADR-0071 §9, owner ruling
 * 2026-11-08): a proposal the review shows as matched must not save as AMBIGUOUS, so the published page never says
 * "Choose a match" over a line the cook saw as matched.
 *
 * Enumerates every proposing tier x rung x verdict (band x certainty x itemized identity x aspects asked) x review
 * state, and asserts two invariants over `matchStateOf`:
 *
 *  1. `confident` implies the verdict, when there is one, would not badge a saved line AMBIGUOUS (`savedLineAsks`).
 *  2. `confident` implies no review is still owed: a verdict that has not landed yet can still turn it into (1).
 *
 * ⛔ The `curated` tier is excluded until the owner rules on whether a curated mapping may ask (Q1 of the 2026-11-08
 * blueprint); a curated mapping is a person's decision and today stays confident whatever the model says.
 */
import { describe, expect, it } from 'vitest';

import { RANK_TIERS, type RankTier } from '@kitchensink/recipe-core/resolution/ranking-tiers';

import { VERIFICATION_BANDS, savedLineAsks } from '../lineVerification.js';
import { matchStateOf, type MatchFacts, type MatchVerdict } from '../matchState.js';

const TIERS: readonly (readonly [MatchFacts['proposal']])[] = [
    ...RANK_TIERS.map((rung: RankTier) => [{ matchedBy: 'lexical', rung }] as const),
    [{ matchedBy: 'memo', rung: null }] as const,
];
const REVIEWS: readonly MatchFacts['review'][] = ['asked', 'refused', 'exhausted', 'notAsked', 'budgetSpent'];
const CERTAINTIES = ['low', 'medium', 'high'] as const;
const IDENTITY_VERDICTS = ['agree', 'disagree', 'abstain', null] as const;
const ASPECTS = [['identity', 'quantity'], ['identity'], ['quantity']] as const;

const VERDICTS: readonly (MatchVerdict | undefined)[] = [
    undefined,
    ...VERIFICATION_BANDS.flatMap((band) =>
        CERTAINTIES.flatMap((certainty) =>
            IDENTITY_VERDICTS.flatMap((identityVerdict) =>
                ASPECTS.map((aspects) => ({ band, certainty, identityVerdict, aspects })),
            ),
        ),
    ),
];

describe('matchStateOf and the saved badge agree on the same verdict', () => {
    it('enumerates a non-trivial space', () => {
        expect(TIERS.length * VERDICTS.length * REVIEWS.length).toBeGreaterThan(1000);
    });

    it('a confident proposal never saves as AMBIGUOUS and never has a review still owed', () => {
        const violations: string[] = [];

        for (const [proposal] of TIERS) {
            for (const verdict of VERDICTS) {
                for (const review of REVIEWS) {
                    const facts: MatchFacts = {
                        proposal,
                        candidateCount: 3,
                        defaultApplies: false,
                        proposalIsDefault: false,
                        verdict,
                        review,
                    };

                    if (matchStateOf(facts).state !== 'confident') {
                        continue;
                    }

                    const label = JSON.stringify({ proposal, verdict, review });

                    if (verdict !== undefined && savedLineAsks(verdict)) {
                        violations.push(`confident but the saved line would ask: ${label}`);
                    }

                    if (verdict === undefined && review === 'asked') {
                        violations.push(`confident while its review is owed: ${label}`);
                    }
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it('a verdict a saved line would ask about always asks here too', () => {
        for (const [proposal] of TIERS) {
            for (const verdict of VERDICTS) {
                if (verdict === undefined || !savedLineAsks(verdict)) {
                    continue;
                }

                const answer = matchStateOf({
                    proposal,
                    candidateCount: 3,
                    defaultApplies: false,
                    proposalIsDefault: false,
                    verdict,
                    review: 'asked',
                });

                expect(answer.state, JSON.stringify({ proposal, verdict })).toBe('needsChoice');
            }
        }
    });
});
