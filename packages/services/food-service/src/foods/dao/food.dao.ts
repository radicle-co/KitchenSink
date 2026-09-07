/**
 * `FoodDao` (T-105, MOD-016) — per-aggregate DAO for the golden `food` record. Owns add-by-name
 * dedup (`createByName`), the guarded legal status-transition set (`setStatus`), scalar golden-field
 * writes (`upsertGoldenScalars`), and the golden-record aggregate read (`readGoldenRecord`). A food's
 * identity is ALWAYS the internal ULID `id`, NEVER a source-native key (R1/FR-IDN-1); no source term
 * leaks into the read shape (FR-ADP-1/SC-013).
 *
 * @implements FR-002 FR-005 FR-013 FR-025 FR-028 FR-028a FR-IDN-1
 */
import { eq, sql, type SQL } from 'drizzle-orm';

import { settingFromEnv } from '../../config/env.schema.js';
import type { FoodDrizzle } from '../../database/database.module.js';
import {
    food,
    foodFieldProvenance,
    foodNutrientView,
    foodPopularity,
    foodNutrients,
    foodOriginEnum,
    foodPortions,
    foodSources,
    foodStatusEnum,
    nutrient,
    type FoodRow,
} from '../../db/schema/index.js';
import { newFoodId } from '../../db/ulid.js';
import { IllegalStatusTransitionError } from './dao.errors.js';

/** The `food.status` lifecycle set (FR-028). */
export type FoodStatus = (typeof foodStatusEnum.enumValues)[number];

/** A scalar nutrient value, joined to its dictionary entry, in the golden read shape. */
export interface GoldenNutrient {
    /** Internal nutrient dictionary id. */
    nutrientId: string;
    /** Nutrient display name (e.g. `Protein`). */
    name: string;
    /** Unit the amount is expressed in (e.g. `g`). */
    unit: string;
    /** Stable external code (INFOODS tagname) when known, else `null`. */
    externalCode: string | null;
    /** Arbitrary-precision amount as a string (no float drift, SC-008). */
    amount: string;
    /** Amount basis (`per_100g` by default). */
    basis: string;
    /** Crosswalk row id that supplied this value, or NULL for an author-written one (0013, plan U10). */
    sourceId: string | null;
}

/** A household-measure portion in the golden read shape. */
export interface GoldenPortion {
    /** Internal portion row id. */
    id: string;
    /** Human label (e.g. `1 cup`). */
    label: string;
    /** Gram weight as a string (numeric, strictly positive). */
    gramWeight: string;
    /** Crosswalk row id that supplied this portion, or NULL for an authored one (0013, plan U10). */
    sourceId: string | null;
}

/** A crosswalk entry in the golden read shape (no raw payload). */
export interface GoldenSource {
    /** Crosswalk row id (the per-value `source_id` target). */
    id: string;
    /** Source identifier (e.g. `usda`). */
    source: string;
    /** That source's primary key for the item. */
    externalKey: string;
    /** Per-item version/etag when known. */
    itemVersion: string | null;
    /** Operational fetch state. */
    fetchState: string;
    /** ISO-8601 fetch timestamp. */
    fetchedAt: string;
}

/** A scalar-field provenance entry in the golden read shape. */
export interface GoldenFieldProvenance {
    /** The controlled scalar field. */
    field: string;
    /** Crosswalk row id that supplied the field's winning value. */
    sourceId: string;
}

/**
 * The assembled golden record (FR-028): the `food` scalars plus its crosswalk, normalized nutrient
 * values, portions, and scalar-field provenance. Dates are ISO-8601 strings (CODING_STANDARDS); the
 * shape carries NO source-native identifier (`fdcId`), only the internal `id` (SC-013).
 */
