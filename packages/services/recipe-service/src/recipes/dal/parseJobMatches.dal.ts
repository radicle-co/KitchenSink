/**
 * `ParseJobMatchesDal` (ADR-0071) — the SQL truth behind {@link ParseJobMatchesPort}: a paste job's match proposals.
 *
 * DESIGN PATTERN: Repository over the shared Drizzle client, the `ParseJobsDal` shape. Three rules live in the SQL
 * rather than in service code, so no caller can get them wrong:
 *
 *  1. **The owner filter IS the read's authorization.** `findForJob` joins the job and keeps only the caller's rows, so
 *     a stranger reads nothing rather than another cook's proposals.
 *  2. **First writer wins for one digest; a new digest replaces.** The upsert's `setWhere` updates only a row whose
 *     digest differs, so two concurrent POSTs for the same line text keep the first answer, while a line the cook
 *     edited is matched afresh with its enqueue reset to owed.
 *  3. **An enqueue is a CLAIM.** `claimEnqueue` sets `enqueued_at` only where it is NULL and a key exists, and returns
 *     the rows it changed, so zero rows IS "someone else already sent it". A failed send releases the claim.
 *
 * A stored row this build cannot read is a THROWN error, not a silently absent match: the writer is this service, so
 * an unreadable row is a defect to surface (the `ParseJobsService` posture).
 */
import { and, asc, eq, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import type { RecipeDrizzle } from '../../database/client.js';
import type { FoodRef } from '../../database/schema/foodLookupArm.js';
import { recipeParseJobs } from '../../database/schema/parseJobs.js';
import { MATCH_PROPOSING_TIERS, recipeParseJobMatches } from '../../database/schema/parseJobMatches.js';
import type {
    MatchCandidate,
    MatchSlot,
    NewParseJobMatch,
    ParseJobMatch,
    ParseJobMatchesPort,
} from '../domain/parseJobMatch.js';

/** The stored candidates, parsed at the boundary. */
const storedCandidatesSchema = z.array(
    z.object({ kind: z.enum(['root', 'variant']), id: z.string().min(1), rung: z.string().nullable() }),
);

const proposingTierSchema = z.enum(MATCH_PROPOSING_TIERS);

/** The food arm a row names, or `undefined` for a no-match row. Pure. */
function foodOf(row: { readonly foodId: string | null; readonly foodVariantId: string | null }): FoodRef | undefined {
    if (row.foodId !== null) {
        return { kind: 'root', id: row.foodId };
    }

    return row.foodVariantId === null ? undefined : { kind: 'variant', id: row.foodVariantId };
}

/** The predicate "this row is one of these slots". Pure. */
function slotsPredicate(slots: readonly MatchSlot[]): SQL | undefined {
    return or(
        ...slots.map((slot) =>
            and(
                eq(recipeParseJobMatches.lineIndex, slot.lineIndex),
                eq(recipeParseJobMatches.foodIndex, slot.foodIndex),
            ),
        ),
    );
}

export class ParseJobMatchesDal implements ParseJobMatchesPort {
    public constructor(private readonly db: RecipeDrizzle) {}

    /** @inheritdoc */
    public async findForJob(ownerId: string, jobId: string): Promise<readonly ParseJobMatch[]> {
        const rows = await this.db
            .select({ match: recipeParseJobMatches })
            .from(recipeParseJobMatches)
            .innerJoin(recipeParseJobs, eq(recipeParseJobs.id, recipeParseJobMatches.jobId))
            .where(and(eq(recipeParseJobMatches.jobId, jobId), eq(recipeParseJobs.ownerId, ownerId)))
            .orderBy(asc(recipeParseJobMatches.lineIndex), asc(recipeParseJobMatches.foodIndex));

        return rows.map(({ match }) => {
            const food = foodOf(match);
            const candidates: readonly MatchCandidate[] = storedCandidatesSchema.parse(match.candidates);

            return {
                lineIndex: match.lineIndex,
                foodIndex: match.foodIndex,
                lineDigest: match.lineDigest,
                proposal:
                    food === undefined
                        ? null
                        : {
                              matchedBy: proposingTierSchema.parse(match.matchedBy),
                              food,
                              rung: match.rung,
                              margin: match.margin,
                          },
                candidates,
                verificationKey: match.verificationKey,
                enqueuedAt: match.enqueuedAt,
            };
        });
    }

    /** @inheritdoc */
    public async saveMatches(jobId: string, matches: readonly NewParseJobMatch[]): Promise<void> {
        if (matches.length === 0) {
            return;
        }

        await this.db
            .insert(recipeParseJobMatches)
            .values(
                matches.map((match) => ({
                    jobId,
                    lineIndex: match.lineIndex,
                    foodIndex: match.foodIndex,
                    lineDigest: match.lineDigest,
                    matchedBy: match.proposal?.matchedBy ?? null,
                    foodId: match.proposal?.food.kind === 'root' ? match.proposal.food.id : null,
                    foodVariantId: match.proposal?.food.kind === 'variant' ? match.proposal.food.id : null,
                    rung: match.proposal?.rung ?? null,
                    margin: match.proposal?.margin ?? null,
                    candidates: match.candidates.map(({ kind, id, rung }) => ({ kind, id, rung })),
                    verificationKey: match.verificationKey,
                })),
            )
            .onConflictDoUpdate({
                target: [recipeParseJobMatches.jobId, recipeParseJobMatches.lineIndex, recipeParseJobMatches.foodIndex],
                set: {
                    lineDigest: sql`excluded.line_digest`,
                    matchedBy: sql`excluded.matched_by`,
                    foodId: sql`excluded.food_id`,
                    foodVariantId: sql`excluded.food_variant_id`,
                    rung: sql`excluded.rung`,
                    margin: sql`excluded.margin`,
                    candidates: sql`excluded.candidates`,
                    verificationKey: sql`excluded.verification_key`,
                    // ⛔ The new proposal has not been asked about: its enqueue is owed again.
                    enqueuedAt: sql`NULL`,
                    createdAt: sql`now()`,
                },
                // ⛔ Rule 2: only a stale row (another digest) is replaced; the same digest keeps the first writer.
                setWhere: sql`${recipeParseJobMatches.lineDigest} <> excluded.line_digest`,
            });
    }

    /** @inheritdoc */
    public async claimEnqueue(jobId: string, slots: readonly MatchSlot[]): Promise<readonly MatchSlot[]> {
        if (slots.length === 0) {
            return [];
        }

        const won = await this.db
            .update(recipeParseJobMatches)
            .set({ enqueuedAt: sql`now()` })
            .where(
                and(
                    eq(recipeParseJobMatches.jobId, jobId),
                    isNotNull(recipeParseJobMatches.verificationKey),
                    isNull(recipeParseJobMatches.enqueuedAt),
                    slotsPredicate(slots),
                ),
            )
            .returning({ lineIndex: recipeParseJobMatches.lineIndex, foodIndex: recipeParseJobMatches.foodIndex });

        return [...won].sort((a, b) => a.lineIndex - b.lineIndex || a.foodIndex - b.foodIndex);
    }

    /** @inheritdoc */
    public async releaseEnqueue(jobId: string, slots: readonly MatchSlot[]): Promise<void> {
        if (slots.length === 0) {
            return;
        }

        await this.db
            .update(recipeParseJobMatches)
            .set({ enqueuedAt: null })
            .where(and(eq(recipeParseJobMatches.jobId, jobId), slotsPredicate(slots)));
    }
}
