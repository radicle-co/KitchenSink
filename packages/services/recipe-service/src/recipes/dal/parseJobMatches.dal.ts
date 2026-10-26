/**
 * `ParseJobMatchesDal` (ADR-0071) — the SQL truth behind {@link ParseJobMatchesPort}: a paste job's match proposals.
 *
 * DESIGN PATTERN: Repository over the shared Drizzle client, the `ParseJobsDal` shape. The rules live in the SQL rather
 * than in service code, so no caller can get them wrong:
 *
 *  1. **The owner filter IS the read's authorization.** `findForJob` joins the job and keeps only the caller's rows, so
 *     a stranger reads nothing rather than another cook's proposals. It joins the LINE too, and returns the line's
 *     stored digest now, so the currency check compares stored digests rather than recomputing one.
 *  2. **A write lands only for the line's CURRENT digest, as the statement runs.** `saveMatches` inserts from a join on
 *     `recipe_parse_job_lines.line_digest`, so a call computed for text the cook edited BEFORE the statement ran inserts
 *     and overwrites nothing. ⚠️ The join does not lock the line row. Under READ COMMITTED an old-digest write that
 *     overlaps a concurrent edit can still land and can replace a newer row. That is harmless: `findForJob` returns the
 *     line's digest NOW with the row, so the old-digest row is not current and is ignored, and the next call replaces it.
 *  3. **First writer wins for one judgement; another judgement replaces.** The upsert updates only a row whose
 *     `judgement_digest` differs, so two concurrent POSTs for the same parse keep the first answer, while an edited or
 *     reparsed line is matched afresh with its enqueue reset to owed.
 *  4. **An enqueue is a CLAIM, and a claim is a LEASE.** `claimEnqueue` takes `enqueued_at` only for a row that still
 *     has the request's digest and key and is owed, and only when it is unclaimed or its last claim is older than the
 *     queue's delivery bound with no identity verdict, no exhausted attempt and no recent attempt on record (the request,
 *     or its verdict write, was lost; the worker's attempt allowance bounds the resends). It returns the rows it
 *     changed, so zero rows IS "someone else holds it". `releaseEnqueue` clears only a row still holding THAT claim.
 *  5. **A curated contradiction is counted ONCE** (`claimCurationReport`): a conditional update of one row, so zero rows
 *     IS "already counted", and a replaced row counts afresh.
 *
 * ⚠️ The claim's timestamp is truncated to milliseconds in SQL: `timestamptz` keeps microseconds and a JS `Date`
 * milliseconds, so an untruncated claim could never be matched again by its own release.
 *
 * A stored row this build cannot read is a THROWN error, not a silently absent match: the writer is this service, so
 * an unreadable row is a defect to surface (the `ParseJobsService` posture).
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { parseStoredLineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import type { RecipeDrizzle } from '../../database/client.js';
import { rankTierOf } from '../domain/matchProposal.js';
import type { FoodRef } from '../../database/schema/foodLookupArm.js';
import { recipeParseJobLines, recipeParseJobs } from '../../database/schema/parseJobs.js';
import { MATCH_PROPOSING_TIERS, MATCH_REVIEWS, recipeParseJobMatches } from '../../database/schema/parseJobMatches.js';
import type {
    EnqueueClaim,
    EnqueueRequest,
    MatchCandidate,
    MatchSlot,
    NewParseJobMatch,
    ParseJobMatch,
    ProposalReview,
    ParseJobMatchesPort,
} from '../domain/parseJobMatch.js';

/** The stored candidates, parsed at the boundary; a rung this build does not know reads as none (`rankTierOf`). */
const storedCandidatesSchema = z.array(
    z.object({
        kind: z.enum(['root', 'variant']),
        id: z.string().min(1),
        rung: z
            .string()
            .nullable()
            .transform((rung) => rankTierOf(rung)),
    }),
);

const proposingTierSchema = z.enum(MATCH_PROPOSING_TIERS);
const reviewSchema = z.enum(MATCH_REVIEWS).nullable();

/**
 * One claimed row, as `RETURNING` answers it. The claim's timestamp comes back as ISO 8601 text (`to_json`), because a
 * raw `execute` hands timestamps back unparsed and the claim must round-trip exactly to its release.
 */
const claimedRowSchema = z.object({
    line_index: z.number().int(),
    food_index: z.number().int(),
    line_digest: z.string().min(1),
    verification_key: z.string().min(1),
    claimed_at: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
});

/** The food arm a row names, or `undefined` for a no-match row. Pure. */
function foodOf(row: { readonly foodId: string | null; readonly foodVariantId: string | null }): FoodRef | undefined {
    if (row.foodId !== null) {
        return { kind: 'root', id: row.foodId };
    }

    return row.foodVariantId === null ? undefined : { kind: 'variant', id: row.foodVariantId };
}

/**
 * A stored row's proposal, review and key, as one of the three shapes the table's CHECKs admit (`ProposalReview`).
 *
 * @throws On a combination the CHECKs forbid: the writer is this service, so a row outside them is a defect to surface.
 */