export interface GoldenFoodRecord {
    id: string;
    name: string | null;
    description: string | null;
    kind: string;
    brandOwner: string | null;
    brandName: string | null;
    barcode: string | null;
    status: FoodStatus;
    tombstonedAt: string | null;
    createdAt: string;
    updatedAt: string;
    sources: GoldenSource[];
    nutrients: GoldenNutrient[];
    portions: GoldenPortion[];
    fieldProvenance: GoldenFieldProvenance[];
    /** U5: the FNDDS consumption-prior fraction in [0, 1], or `null` when the food has none. */
    priorFraction: number | null;
    /** The author's app-user ULID, or `null` for a catalog row (0013, plan U10). */
    userId: string | null;
    /** The 0013 visibility state (`public` is catalog-only; the CHECK guarantees coherence). */
    visibility: 'public' | 'private' | 'promoted';
}

/**
 * One stored nutrient value in the batch-read shape — the view's columns, unchanged.
 *
 * Structurally the `NutrientRow` that `nutrition/nutrientSelection.ts` selects over, minus the `number`
 * conversion: `amount` is `numeric`, which node-postgres returns as a STRING (full precision, no float
 * drift — SC-008). Converting it is the caller's job, at the one seam that already does it.
 */
export interface StoredNutrientAmount {
    /** Nutrient display name, from the dictionary. */
    readonly nutrient: string;
    /** Unit the amount is expressed in — part of the nutrient's IDENTITY, not decoration. */
    readonly unit: string;
    /** `per_100g` | `per_serving`, carried through unfiltered. */
    readonly basis: string;
    /** Arbitrary-precision amount as a string. */
    readonly amount: string;
}

/** One stored portion in the batch-read shape (`gram_weight` is `numeric` → string, as above). */
export interface StoredPortionWeight {
    /** Human label (e.g. `1 cup chopped`). */
    readonly label: string;
    /** Gram weight of the whole label amount, as a string. */
    readonly gramWeight: string;
}

/**
 * One food's nutrition-relevant rows, as returned by {@link FoodDao.readNutritionBatch}. A subset of
 * {@link GoldenFoodRecord} — no crosswalk, no scalar provenance, no per-value `source_id` — because the
 * batch-nutrition projection reads none of them and fetching them would put the N+1 back in a new shape.
 */
export interface NutritionRecord {
    /** The internal food id. */
    readonly id: string;
    /** The food's lifecycle status, reported whatever it is (a PENDING food still rides the wire). */
    readonly status: FoodStatus;
    /** Every stored nutrient value for the food, in no guaranteed order. */
    readonly nutrients: readonly StoredNutrientAmount[];
    /** The food's portions, in insertion order. */
    readonly portions: readonly StoredPortionWeight[];
}

/** Input for {@link FoodDao.createByName}. */
export interface CreateByNameInput {
    /** The lowercased+trimmed dedup key (FR-005). */
    normalizedName: string;
    /** Original display name to store on first create. */
    displayName?: string | null;
}

/** Result of {@link FoodDao.createByName} (always returns a row). */
export interface CreateByNameResult {
    /** The food's internal id (existing on a dedup hit). */
    id: string;
    /** `true` only when this call inserted a fresh row. */
    created: boolean;
    /** `true` when a terminal-state row past its configured TTL was reset to `PENDING` (FR-028a). */
    reactivated: boolean;
}

/** Input for {@link FoodDao.setStatus}. */
export interface SetStatusInput {
    /** The food id. */
    id: string;
    /** The target lifecycle status. */
    status: FoodStatus;
    /** Optional explicit tombstone timestamp (ISO-8601); defaults to `now()` for terminal targets. */
    tombstonedAt?: string;
}

/** The data-provenance class of a golden record (`food.origin`, 0003 migration). */
export type FoodOrigin = (typeof foodOriginEnum.enumValues)[number];

/** Input for {@link FoodDao.markOrigin}. */
export interface MarkOriginInput {
    /** The food id. */
    id: string;
    /** The target provenance class. */
    origin: FoodOrigin;
}

/** Input for {@link FoodDao.upsertGoldenScalars}. */
export interface GoldenScalars {
    /** The food id. */
    id: string;
    name?: string | null;
    description?: string | null;
    kind?: 'generic' | 'branded';
    brandOwner?: string | null;
    brandName?: string | null;
    barcode?: string | null;
    /** The flattened curated-alias text (`foodAliases.joinAliases`), or `null` for a food with none. */
    aliases?: string | null;
}

