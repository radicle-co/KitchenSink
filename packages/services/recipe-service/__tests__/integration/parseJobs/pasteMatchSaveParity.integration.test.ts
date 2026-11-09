/**
 * The paste review and the saved line tell ONE story (ADR-0071 §9, owner ruling 2026-11-08), crossing the real seam:
 * the real `ParseJobMatchView` (state derived at read time) over doubled stores, then the real `resolveLineStatus` that a
 * saved line's badge comes from, over the SAME stored verdict.
 *
 * "1 egg" is the shipped defect: the review showed it matched (a remembered match, or an exact name, while the review ran
 * or after it abstained), the cook saved, and the published page said "Choose a match". The timeline here is
 * save -> verdict lands -> read: a line the review showed as matched must never read AMBIGUOUS once saved.
 *
 * The real SQL is the LOCAL e2e tier's; the mocked dependencies are the stores only.
 */
import { describe, expect, it, vi } from 'vitest';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { lineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import { CallerToken } from '../../../src/auth/CallerToken.js';
import { sha256Hex } from '../../../src/common/sha256.js';
import type { FoodRef } from '../../../src/database/schema/foodLookupArm.js';
import type { FoodRefsGateway } from '../../../src/ingredients/foodRefs.gateway.js';
import { canonicalIngredientName } from '../../../src/ingredients/domain/ingredientName.js';
import type { LineVerdictRow } from '../../../src/recipes/dal/lineVerifications.dal.js';
import { identityReadingOf, resolveLineStatus } from '../../../src/recipes/domain/lineVerification.js';
import { matchJudgementDigestOf } from '../../../src/recipes/domain/matchProposal.js';
import type { ParseJobMatch } from '../../../src/recipes/domain/parseJobMatch.js';
import { ParseJobMatchView } from '../../../src/recipes/parseJobMatchView.js';
import type { ParseJobResponse } from '../../../src/recipes/parseJobs.schema.js';

const COOK = { userId: '01JSAVEPARITYCOOK0000000001', principalKind: 'real', containment: 'enforce' } as const;
const CALLER = CallerToken.fromAuthorizationHeader('Bearer cook-token');
const LINE = '1 egg';
const DIGEST = lineDigest(LINE, sha256Hex);
const KEY = 'v2:egg';

const VIEW: ParseJobResponse = {
    id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    status: 'complete',
    createdAt: '2026-11-08T10:00:00.000Z',
    expiresAt: '2026-11-09T10:00:00.000Z',
    lines: [
        {
            lineIndex: 0,
            sourceLine: LINE,
            status: 'parsed',
            proposal: {
                raw: LINE,
                quantity: { kind: 'exact', value: 1 },
                unit: null,
                statedMeasure: null,
                foods: [{ name: 'egg', prep: null }],
                reviewReasons: [],
            },
            progress: null,
        },
    ],
} as unknown as ParseJobResponse;

const ABSTAIN: LineVerdictRow = {
    band: 'inconclusive',
    certainty: 'high',
    identityVerdict: 'abstain',
    aspects: ['identity', 'quantity'],
};
const AGREE: LineVerdictRow = {
    band: 'verified',
    certainty: 'high',
    identityVerdict: 'agree',
    aspects: ['identity', 'quantity'],
};

function matchOf(proposal: ParseJobMatch['proposal']): ParseJobMatch {
    return {
        lineIndex: 0,
        foodIndex: 0,
        lineDigest: DIGEST,
        judgementDigest: matchJudgementDigestOf(
            {
                lineDigest: DIGEST,
                line: { sourceLine: LINE, quantity: { kind: 'exact', value: 1 }, unit: null, statedMeasure: null },
                foodIndex: 0,
                phrase: 'egg',
            },
            sha256Hex,
        ),
        lineDigestNow: DIGEST,
        review: 'owed',
        proposal,
        candidates: [{ kind: 'root', id: 'F-egg', rung: 'exact' }],
        verificationKey: KEY,
        enqueuedAt: new Date(),
    } as ParseJobMatch;
}

/** The state the review shows for the one proposal, given the verdict on record (or none). */
async function reviewState(proposal: ParseJobMatch['proposal'], verdict?: LineVerdictRow): Promise<string | undefined> {
    const view = new ParseJobMatchView(
        { findForJob: vi.fn(async () => [matchOf(proposal)]), claimCurationReport: vi.fn(async () => true) },
        {
            findBandsByKeys: vi.fn(async () => new Map(verdict === undefined ? [] : [[KEY, verdict]])),
            findExhaustedKeys: vi.fn(async () => new Set<string>()),
            findBudgetSpentKeys: vi.fn(async () => new Set<string>()),
        },
        {
            resolve: vi.fn(async (_c: unknown, refs: readonly FoodRef[]) => ({
                answers: new Map(
                    refs.map((ref) => [
                        `${ref.kind}:${ref.id}`,
                        {
                            outcome: 'found',
                            name: canonicalIngredientName('Egg, whole'),
                            status: 'RESOLVED',
                            isPrivate: false,
                            rootId: ref.id,
                        },
                    ]),
                ),
                degraded: false,
            })),
        } as unknown as FoodRefsGateway,
        vi.fn(),
    );

    return (await view.decorate(COOK, CALLER, VIEW)).lines[0]?.proposal?.foods[0]?.match?.state;
}

/** What the saved line reads once the verdict is on record. */
const savedStatus = (verdict: LineVerdictRow) =>
    resolveLineStatus(verdict.band, FoodResolutionStatus.RESOLVED, identityReadingOf(verdict));

const MEMO = { matchedBy: 'memo', food: { kind: 'root', id: 'F-egg' }, rung: null, margin: null } as const;
const EXACT = { matchedBy: 'lexical', food: { kind: 'root', id: 'F-egg' }, rung: 'exact', margin: 0.3 } as const;

describe('paste review and saved badge: "1 egg"', () => {
    it.each([
        ['a remembered match', MEMO],
        ['an exact name', EXACT],
    ] as const)('%s: while the review runs it is checking, never confident', async (_label, proposal) => {
        expect(await reviewState(proposal)).toBe('checking');
    });

    it.each([
        ['a remembered match', MEMO],
        ['an exact name', EXACT],
    ] as const)(
        '%s: an abstaining verdict asks the cook, exactly as the saved line would badge',
        async (_l, proposal) => {
            expect(savedStatus(ABSTAIN)).toBe(FoodResolutionStatus.AMBIGUOUS);
            expect(await reviewState(proposal, ABSTAIN)).toBe('needsChoice');
        },
    );

    it.each([
        ['a remembered match', MEMO],
        ['an exact name', EXACT],
    ] as const)('%s: an agreeing verdict is confident and the saved line is not AMBIGUOUS', async (_l, proposal) => {
        expect(await reviewState(proposal, AGREE)).toBe('confident');
        expect(savedStatus(AGREE)).not.toBe(FoodResolutionStatus.AMBIGUOUS);
    });
});