function proposalReviewOf(row: {
    readonly foodId: string | null;
    readonly foodVariantId: string | null;
    readonly matchedBy: string | null;
    readonly rung: string | null;
    readonly margin: number | null;
    readonly verificationKey: string | null;
    readonly review: string | null;
}): ProposalReview {
    const food = foodOf(row);
    const review = reviewSchema.parse(row.review);

    if (food === undefined) {
        if (review !== null || row.verificationKey !== null) {
            throw new Error('a parse-job match with no food carries a review or a key');
        }

        return { proposal: null, verificationKey: null, review: null };
    }

    const proposal = {
        matchedBy: proposingTierSchema.parse(row.matchedBy),
        food,
        rung: rankTierOf(row.rung),
        margin: row.margin,
    };

    if (review === 'owed' && row.verificationKey !== null) {
        return { proposal, verificationKey: row.verificationKey, review };
    }

    if (review === 'refused' && row.verificationKey === null) {
        return { proposal, verificationKey: null, review };
    }

    throw new Error('a parse-job match with a food has no consistent review');
}

export class ParseJobMatchesDal implements ParseJobMatchesPort {
    public constructor(private readonly db: RecipeDrizzle) {}

    /** @inheritdoc */
    public async findForJob(ownerId: string, jobId: string): Promise<readonly ParseJobMatch[]> {
        const rows = await this.db
            .select({ match: recipeParseJobMatches, lineDigestNow: recipeParseJobLines.lineDigest })
            .from(recipeParseJobMatches)
            .innerJoin(recipeParseJobs, eq(recipeParseJobs.id, recipeParseJobMatches.jobId))
            .innerJoin(
                recipeParseJobLines,
                and(
                    eq(recipeParseJobLines.jobId, recipeParseJobMatches.jobId),
                    eq(recipeParseJobLines.lineIndex, recipeParseJobMatches.lineIndex),
                ),
            )
            .where(and(eq(recipeParseJobMatches.jobId, jobId), eq(recipeParseJobs.ownerId, ownerId)))
            .orderBy(asc(recipeParseJobMatches.lineIndex), asc(recipeParseJobMatches.foodIndex));

        return rows.map(({ match, lineDigestNow }) => {
            const candidates: readonly MatchCandidate[] = storedCandidatesSchema.parse(match.candidates);

            return {
                lineIndex: match.lineIndex,
                foodIndex: match.foodIndex,
                lineDigest: parseStoredLineDigest(match.lineDigest),
                judgementDigest: match.judgementDigest,
                ...proposalReviewOf(match),
                candidates,
                enqueuedAt: match.enqueuedAt,
                lineDigestNow: parseStoredLineDigest(lineDigestNow),
            };
        });
    }

    /** @inheritdoc */
    public async saveMatches(jobId: string, matches: readonly NewParseJobMatch[]): Promise<void> {
        if (matches.length === 0) {
            return;
        }

        const rows = JSON.stringify(
            matches.map((match) => ({
                line_index: match.lineIndex,
                food_index: match.foodIndex,
                line_digest: match.lineDigest,
                judgement_digest: match.judgementDigest,
                matched_by: match.proposal?.matchedBy ?? null,
                food_id: match.proposal?.food.kind === 'root' ? match.proposal.food.id : null,
                food_variant_id: match.proposal?.food.kind === 'variant' ? match.proposal.food.id : null,
                rung: match.proposal?.rung ?? null,
                margin: match.proposal?.margin ?? null,
                candidates: match.candidates.map(({ kind, id, rung }) => ({ kind, id, rung })),
                verification_key: match.verificationKey,
                review: match.review,
            })),
        );

        await this.db.execute(sql`
            INSERT INTO recipe_parse_job_matches
                (job_id, line_index, food_index, line_digest, judgement_digest, matched_by, food_id, food_variant_id,
                 rung, margin, candidates, verification_key, review)
            SELECT ${jobId}::uuid, v.line_index, v.food_index, v.line_digest, v.judgement_digest, v.matched_by,
                   v.food_id, v.food_variant_id, v.rung, v.margin, v.candidates, v.verification_key, v.review
              FROM jsonb_to_recordset(${rows}::jsonb) AS v(
                       line_index integer, food_index integer, line_digest text, judgement_digest text,
                       matched_by text, food_id text, food_variant_id text, rung text, margin double precision,
                       candidates jsonb, verification_key text, review text)
              -- ⛔ Rule 2: only for the line's CURRENT digest as this statement runs (the join takes no lock on the line).
              JOIN recipe_parse_job_lines l
                ON l.job_id = ${jobId}::uuid AND l.line_index = v.line_index AND l.line_digest = v.line_digest
            ON CONFLICT (job_id, line_index, food_index) DO UPDATE
               SET line_digest = EXCLUDED.line_digest,
                   judgement_digest = EXCLUDED.judgement_digest,
                   matched_by = EXCLUDED.matched_by,
                   food_id = EXCLUDED.food_id,
                   food_variant_id = EXCLUDED.food_variant_id,
                   rung = EXCLUDED.rung,
                   margin = EXCLUDED.margin,
                   candidates = EXCLUDED.candidates,
                   verification_key = EXCLUDED.verification_key,
                   review = EXCLUDED.review,
                   -- ⛔ The new proposal has not been asked about: its enqueue is owed again, and its count unmade.
                   enqueued_at = NULL,
                   curation_reported_at = NULL,
                   created_at = now()
             -- ⛔ Rule 3: only another judgement replaces; the same judgement keeps the first writer.
             WHERE recipe_parse_job_matches.judgement_digest <> EXCLUDED.judgement_digest
        `);
    }