/** Narrow the 0013 visibility text column; the CHECK makes anything else a defect worth throwing on. Pure. */
function narrowVisibility(visibility: string): 'public' | 'private' | 'promoted' {
    if (visibility === 'public' || visibility === 'private' || visibility === 'promoted') {
        return visibility;
    }

    throw new Error(`unknown food visibility '${visibility}'`);
}

/** Two-int advisory-lock classid for per-name dedup (DSN-15) — distinct from the drainer/limiter classes. */
const LOCK_CLASS_DEDUP = 2;

/** Options for {@link FoodDao}. */
export interface FoodDaoOptions {
    /**
     * Terminal-row (`NOT_FOUND`/`FAILED`) TTL in days, past which {@link FoodDao.createByName} reactivates
     * a tombstone to `PENDING` (FR-025/FR-028a). Defaults to the configured `FOOD_NOT_FOUND_TTL_DAYS`
     * (30 when unset).
     *
     * Resolved HERE rather than at each composition root, for the reason recorded on
     * `FetchQueueDaoOptions.demoteThreshold`: a caller that forgets to pass the configured value falls
     * back to a built-in one silently. This variable was worse than that — boot-validated and documented,
     * with NO consumer at all, because the statement carried `interval '30 days'` as a literal.
     */
    readonly notFoundTtlDays?: number;
}

/**
 * Legal status-transition set (FR-028a) expressed as the set of prior statuses from which each
 * target is reachable. `setStatus` runs a conditional UPDATE gated on this prior set, so an illegal
 * transition matches no row (`rowCount=0`) and is rejected without mutating the record.
 */
const LEGAL_PRIORS: Record<FoodStatus, readonly FoodStatus[]> = {
    // `AWAITING_RETRY` is a legal prior EVERYWHERE `PENDING` is (U9): a retrying food can still resolve,
    // still turn out to need disambiguation, still be found absent, and still exhaust its budget. Omitting
    // it from any of these would make the first failure a dead end — the food would be stuck retrying with
    // no legal transition out, and `setStatus` rejects an illegal move by matching no row, silently.
    PENDING: ['FAILED', 'NOT_FOUND', 'AWAITING_RETRY'],
    RESOLVED: ['PENDING', 'UNRESOLVED', 'AWAITING_RETRY', 'DELETING'],
    UNRESOLVED: ['PENDING', 'AWAITING_RETRY'],
    NOT_FOUND: ['PENDING', 'AWAITING_RETRY'],
    FAILED: ['PENDING', 'AWAITING_RETRY'],
    // Reached on a real source failure that has NOT exhausted the budget — from a first attempt
    // (`PENDING`) or from a previous retry (itself).
    AWAITING_RETRY: ['PENDING', 'AWAITING_RETRY'],
    // U18's tombstone-first refusal window (Q3b/R22): only a live golden record can begin deleting, and
    // the ONLY way back is RESOLVED (the referenced/kept outcome) — every other exit is a physical DELETE.
    DELETING: ['RESOLVED'],
};

export class FoodDao {
    /**
     * The terminal-row / NOT_FOUND TTL as a SQL interval (FR-025/FR-028a), bound as a parameter so the
     * configured value reaches Postgres instead of being baked into the statement text.
     *
     * Resolved per instance, not at module load: a malformed value must fail where an operator can
     * attribute it (constructing this DAO), not as an import-time crash in whichever module happens to
     * pull the file in first — and a frozen module constant made the knob unobservable to any test.
     */
    private readonly terminalTtl: SQL;

    /**
     * @param db - The food-schema Drizzle client.
     * @param options - Optional tombstone-TTL override (defaults to `FOOD_NOT_FOUND_TTL_DAYS`).
     */
    public constructor(
        private readonly db: FoodDrizzle,
        options?: FoodDaoOptions,
    ) {
        this.terminalTtl = sql`make_interval(days => ${options?.notFoundTtlDays ?? settingFromEnv('FOOD_NOT_FOUND_TTL_DAYS')})`;
    }

