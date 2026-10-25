/**
 * A paste job's match proposals, as the recipe domain holds them (ADR-0071).
 *
 * One record per parsed (line, food): what the proposal chain proposed, the shortlist the cook may choose from, the key
 * the gate's verdict lives under, and whether the request to the gate is still owed. It is a PROPOSAL and binds
 * nothing; it holds ids only, never a food's name (ADR-0045).
 *
 * @pattern Value Object — the stored match, parsed once at the repository boundary
 */
import type { FoodRef } from '../../database/schema/foodLookupArm.js';
import type { MatchProposingTier } from '../../database/schema/parseJobMatches.js';

/** Which (line, food) of a job a match is about. */
export interface MatchSlot {
    readonly lineIndex: number;
    readonly foodIndex: number;
}

/** One food the cook may choose, in food's ranked order. `rung` is food's, or `null` when food sent none. */
export interface MatchCandidate extends FoodRef {
    readonly rung: string | null;
}

/** What the chain proposed for one food of a line. */
export interface MatchProposal {
    readonly matchedBy: MatchProposingTier;
    /** The proposed food: a root or a variant, at the forward end food answered. */
    readonly food: FoodRef;
    /** The rung food ranked the proposal on, when a ranking tier proposed it and food sent one. */
    readonly rung: string | null;
    /** `top - runnerUp` on the ranker's scale, when one was measured. */
    readonly margin: number | null;
}

/** A match as written: the proposal (or none), the shortlist, and the verdict key. */
export interface NewParseJobMatch extends MatchSlot {
    /** The line's digest when it was matched; a row whose digest no longer equals the line's is stale. */
    readonly lineDigest: string;
    /** `null`: the chain found nothing for this food. */
    readonly proposal: MatchProposal | null;
    /** At most five, food's ranked order. Empty when the chain found nothing. */
    readonly candidates: readonly MatchCandidate[];
    /** The key the gate's verdict for the proposal is stored under; `null` when nothing can be asked. */
    readonly verificationKey: string | null;
}

/** A stored match, with whether its verification request was sent. */
export interface ParseJobMatch extends NewParseJobMatch {
    /** When the request was claimed and sent; `null` means it is owed. */
    readonly enqueuedAt: Date | null;
}

/** The SQL truth the matcher and the job view depend on. Implemented by `dal/parseJobMatches.dal.ts`. */
export interface ParseJobMatchesPort {
    /**
     * The OWNER's job's matches, every digest included (the caller compares digests).
     *
     * @param ownerId - The caller; the owner filter IS the authorization.
     * @param jobId - The job.
     * @returns The matches, by line then food. Empty for a stranger. @sideEffect Reads.
     */
    findForJob(ownerId: string, jobId: string): Promise<readonly ParseJobMatch[]>;
    /**
     * Store matches. A row for the same (line, food) and the SAME digest is left alone, so two concurrent writers
     * agree on the first; a row for a DIFFERENT digest is replaced and its enqueue reset to owed.
     *
     * ⚠️ Not owner-filtered: the caller has already read the job as its owner in this request.
     *
     * @sideEffect Writes.
     */
    saveMatches(jobId: string, matches: readonly NewParseJobMatch[]): Promise<void>;
    /**
     * Claim the verification enqueue for these slots: only rows with a key and no enqueue are claimed, and only one
     * caller wins each.
     *
     * @returns The slots this caller won. @sideEffect Writes `enqueued_at`.
     */
    claimEnqueue(jobId: string, slots: readonly MatchSlot[]): Promise<readonly MatchSlot[]>;
    /** Hand claims back after a failed send, so the next call retries. @sideEffect Writes. */
    releaseEnqueue(jobId: string, slots: readonly MatchSlot[]): Promise<void>;
}
