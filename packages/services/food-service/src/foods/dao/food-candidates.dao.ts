/**
 * `CandidateStore` (T-111, MOD-018) — persists a food's per-source candidate set backing the
 * `UNRESOLVED` / disambiguation flow (US-2a). Stores ONLY disambiguation metadata
 * (`source`, `external_key`, `name`, `summary`) — no nutrient amounts, portions, or scalar fields
 * (no-raw-payload; the `UNIQUE(food_id, nutrient_id)` golden invariant forbids per-candidate value
 * rows). `created_at` is the candidate-set TTL anchor: `getCandidates` excludes a set older than 30
 * days (FR-025a). `clear` consumes the set on resolve; deleting the parent food cascades the rows.
 *
 * @implements FR-025a FR-028 FR-MRG-5 FR-RES-1 FR-RES-2
 */
import { and, eq, sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { foodCandidates, type FoodCandidateRow } from '../../db/schema/index.js';
import { newFoodId } from '../../db/ulid.js';
import type { FoodSource } from './food-sources.dao.js';

/** The 30-day candidate-set TTL window (FR-025a). */
const CANDIDATE_TTL = sql`interval '30 days'`;

/** One per-source candidate to persist for an `UNRESOLVED` food (metadata only). */
export interface CandidateInput {
    /** The source the candidate came from. */
    source: FoodSource;
    /** That source's item key for the candidate. */
    externalKey: string;
    /** Candidate display name. */
    name: string;
    /** Optional one-line disambiguation summary. */
    summary?: string | null;
}

/** Input for {@link CandidateStore.persistCandidates}. */
export interface PersistCandidatesInput {
    /** Internal food id the candidate set belongs to. */
    foodId: string;
    /** The surviving candidate set. */
    candidates: CandidateInput[];
}

/** Input for {@link CandidateStore.isMember}. */
export interface IsMemberInput {
    /** Internal food id. */
    foodId: string;
    /** Candidate row id to validate. */
    candidateId: string;
}

export class CandidateStore {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Persist the surviving candidate set for an `UNRESOLVED` food (idempotent on
     * `(food_id, source, external_key)` — a duplicate updates `name`/`summary`).
     *
     * @param input - The food id and its candidate set.
     * @sideEffect Inserts/updates `food_candidates`.
     */
    public async persistCandidates(input: PersistCandidatesInput): Promise<void> {
        if (input.candidates.length === 0) {
            return;
        }

        await this.db
            .insert(foodCandidates)
            .values(
                input.candidates.map((candidate) => ({
                    id: newFoodId(),
                    foodId: input.foodId,
                    source: candidate.source,
                    externalKey: candidate.externalKey,
                    name: candidate.name,
                    summary: candidate.summary ?? null,
                })),
            )
            .onConflictDoUpdate({
                target: [foodCandidates.foodId, foodCandidates.source, foodCandidates.externalKey],
                set: { name: sql`excluded.name`, summary: sql`excluded.summary` },
            });
    }

    /**
     * List a food's candidate set, excluding a set older than the 30-day TTL (FR-025a). An expired
     * set returns `[]`, after which the next add-by-name re-fans-out.
     *
     * @param foodId - Internal food id.
     * @returns The non-expired candidate rows.
     * @sideEffect Reads `food_candidates`.
     */
    public async getCandidates(foodId: string): Promise<FoodCandidateRow[]> {
        return this.db
            .select()
            .from(foodCandidates)
            .where(and(eq(foodCandidates.foodId, foodId), sql`${foodCandidates.createdAt} > now() - ${CANDIDATE_TTL}`));
    }

    /**
     * Validate that a candidate id belongs to a food's own set (the PATCH-resolve membership guard,
     * FR-RES-2 — an out-of-set pick is rejected by the caller).
     *
     * @param input - The food id and candidate id to check.
     * @returns `true` when the candidate belongs to the food.
     * @sideEffect Reads `food_candidates`.
     */
    public async isMember(input: IsMemberInput): Promise<boolean> {
        const rows = await this.db
            .select({ id: foodCandidates.id })
            .from(foodCandidates)
            .where(and(eq(foodCandidates.id, input.candidateId), eq(foodCandidates.foodId, input.foodId)))
            .limit(1);

        return rows.length === 1;
    }

    /**
     * Clear a food's candidate set (on resolve or candidate-set expiry).
     *
     * @param foodId - Internal food id.
     * @returns The number of cleared rows.
     * @sideEffect Deletes from `food_candidates`.
     */
    public async clear(foodId: string): Promise<number> {
        const result = await this.db.delete(foodCandidates).where(eq(foodCandidates.foodId, foodId));

        return result.rowCount ?? 0;
    }

    /**
     * Expire every candidate set older than `ttlDays` (the change-refresh sweep, T-172/FR-025a). The
     * owning `UNRESOLVED` food is deliberately left untouched — it is **never** swept to `NOT_FOUND`;
     * only its stale disambiguation metadata is dropped so `food_candidates` stays bounded and the next
     * add-by-name re-fans-out. `ttlDays` is `FOOD_UNRESOLVED_TTL_DAYS` (default 30, config-overridable).
     *
     * @param ttlDays - The candidate-set TTL in days.
     * @returns The number of expired rows cleared.
     * @sideEffect Deletes from `food_candidates`.
     */
    public async clearExpired(ttlDays: number): Promise<number> {
        const result = await this.db.execute(sql`
            DELETE FROM food_candidates WHERE created_at < now() - make_interval(days => ${ttlDays})
        `);

        return result.rowCount ?? 0;
    }
}