    /**
     * Fetch the raw `food` row by internal id.
     *
     * @param id - The internal food id.
     * @returns The row, or `undefined` when absent.
     * @sideEffect Reads `food`.
     */
    public async getById(id: string): Promise<FoodRow | undefined> {
        const rows = await this.db.select().from(food).where(eq(food.id, id)).limit(1);

        return rows[0];
    }

    /**
     * Add-by-name with normalized-name dedup (FR-005/FR-013/FR-028a). A single
     * `INSERT … ON CONFLICT (normalized_name) DO UPDATE … RETURNING` always returns a row: a fresh add
     * inserts a `PENDING` row; a duplicate collapses to the existing `id`; a terminal-state
     * (`NOT_FOUND`/`FAILED`) row PAST its configured TTL (`FOOD_NOT_FOUND_TTL_DAYS`, default 30 days) is
     * reactivated to `PENDING` (never a `23505`). A
     * short per-name advisory lock (DSN-15) serializes same-name adds; the `UNIQUE(normalized_name)`
     * index is the durable backstop. `created` distinguishes insert (`xmax=0`) from conflict; the
     * reactivation flag is computed from the row's pre-update state captured in the CTE.
     *
     * @param input - The normalized dedup key + optional display name.
     * @returns `{ id, created, reactivated }`.
     * @sideEffect Inserts or updates `food`; takes a transaction-scoped advisory lock.
     */
    public async createByName(input: CreateByNameInput): Promise<CreateByNameResult> {
        const { normalizedName } = input;
        const displayName = input.displayName ?? null;

        return this.db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_CLASS_DEDUP}, hashtext(${normalizedName}))`);

            const newId = newFoodId();
            const result = await tx.execute<{ id: string; inserted: boolean; reactivated: boolean }>(sql`
                WITH existing AS (
                    SELECT id, status, tombstoned_at FROM food
                     WHERE normalized_name = ${normalizedName}
                       -- ⛔ CATALOG rows only (0013, plan U10). Without this, add-by-name would dedup
                       -- against another user's PRIVATE authored food — returning its id to a stranger
                       -- and binding their recipe to a row the author may edit or delete at will.
                       AND user_id IS NULL
                ),
                upserted AS (
                    INSERT INTO food (id, name, normalized_name, status)
                    VALUES (${newId}, ${displayName}, ${normalizedName}, 'PENDING')
                    -- ⚠️ The WHERE names the PARTIAL catalog unique as the arbiter (0013 split the old
                    -- full-table index in two); without it Postgres finds no matching constraint and the
                    -- whole statement errors. The inserted row's user_id is NULL, so the arbiter applies.
                    ON CONFLICT (normalized_name) WHERE user_id IS NULL DO UPDATE SET
                        status = CASE
                            WHEN food.status IN ('NOT_FOUND', 'FAILED')
                                 AND food.tombstoned_at < now() - ${this.terminalTtl}
                            THEN 'PENDING'::food_status ELSE food.status END,
                        tombstoned_at = CASE
                            WHEN food.status IN ('NOT_FOUND', 'FAILED')
                                 AND food.tombstoned_at < now() - ${this.terminalTtl}
                            THEN NULL ELSE food.tombstoned_at END,
                        updated_at = CASE
                            WHEN food.status IN ('NOT_FOUND', 'FAILED')
                                 AND food.tombstoned_at < now() - ${this.terminalTtl}
                            THEN now() ELSE food.updated_at END
                    RETURNING id, (xmax = 0) AS inserted
                )
                SELECT
                    u.id,
                    u.inserted,
                    COALESCE(
                        e.status IN ('NOT_FOUND', 'FAILED') AND e.tombstoned_at < now() - ${this.terminalTtl},
                        false
                    ) AS reactivated
                FROM upserted u
                LEFT JOIN existing e ON e.id = u.id
            `);

            const row = result.rows[0];

            if (!row) {
                // Unreachable: the upsert always returns exactly one row.
                throw new Error('createByName produced no row');
            }

            return { id: row.id, created: row.inserted, reactivated: row.reactivated };
        });
    }

    /**
     * Apply a guarded legal status transition (FR-028a). Runs a conditional UPDATE gated on the
     * {@link LEGAL_PRIORS} set for the target; an illegal transition (or unknown id) matches no row and
     * throws {@link IllegalStatusTransitionError}, leaving the record unchanged. Transitioning to a
     * terminal status (`NOT_FOUND`/`FAILED`) stamps `tombstoned_at` (the TTL anchor, FR-025); any other
     * target clears it.
     *
     * @param input - The food id, target status, and optional tombstone timestamp.
     * @returns The updated row.
     * @throws {IllegalStatusTransitionError} when the transition is not legal (`rowCount=0`).
     * @sideEffect Updates `food.status` / `tombstoned_at` / `updated_at`.
     */
    public async setStatus(input: SetStatusInput): Promise<FoodRow> {
        const { id, status } = input;
        const priors = LEGAL_PRIORS[status];
        const isTerminal = status === 'NOT_FOUND' || status === 'FAILED';
        const tombExpr = isTerminal ? sql`COALESCE(${input.tombstonedAt ?? null}::timestamptz, now())` : sql`NULL`;
        const priorList = sql.join(
            priors.map((prior) => sql`${prior}::food_status`),
            sql`, `,
        );

        const result = await this.db.execute(sql`
            UPDATE food
            SET status = ${status}::food_status,
                tombstoned_at = ${tombExpr},
                updated_at = now()
            WHERE id = ${id} AND status IN (${priorList})
            RETURNING id
        `);

        if ((result.rowCount ?? 0) !== 1) {
            throw new IllegalStatusTransitionError(id, status);
        }

        const updated = await this.getById(id);

        if (!updated) {
            throw new IllegalStatusTransitionError(id, status);
        }

        return updated;
    }

    /**
     * Write the golden scalar fields of a `food` row (merge winners, FR-MRG-2). Only the provided
     * fields are touched; `updated_at` is bumped.
     *
     * @param scalars - The food id plus the scalar fields to set.
     * @returns The updated row, or `undefined` when the id does not exist.
     * @sideEffect Updates `food` scalar columns.
     */
    public async upsertGoldenScalars(scalars: GoldenScalars): Promise<FoodRow | undefined> {
        const patch: Partial<FoodRow> = { updatedAt: new Date() };

        if (scalars.name !== undefined) {
            patch.name = scalars.name;
        }

        if (scalars.description !== undefined) {
            patch.description = scalars.description;
        }

        if (scalars.kind !== undefined) {
            patch.kind = scalars.kind;
        }

        if (scalars.brandOwner !== undefined) {
            patch.brandOwner = scalars.brandOwner;
        }

        if (scalars.brandName !== undefined) {
            patch.brandName = scalars.brandName;
        }

        if (scalars.barcode !== undefined) {
            patch.barcode = scalars.barcode;
        }

        if (scalars.aliases !== undefined) {
            patch.aliases = scalars.aliases;
        }

        const rows = await this.db.update(food).set(patch).where(eq(food.id, scalars.id)).returning();

        return rows[0];
    }

    /**
     * Classify a food's data provenance (`food.origin`, 0003 migration). Marking a food `bulk` is what
     * REMOVES it from the live change-refresh scan (`listResolvedBackingItems`) — see F-C2: a bulk row's
     * content-derived `item_version` can never equal an API version, so an unexcluded bulk food would be
     * re-enqueued on every sweep AND have its lab-analyzed nutrition clobbered with API values.
     *
     * Deliberately NOT folded into {@link upsertGoldenScalars}: `origin` is not a merge-winner scalar —
     * no source supplies it and no merge may overwrite it. It is also NOT a status transition, so it is
     * safe to call at any point in the lifecycle (the bulk importer calls it while the food is still
     * PENDING, so the food is never visible to the scan as a refreshable RESOLVED row).
     *
     * @param input - The food id + target provenance class.
     * @sideEffect Updates `food.origin` (and `updated_at`).
     */
    public async markOrigin(input: MarkOriginInput): Promise<void> {
        await this.db.update(food).set({ origin: input.origin, updatedAt: new Date() }).where(eq(food.id, input.id));
    }

    /**
     * Bump a food's `updated_at` without changing its status or scalars (change-refresh in-place
     * re-pull, T-171). The food stays at its current lifecycle status — a refresh of a `RESOLVED` food
     * never transitions it (so {@link setStatus} is deliberately NOT called: `RESOLVED → RESOLVED` is
     * not in the legal-transition set).
     *
     * @param id - The internal food id.
     * @sideEffect Updates `food.updated_at`.
     */
    public async touch(id: string): Promise<void> {
        await this.db.update(food).set({ updatedAt: new Date() }).where(eq(food.id, id));
    }

    /**
     * Assemble the golden record (FR-028): the `food` scalars joined with its crosswalk, normalized
     * nutrient values (with dictionary name/unit), portions, and scalar-field provenance. Dates are
     * ISO-8601 strings; the shape carries no source-native identifier (SC-013).
     *
     * @param id - The internal food id.
     * @returns The assembled record, or `null` when the food does not exist.
     * @sideEffect Reads `food`, `food_sources`, `food_nutrients`, `nutrient`, `food_portions`,
     *   `food_field_provenance`.
     */
    public async readGoldenRecord(id: string): Promise<GoldenFoodRecord | null> {
        const foodRow = await this.getById(id);

        if (!foodRow) {
            return null;
        }

        const [sources, nutrients, portions, fieldProvenance, popularity] = await Promise.all([
            this.db
                .select({
                    id: foodSources.id,
                    source: foodSources.source,
                    externalKey: foodSources.externalKey,
                    itemVersion: foodSources.itemVersion,
                    fetchState: foodSources.fetchState,
                    fetchedAt: foodSources.fetchedAt,
                })
                .from(foodSources)
                .where(eq(foodSources.foodId, id)),
            this.db
                .select({
                    nutrientId: foodNutrients.nutrientId,
                    name: nutrient.name,
                    unit: nutrient.unit,
                    externalCode: nutrient.externalCode,
                    amount: foodNutrients.amount,
                    basis: foodNutrients.basis,
                    sourceId: foodNutrients.sourceId,
                })
                .from(foodNutrients)
                .innerJoin(nutrient, eq(foodNutrients.nutrientId, nutrient.id))
                .where(eq(foodNutrients.foodId, id)),
            this.db
                .select({
                    id: foodPortions.id,
                    label: foodPortions.label,
                    gramWeight: foodPortions.gramWeight,
                    sourceId: foodPortions.sourceId,
                })
                .from(foodPortions)
                .where(eq(foodPortions.foodId, id)),
            this.db
                .select({ field: foodFieldProvenance.field, sourceId: foodFieldProvenance.sourceId })
                .from(foodFieldProvenance)
                .where(eq(foodFieldProvenance.foodId, id)),
            // U5: the consumption prior (sibling table, KTD-G) — carried on the golden record so the one
            // consumer that CAPTURES it (recipe-service's ingredient cache) reads it from the same
            // aggregate it already reads, with no extra endpoint.
            this.db
                .select({ priorFraction: foodPopularity.priorFraction })
                .from(foodPopularity)
                .where(eq(foodPopularity.foodId, id)),
        ]);

        return {
            id: foodRow.id,
            name: foodRow.name,
            description: foodRow.description,
            kind: foodRow.kind,
            brandOwner: foodRow.brandOwner,
            brandName: foodRow.brandName,
            barcode: foodRow.barcode,
            status: foodRow.status,
            tombstonedAt: foodRow.tombstonedAt ? foodRow.tombstonedAt.toISOString() : null,
            createdAt: foodRow.createdAt.toISOString(),
            updatedAt: foodRow.updatedAt.toISOString(),
            sources: sources.map((source) => ({
                id: source.id,
                source: source.source,
                externalKey: source.externalKey,
                itemVersion: source.itemVersion,
                fetchState: source.fetchState,
                fetchedAt: source.fetchedAt.toISOString(),
            })),
            nutrients,
            portions,
            fieldProvenance,
            priorFraction: popularity[0]?.priorFraction === undefined ? null : Number(popularity[0].priorFraction),
            userId: foodRow.userId,
            visibility: narrowVisibility(foodRow.visibility),
        };
    }

    /**
     * Read the nutrition-relevant rows for MANY foods in **three** statements (KTD-3, plan U8): statuses
     * from `food`, nutrient values through `food_nutrient_view` (migration 0006), portions from
     * `food_portions` — each a single `food_id = ANY($1)`.
     *
     * This exists because the batch endpoint used to call {@link FoodDao.readGoldenRecord} once per id, and
     * that runs 1 + 4 statements EACH: a 100-id request — one per recipe-list render — cost ~500 round
     * trips. No index is added; `food_nutrients_food_id_idx` and `food_portions_food_id_idx` already serve
     * the predicate.
     *
     * ⛔ An **access-path change only**. Nothing here decides which row is a calorie, a protein or a fat —
     * `basis` and the dictionary name/unit are carried through verbatim for `selectPer100g` to judge
     * (`nutrition/nutrientSelection.ts`), which is the ONE place that rule lives. Amounts stay STRINGS.
     *
     * An id that names no `food` row is simply absent from the result; reporting it is the caller's job,
     * because "unknown" versus "known but empty" is a wire-contract distinction, not a storage one.
     *
     * @param ids - The internal food ids (already canonicalized by the controller).
     * @returns One record per id that exists, in no guaranteed order.
     * @sideEffect Reads `food`, `food_nutrient_view` (`food_nutrients` + `nutrient`), `food_portions`.
     */
    /**
     * The stored nutrient rows for a set of foods — the narrow read behind search's opt-in nutrition
     * enrichment (plan U4b). One batched view scan; the per-100g SELECTION stays in
     * `nutrition/nutrientSelection.ts`, never here.
     *
     * @param ids - The internal food ids.
     * @returns One row per stored nutrient value, `amount` still the driver's string.
     * @sideEffect Reads `food_nutrient_view`.
     */
    public async nutrientRowsFor(ids: readonly string[]): Promise<(StoredNutrientAmount & { foodId: string })[]> {
        return this.db
            .select({
                foodId: foodNutrientView.foodId,
                nutrient: foodNutrientView.nutrient,
                unit: foodNutrientView.unit,
                basis: foodNutrientView.basis,
                amount: foodNutrientView.amount,
            })
            .from(foodNutrientView)
            .where(sql`${foodNutrientView.foodId} = ANY(${sql.param([...ids])})`);
    }

    /**
     * The AUTHORED variant of {@link readNutritionBatch} (plan U18's cache split): the same three-read
     * shape, scoped to `user_id = requester` — the caller's own authored foods and NOBODY else's, which
     * is what makes the authenticated `authored-nutrition` route safe to serve uncached per caller while
     * the shared route stays caller-independent for the edge (ADR-0020).
     *
     * @sideEffect Three reads.
     */
    public async readAuthoredNutritionBatch(ids: readonly string[], requesterId: string): Promise<NutritionRecord[]> {
        const statuses = await this.db
            .select({ id: food.id, status: food.status })
            .from(food)
            .where(sql`${food.id} = ANY(${sql.param(ids)}) AND ${food.userId} = ${requesterId}`);
        const ownedIds = statuses.map((row) => row.id);

        if (ownedIds.length === 0) {
            return [];
        }

        const [nutrients, portions] = await Promise.all([
            this.db
                .select({
                    foodId: foodNutrientView.foodId,
                    nutrient: foodNutrientView.nutrient,
                    unit: foodNutrientView.unit,
                    basis: foodNutrientView.basis,
                    amount: foodNutrientView.amount,
                })
                .from(foodNutrientView)
                .where(sql`${foodNutrientView.foodId} = ANY(${sql.param(ownedIds)})`),
            this.db
                .select({
                    foodId: foodPortions.foodId,
                    label: foodPortions.label,
                    gramWeight: foodPortions.gramWeight,
                })
                .from(foodPortions)
                .where(sql`${foodPortions.foodId} = ANY(${sql.param(ownedIds)})`)
                .orderBy(foodPortions.id),
        ]);
        const nutrientsByFood = new Map<string, StoredNutrientAmount[]>();

        for (const row of nutrients) {
            const bucket = nutrientsByFood.get(row.foodId);
            const value = { nutrient: row.nutrient, unit: row.unit, basis: row.basis, amount: row.amount };

            if (bucket === undefined) {
                nutrientsByFood.set(row.foodId, [value]);
            } else {
                bucket.push(value);
            }
        }

        const portionsByFood = new Map<string, StoredPortionWeight[]>();

        for (const row of portions) {
            const bucket = portionsByFood.get(row.foodId);
            const value = { label: row.label, gramWeight: row.gramWeight };

            if (bucket === undefined) {
                portionsByFood.set(row.foodId, [value]);
            } else {
                bucket.push(value);
            }
        }

        return statuses.map((row) => ({
            id: row.id,
            status: row.status,
            nutrients: nutrientsByFood.get(row.id) ?? [],
            portions: portionsByFood.get(row.id) ?? [],
        }));
    }

    public async readNutritionBatch(ids: readonly string[]): Promise<NutritionRecord[]> {
        const [statuses, nutrients, portions] = await Promise.all([
            this.db
                .select({ id: food.id, status: food.status })
                .from(food)
                // ⛔ CATALOG + PROMOTED rows (0013 U10, 0015 U12). This feeds the EDGE-CACHED nutrition
                // endpoint, whose response must not vary by caller (ADR-0020) — a PRIVATE authored food
                // cannot appear here for ANYONE (its id lands in `unknownIds`; U18's cache split serves
                // the author), while a PROMOTED one is world-readable with caller-invariant nutrition, so
                // it enters the shared population the moment phase 1 commits.
                .where(
                    sql`${food.id} = ANY(${sql.param(ids)})
                        AND (${food.userId} IS NULL OR ${food.visibility} = 'promoted')`,
                ),
            this.db
                .select({
                    foodId: foodNutrientView.foodId,
                    nutrient: foodNutrientView.nutrient,
                    unit: foodNutrientView.unit,
                    basis: foodNutrientView.basis,
                    amount: foodNutrientView.amount,
                })
                .from(foodNutrientView)
                .where(sql`${foodNutrientView.foodId} = ANY(${sql.param(ids)})`),
            this.db
                .select({
                    foodId: foodPortions.foodId,
                    label: foodPortions.label,
                    gramWeight: foodPortions.gramWeight,
                })
                .from(foodPortions)
                .where(sql`${foodPortions.foodId} = ANY(${sql.param(ids)})`)
                // Portion order is NOT cosmetic: `normalizePortions` de-duplicates by unit FIRST-WINS, so
                // it decides what a `cup` of this food weighs. `food_portions.id` is a ULID, so ordering by
                // it is insertion order — what the per-food read returned before batching, now guaranteed
                // rather than inherited from whichever plan the batched scan happens to get.
                .orderBy(foodPortions.id),
        ]);

        const nutrientsByFood = new Map<string, StoredNutrientAmount[]>();

        for (const row of nutrients) {
            const bucket = nutrientsByFood.get(row.foodId);
            const value = { nutrient: row.nutrient, unit: row.unit, basis: row.basis, amount: row.amount };

            if (bucket === undefined) {
                nutrientsByFood.set(row.foodId, [value]);
            } else {
                bucket.push(value);
            }
        }

        const portionsByFood = new Map<string, StoredPortionWeight[]>();

        for (const row of portions) {
            const bucket = portionsByFood.get(row.foodId);
            const value = { label: row.label, gramWeight: row.gramWeight };

            if (bucket === undefined) {
                portionsByFood.set(row.foodId, [value]);
            } else {
                bucket.push(value);
            }
        }

        return statuses.map((row) => ({
            id: row.id,
            status: row.status,
            nutrients: nutrientsByFood.get(row.id) ?? [],
            portions: portionsByFood.get(row.id) ?? [],
        }));
    }
}
