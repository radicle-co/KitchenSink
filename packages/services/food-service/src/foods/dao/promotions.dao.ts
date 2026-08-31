/**
 * `PromotionsDao` — the promotion moderation queue's persistence (plan U12, migration 0015).
 *
 * DESIGN PATTERN: **Repository** over `food_promotions` plus the ONE fact-read the candidacy policy
 * needs. The policy (`promotionPolicy.ts`) is pure; this DAO gathers its inputs and executes its
 * decisions, and derives nothing itself.
 *
 * ## ⛔ Phase 1 is ATOMIC and lives here
 *
 * Approval flips the queue row AND the canonical food's visibility in one transaction — the plan's
 * two-phase design draws its phase boundary at the DATABASE boundary (ADR-0006): everything in the food
 * DB commits together (phase 1); the recipe-side mapping rewrite (phase 2) is a separately-driven,
 * idempotent step. A kill between the phases leaves a promoted canonical whose old references still
 * resolve through their authors' own rows — safe, and completed by re-running phase 2.
 *
 * ## Zero rows returned IS the denial
 *
 * `approve`/`reject` predicate on `status = 'pending'`, so a concurrent double-decision (two operators,
 * one row) resolves in the database: the loser updates nothing and is told so — the
 * `resolutionMappings.dal.ts` posture.
 */
import { sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { LABEL_NUTRIENT_MAP } from '../nutrition/labelNutrientMap.js';
import type { PromotionCandidateFood } from '../domain/promotionPolicy.js';

/** One queue row, as the admin surface reads it. */
export interface PromotionQueueRow {
    readonly id: string;
    readonly normalizedName: string;
    readonly candidateFoodIds: readonly string[];
    readonly dataFingerprint: string;
    readonly status: 'pending' | 'approved' | 'rejected';
    readonly canonicalFoodId: string | null;
    readonly createdAt: string;
    readonly decidedAt: string | null;
}

/** The facts one candidacy evaluation needs, read together. */
export interface CandidacyFacts {
    readonly candidates: readonly PromotionCandidateFood[];
    readonly rejectedFingerprints: readonly string[];
    readonly nameAlreadyClaimed: boolean;
}

/** The raw queue row shape. */
interface RawQueueRow {
    [column: string]: unknown;
    id: string;
    normalized_name: string;
    candidate_food_ids: unknown;
    data_fingerprint: string;
    status: string;
    canonical_food_id: string | null;
    created_at: Date | string;
    decided_at: Date | string | null;
}

/** Normalize a timestamptz to ISO-8601. Pure. */
function toIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Map a raw row onto the domain shape. Pure. */
function rowToQueue(row: RawQueueRow): PromotionQueueRow {
    const status = row.status === 'approved' || row.status === 'rejected' ? row.status : 'pending';

    return {
        id: row.id,
        normalizedName: row.normalized_name,
        candidateFoodIds: Array.isArray(row.candidate_food_ids)
            ? row.candidate_food_ids.filter((entry): entry is string => typeof entry === 'string')
            : [],
        dataFingerprint: row.data_fingerprint,
        status,
        canonicalFoodId: row.canonical_food_id,
        createdAt: toIso(row.created_at),
        decidedAt: row.decided_at === null ? null : toIso(row.decided_at),
    };
}

export class PromotionsDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Everything one candidacy evaluation needs, in three reads.
     *
     * The macro pivot selects the SAME canonical `{name, unit}` identities the authored write resolves
     * against ({@link LABEL_NUTRIENT_MAP}), so "the food's calories" here is the number its author wrote —
     * and the `unit` predicate is load-bearing: USDA supplies Energy twice (`kcal` and `kJ`) under one name.
     *
     * @param normalizedName - The name under evaluation.
     * @returns The candidates (live private RESOLVED foods with all four macros), the rejected
     *   fingerprints, and whether the name is already claimed. @sideEffect Reads four tables.
     */
    public async candidacyFacts(normalizedName: string): Promise<CandidacyFacts> {
        const candidates = await this.db.execute<{
            [column: string]: unknown;
            id: string;
            user_id: string;
            created_at: Date | string;
            author_first_seen: Date | string;
            calories: number | string | null;
            protein_g: number | string | null;
            carbs_g: number | string | null;
            fat_g: number | string | null;
        }>(sql`
            SELECT f.id, f.user_id, f.created_at,
                   (SELECT MIN(f2.created_at) FROM food f2 WHERE f2.user_id = f.user_id) AS author_first_seen,
                   MAX(CASE WHEN n.name = ${LABEL_NUTRIENT_MAP.calories.name} AND n.unit = ${LABEL_NUTRIENT_MAP.calories.unit}
                            THEN fn.amount::float8 END) AS calories,
                   MAX(CASE WHEN n.name = ${LABEL_NUTRIENT_MAP.protein.name} AND n.unit = ${LABEL_NUTRIENT_MAP.protein.unit}
                            THEN fn.amount::float8 END) AS protein_g,
                   MAX(CASE WHEN n.name = ${LABEL_NUTRIENT_MAP.carbohydrates.name} AND n.unit = ${LABEL_NUTRIENT_MAP.carbohydrates.unit}
                            THEN fn.amount::float8 END) AS carbs_g,
                   MAX(CASE WHEN n.name = ${LABEL_NUTRIENT_MAP.fat.name} AND n.unit = ${LABEL_NUTRIENT_MAP.fat.unit}
                            THEN fn.amount::float8 END) AS fat_g
            FROM food f
            JOIN food_nutrients fn ON fn.food_id = f.id
            JOIN nutrient n ON n.id = fn.nutrient_id
            WHERE f.normalized_name = ${normalizedName}
              AND f.visibility = 'private'
              AND f.status = 'RESOLVED'
            GROUP BY f.id, f.user_id, f.created_at
        `);

        const rejected = await this.db.execute<{ [column: string]: unknown; data_fingerprint: string }>(sql`
            SELECT data_fingerprint FROM food_promotions
            WHERE normalized_name = ${normalizedName} AND status = 'rejected'
        `);

        const claimed = await this.db.execute<{ [column: string]: unknown; one: number }>(sql`
            SELECT 1 AS one WHERE EXISTS (
                SELECT 1 FROM food_promotions
                WHERE normalized_name = ${normalizedName} AND status IN ('pending', 'approved')
            ) OR EXISTS (
                SELECT 1 FROM food
                WHERE normalized_name = ${normalizedName}
                  AND (user_id IS NULL OR visibility = 'promoted')
            )
        `);

        return {
            candidates: candidates.rows
                // A candidate missing any macro cannot be judged for compatibility — excluded, not defaulted.
                .filter(
                    (row) =>
                        row.calories !== null && row.protein_g !== null && row.carbs_g !== null && row.fat_g !== null,
                )
                .map((row) => ({
                    foodId: row.id,
                    userId: row.user_id,
                    createdAt: toIso(row.created_at),
                    authorFirstSeenAt: toIso(row.author_first_seen),
                    macros: {
                        calories: Number(row.calories),
                        proteinG: Number(row.protein_g),
                        carbsG: Number(row.carbs_g),
                        fatG: Number(row.fat_g),
                    },
                })),
            rejectedFingerprints: rejected.rows.map((row) => row.data_fingerprint),
            nameAlreadyClaimed: claimed.rows.length > 0,
        };
    }

    /**
     * Enqueue a triggered candidacy. Idempotent under concurrency: the pending-name partial unique makes
     * a double-trigger a no-op, never two review items.
     *
     * @returns Whether a row was created. @sideEffect One INSERT.
     */
    public async enqueueCandidacy(input: {
        readonly normalizedName: string;
        readonly candidateFoodIds: readonly string[];
        readonly fingerprint: string;
    }): Promise<boolean> {
        const result = await this.db.execute<{ [column: string]: unknown; id: string }>(sql`
            INSERT INTO food_promotions (normalized_name, candidate_food_ids, data_fingerprint)
            VALUES (${input.normalizedName}, ${JSON.stringify(input.candidateFoodIds)}::jsonb, ${input.fingerprint})
            ON CONFLICT (normalized_name) WHERE status = 'pending' DO NOTHING
            RETURNING id
        `);

        return result.rows.length > 0;
    }

    /** The pending queue, oldest first. @sideEffect Reads `food_promotions`. */
    public async pending(): Promise<PromotionQueueRow[]> {
        const result = await this.db.execute<RawQueueRow>(sql`
            SELECT id, normalized_name, candidate_food_ids, data_fingerprint, status, canonical_food_id,
                   created_at, decided_at
            FROM food_promotions WHERE status = 'pending'
            ORDER BY created_at, id
        `);

        return result.rows.map(rowToQueue);
    }

    /** One queue row by id, any status. @sideEffect Reads `food_promotions`. */
    public async findById(id: string): Promise<PromotionQueueRow | undefined> {
        const result = await this.db.execute<RawQueueRow>(sql`
            SELECT id, normalized_name, candidate_food_ids, data_fingerprint, status, canonical_food_id,
                   created_at, decided_at
            FROM food_promotions WHERE id = ${id}
            LIMIT 1
        `);
        const row = result.rows[0];

        return row === undefined ? undefined : rowToQueue(row);
    }

    /**
     * The election facts for a STORED candidate set: which of the recorded contributing foods are still
     * live private authored rows, and when each was created. The reviewed unit is the stored id set —
     * re-running detection at approval time would elect over data the operator never saw.
     *
     * @param foodIds - The queue row's `candidateFoodIds`.
     * @returns The surviving candidates' `{foodId, createdAt}`. @sideEffect Reads `food`.
     */
    public async electionFacts(
        foodIds: readonly string[],
    ): Promise<ReadonlyArray<{ readonly foodId: string; readonly createdAt: string }>> {
        if (foodIds.length === 0) {
            return [];
        }

        const result = await this.db.execute<{ [column: string]: unknown; id: string; created_at: Date | string }>(sql`
            SELECT id, created_at FROM food
            WHERE id = ANY(${sql.param([...foodIds])}) AND visibility = 'private'
        `);

        return result.rows.map((row) => ({ foodId: row.id, createdAt: toIso(row.created_at) }));
    }

    /**
     * PHASE 1, atomic: decide the pending row and flip the canonical's visibility to `promoted`.
     *
     * ⛔ Both predicates are the authorization: `status = 'pending'` loses the double-decision race
     * cleanly, and `visibility = 'private'` refuses to "promote" a food that is deleted, already
     * promoted, or was never authored. Either miss rolls the whole phase back — an approved queue row
     * pointing at an unpromoted food is exactly the illegal intermediate this transaction exists to
     * make unrepresentable.
     *
     * @returns `true` when the promotion committed; `false` when the row was not pending or the food
     *   not promotable (nothing changed). @sideEffect One transaction over two tables.
     */
    public async approve(id: string, canonicalFoodId: string): Promise<boolean> {
        return this.db
            .transaction(async (tx) => {
                const decided = await tx.execute<{ [column: string]: unknown; id: string }>(sql`
                UPDATE food_promotions
                SET status = 'approved', canonical_food_id = ${canonicalFoodId}, decided_at = now()
                WHERE id = ${id} AND status = 'pending'
                RETURNING id
            `);

                if (decided.rows.length === 0) {
                    return false;
                }

                const promoted = await tx.execute<{ [column: string]: unknown; id: string }>(sql`
                UPDATE food SET visibility = 'promoted'
                WHERE id = ${canonicalFoodId} AND visibility = 'private'
                RETURNING id
            `);

                if (promoted.rows.length === 0) {
                    // Roll phase 1 back whole: the queue must never claim an approval that published nothing.
                    throw new Error(`Canonical food ${canonicalFoodId} is not a promotable private food.`);
                }

                return true;
            })
            .catch((error: unknown) => {
                if (error instanceof Error && error.message.includes('not a promotable private food')) {
                    return false;
                }

                throw error;
            });
    }

    /**
     * Reject the pending row. Its fingerprint then bars identical resubmission forever.
     *
     * @returns Whether the row was pending (zero rows IS the denial). @sideEffect One UPDATE.
     */
    public async reject(id: string): Promise<boolean> {
        const result = await this.db.execute<{ [column: string]: unknown; id: string }>(sql`
            UPDATE food_promotions
            SET status = 'rejected', decided_at = now()
            WHERE id = ${id} AND status = 'pending'
            RETURNING id
        `);

        return result.rows.length > 0;
    }
}