    /** @inheritdoc */
    public async claimEnqueue(
        jobId: string,
        requests: readonly EnqueueRequest[],
        staleAfterSeconds: number,
    ): Promise<readonly EnqueueClaim[]> {
        if (requests.length === 0) {
            return [];
        }

        const wanted = JSON.stringify(
            requests.map((request) => ({
                line_index: request.lineIndex,
                food_index: request.foodIndex,
                line_digest: request.lineDigest,
                verification_key: request.verificationKey,
            })),
        );
        const result = await this.db.execute(sql`
            UPDATE recipe_parse_job_matches m
               SET enqueued_at = date_trunc('milliseconds', now())
              FROM jsonb_to_recordset(${wanted}::jsonb) AS r(
                       line_index integer, food_index integer, line_digest text, verification_key text)
             WHERE m.job_id = ${jobId}::uuid
               AND m.line_index = r.line_index
               AND m.food_index = r.food_index
               AND m.line_digest = r.line_digest
               AND m.verification_key = r.verification_key
               AND m.review = 'owed'
               AND (m.enqueued_at IS NULL
                    OR (m.enqueued_at < now() - make_interval(secs => ${staleAfterSeconds})
                        -- ⛔ A verdict counts only if it judged the FOOD, as the dedup read (findExistingKeys) does.
                        AND NOT EXISTS (SELECT 1 FROM recipe_ingredient_verifications v
                                         WHERE v.verification_key = m.verification_key
                                           AND 'identity' = ANY (v.aspects))
                        -- ⛔ An attempt blocks only while it can still be IN FLIGHT or is FINAL: exhausted (the gate
                        -- gave up), or recent. An old unfinished attempt is a lost verdict write: send again, and the
                        -- worker's allowance bounds the retries.
                        AND NOT EXISTS (SELECT 1 FROM recipe_verification_attempts a
                                         WHERE a.verification_key = m.verification_key
                                           AND (a.failure_code IS NOT NULL
                                                OR a.last_received_at
                                                   >= now() - make_interval(secs => ${staleAfterSeconds})))))
            RETURNING m.line_index, m.food_index, m.line_digest, m.verification_key,
                      to_json(m.enqueued_at) #>> '{}' AS claimed_at
        `);

        return z
            .array(claimedRowSchema)
            .parse(result.rows)
            .map((row) => ({
                lineIndex: row.line_index,
                foodIndex: row.food_index,
                lineDigest: parseStoredLineDigest(row.line_digest),
                verificationKey: row.verification_key,
                claimedAt: row.claimed_at,
            }))
            .sort((a, b) => a.lineIndex - b.lineIndex || a.foodIndex - b.foodIndex);
    }

    /** @inheritdoc */
    public async releaseEnqueue(jobId: string, claims: readonly EnqueueClaim[]): Promise<void> {
        if (claims.length === 0) {
            return;
        }

        const held = JSON.stringify(
            claims.map((claim) => ({
                line_index: claim.lineIndex,
                food_index: claim.foodIndex,
                line_digest: claim.lineDigest,
                verification_key: claim.verificationKey,
                claimed_at: claim.claimedAt.toISOString(),
            })),
        );

        await this.db.execute(sql`
            UPDATE recipe_parse_job_matches m
               SET enqueued_at = NULL
              FROM jsonb_to_recordset(${held}::jsonb) AS c(
                       line_index integer, food_index integer, line_digest text, verification_key text,
                       claimed_at timestamptz)
             WHERE m.job_id = ${jobId}::uuid
               AND m.line_index = c.line_index
               AND m.food_index = c.food_index
               AND m.line_digest = c.line_digest
               AND m.verification_key = c.verification_key
               -- ⛔ Only THIS claim: a later claimant's row keeps its lease.
               AND m.enqueued_at = c.claimed_at
        `);
    }

    /** @inheritdoc */
    public async claimCurationReport(
        jobId: string,
        slot: MatchSlot & { readonly verificationKey: string },
    ): Promise<boolean> {
        const won = await this.db
            .update(recipeParseJobMatches)
            .set({ curationReportedAt: sql`now()` })
            .where(
                and(
                    eq(recipeParseJobMatches.jobId, jobId),
                    eq(recipeParseJobMatches.lineIndex, slot.lineIndex),
                    eq(recipeParseJobMatches.foodIndex, slot.foodIndex),
                    eq(recipeParseJobMatches.verificationKey, slot.verificationKey),
                    eq(recipeParseJobMatches.matchedBy, 'curated'),
                    isNull(recipeParseJobMatches.curationReportedAt),
                ),
            )
            .returning({ lineIndex: recipeParseJobMatches.lineIndex });

        return won.length > 0;
    }
}
