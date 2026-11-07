/**
 * A paste job's match proposals, as the recipe domain holds them (ADR-0071).
 *
 * One record per parsed (line, food): what the proposal chain proposed, the shortlist the cook may choose from, the key
 * the gate's verdict lives under, and whether the request to the gate is still owed. It is a PROPOSAL and binds
 * nothing; it holds ids only, never a food's name (ADR-0045).
 *
 * @pattern Value Object — the stored match, parsed once at the repository boundary
 */
import type { LineDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import type { RankTier } from '@kitchensink/recipe-core/resolution/ranking-tiers';

import type { FoodRef } from '../../database/schema/foodLookupArm.js';
import type { MATCH_REVIEWS, MatchProposingTier } from '../../database/schema/parseJobMatches.js';

/** Which (line, food) of a job a match is about. */
export interface MatchSlot {
    readonly lineIndex: number;
    readonly foodIndex: number;
}

/** One food the cook may choose, in food's ranked order. `rung` is food's, or `null` when food sent none this build knows. */
export interface MatchCandidate extends FoodRef {
    readonly rung: RankTier | null;
}

/** What the chain proposed for one food of a line. */
export interface MatchProposal {
    readonly matchedBy: MatchProposingTier;
    /** The proposed food: a root or a variant, at the forward end food answered. */
    readonly food: FoodRef;
    /** The rung food ranked the proposal on, when a ranking tier proposed it and food sent one this build knows. */
    readonly rung: RankTier | null;
    /** `top - runnerUp` on the ranker's scale, when one was measured. */
    readonly margin: number | null;
}

/**
 * Where the gate's review of a proposal stands, as the row records it (ADR-0071).
 *
 *  - `owed` — a review is owed under `verificationKey` (sent once `enqueuedAt` is set);
 *  - `refused` — the gate will never be asked: the line is blank or over the gate's cap, or the queue's contract refuses
 *    the request. Persisted when the row is written, so the job view never re-runs the policy to find out.
 */
export type MatchReview = (typeof MATCH_REVIEWS)[number];

/**
 * A proposal, its review and its verdict key, as ONE of three shapes (the table's CHECKs, made a type): nothing proposed
 * has nothing to review; a proposal is owed a review under its key; or it is refused, with no key. A proposal with no
 * review at all is unrepresentable, because it would read as awaiting a review nothing sends.
 */
export type ProposalReview =
    | { readonly proposal: null; readonly verificationKey: null; readonly review: null }
    | { readonly proposal: MatchProposal; readonly verificationKey: string; readonly review: 'owed' }
    | { readonly proposal: MatchProposal; readonly verificationKey: null; readonly review: 'refused' };

/** A match as written: the proposal (or none), the shortlist, and the verdict key. */
export type NewParseJobMatch = MatchSlot & {
    /** The line's stored digest when it was matched. The write only lands while the line still has it. */
    readonly lineDigest: LineDigest;
    /** What the match was computed from (`matchJudgementDigestOf`); a row is current only while it still matches. */
    readonly judgementDigest: string;
    /** At most five, food's ranked order. Empty when the chain found nothing. */
    readonly candidates: readonly MatchCandidate[];
} & ProposalReview;

/** What the chain drafted for one food before food was asked about its proposal: no key, no review yet. */
export type DraftParseJobMatch = Pick<
    NewParseJobMatch,
    'lineIndex' | 'foodIndex' | 'lineDigest' | 'judgementDigest' | 'candidates' | 'proposal'
>;

/** A stored match, with whether its verification request was sent and the line's digest now. */
export type ParseJobMatch = NewParseJobMatch & {
    /** When the request was claimed and sent; `null` means it is owed. */
    readonly enqueuedAt: Date | null;
    /** The line's stored digest NOW, read with the row: the job view compares it rather than recomputing one. */
    readonly lineDigestNow: LineDigest;
};

/** A request to claim one owed review: the slot, the digest and the key it was computed for. */
export interface EnqueueRequest extends MatchSlot {
    readonly lineDigest: LineDigest;
    readonly verificationKey: string;
}

/** A won claim: the request, and the claim's own timestamp, which only this claimant can release. */
export interface EnqueueClaim extends EnqueueRequest {
    readonly claimedAt: Date;
}

/**
 * Whether a stored match is still the line's match: the line's STORED digest is the one it was matched under, and the
 * current parse yields the same judgement. The ONE currency rule the matcher and the job view both apply. Pure.
 *
 * @param match - The stored row's digests.
 * @param current - The line's stored digest now, and the judgement digest of its current parse for that food.
 * @returns Whether the row is current.
 */
export function isCurrentMatch(
    match: Pick<NewParseJobMatch, 'lineDigest' | 'judgementDigest'>,
    current: { readonly lineDigest: LineDigest; readonly judgementDigest: string },
): boolean {
    return match.lineDigest === current.lineDigest && match.judgementDigest === current.judgementDigest;
}

/** The key a slot is held under in a map. Pure. */
export function slotKey(slot: MatchSlot): string {
    return `${String(slot.lineIndex)}:${String(slot.foodIndex)}`;
}

/** The SQL truth the matcher and the job view depend on. Implemented by `dal/parseJobMatches.dal.ts`. */
export interface ParseJobMatchesPort {
    /**
     * The OWNER's job's matches, every digest included, each with its line's stored digest now (the caller compares
     * them with `isCurrentMatch`).
     *
     * @param ownerId - The caller; the owner filter IS the authorization.
     * @param jobId - The job.
     * @returns The matches, by line then food. Empty for a stranger. @sideEffect Reads.
     */
    findForJob(ownerId: string, jobId: string): Promise<readonly ParseJobMatch[]>;
    /**
     * Store matches. A match is written only while its line's CURRENT stored digest is the digest it was computed
     * under, as the statement runs. The check takes no lock on the line, so a write that overlaps a concurrent edit can
     * still land and replace a newer row; that is harmless, because the job view ignores a row whose digest is not the
     * line's digest now, and the next call replaces it. A row for the same (line, food) and the SAME judgement is
     * left alone, so two concurrent writers agree on the first; another judgement replaces it, its enqueue reset.
     *
     * ⚠️ Not owner-filtered: the caller has already read the job as its owner in this request.
     *
     * @sideEffect Writes.
     */
    saveMatches(jobId: string, matches: readonly NewParseJobMatch[]): Promise<void>;
    /**
     * Claim the reviews these requests owe. A claim is a LEASE: a row is won only while it still has the request's
     * digest and key and is owed, and when it is unclaimed, or its last claim is older than `staleAfterSeconds` and no verdict
     * that asked identity, no exhausted attempt and no recent attempt is on record (the request, or its verdict write, was
     * lost). Only one caller wins each.
     *
     * @param jobId - The job.
     * @param requests - The reviews to claim.
     * @param staleAfterSeconds - How long a claim may stand with no trace before it may be taken again.
     * @returns The claims this caller won, each with its own timestamp. @sideEffect Writes `enqueued_at`.
     */
    claimEnqueue(
        jobId: string,
        requests: readonly EnqueueRequest[],
        staleAfterSeconds: number,
    ): Promise<readonly EnqueueClaim[]>;
    /**
     * Hand back claims after a failed send, so the next call retries. Only a row still holding THIS claim (its digest,
     * its key, its timestamp) is released, so one caller can never clear another's.
     *
     * @sideEffect Writes.
     */
    releaseEnqueue(jobId: string, claims: readonly EnqueueClaim[]): Promise<void>;
    /**
     * Claim the ONE count of a curated proposal the review contradicted (ADR-0071 review, item 18): only the first call
     * for a row and its verdict key wins, so a poll loop counts one contradiction once. A replaced row counts afresh.
     *
     * @returns Whether this call won the count. @sideEffect Writes `curation_reported_at`.
     */
    claimCurationReport(jobId: string, slot: MatchSlot & { readonly verificationKey: string }): Promise<boolean>;
}
