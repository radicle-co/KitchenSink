/**
 * `FoodDao` (T-105, MOD-016) — per-aggregate DAO for the golden `food` record. Owns add-by-name
 * dedup (`createByName`), the guarded legal status-transition set (`setStatus`), scalar golden-field
 * writes (`upsertGoldenScalars`), and the golden-record aggregate read (`readGoldenRecord`). A food's
 * identity is ALWAYS the internal ULID `id`, NEVER a source-native key (R1/FR-IDN-1); no source term
 * leaks into the read shape (FR-ADP-1/SC-013).
 *
 * @implements FR-002 FR-005 FR-013 FR-025 FR-028 FR-028a FR-IDN-1
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';

import { settingFromEnv } from '../../config/env.schema.js';
import type { FoodWriter } from '../../database/unitOfWork.js';
import {
    food,
    foodFieldProvenance,
    foodNutrientView,
    foodNutrition,
    foodNutritionCitation,
    foodNutritionValue,
    foodPopularity,
    foodPortions,
    foodSources,
    foodStatusEnum,
    nutrient,
    type FoodRow,
} from '../../db/schema/index.js';
import { DATASET_SOURCE } from '../seed/citationDatasets.js';
import { IllegalStatusTransitionError } from './dao.errors.js';
import { FoodItemDao } from './foodItem.dao.js';
import { ADVISORY_LOCK_CLASSES } from '@kitchensink/db-schema-guard';

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
    /** The definition's INFOODS tag when it has one, else `null` (KTD-23). */
    infoodsTag: string | null;
    /** Arbitrary-precision amount as a string (no float drift, SC-008). */
    amount: string;
    /** Amount basis (`per_100g` by default). */
    basis: string;
    /**
     * The register source the value's citation names (`DATASET_SOURCE` of its dataset), or NULL for an
     * author-written one (0013, plan U10; KTD-19).
     */
    source: string | null;
}

/** A household-measure portion in the golden read shape. */
export interface GoldenPortion {
    /** Internal portion row id. */
    id: string;
    /** Human label (e.g. `1 cup`). */
    label: string;
    /** Gram weight as a string (numeric, strictly positive). */
    gramWeight: string;
    /** Crosswalk row id that supplied this portion, or NULL when a citation or the author stands behind it. */
    sourceId: string | null;
    /**
     * The register source behind the portion — its crosswalk row's, or `DATASET_SOURCE` of its citation's dataset — or
     * NULL for an author-written one (ADR-0029). Decided here, once, so a cited portion never reads as authored.
     */
    source: string | null;
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
    /** Arbitrary-precision amount as a string; NULL exactly when the row is a trace mark (R53). */
    readonly amount: string | null;
    /** The dictionary entry's INFOODS tag, or `null` where INFOODS defines none (KTD-23). */
    readonly infoodsTag: string | null;
    /** Whether the source printed a trace or below-limit mark in place of a number. */
    readonly trace: boolean;
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

/**
 * What a READER may be told about a food, and what decides whether they may be told it — one `food` row's
 * identity, name, lifecycle and the two 0013 authorship columns. Returned by {@link FoodDao.readRefFacts}.
 */
export interface FoodRefFacts {
    /** The internal food id. */
    readonly id: string;
    /** The food's current name (nullable in the column). */
    readonly name: string | null;
    /** The stored lifecycle, `DELETING` included — deciding what reaches the wire is the reader's job. */
    readonly status: FoodStatus;
    /** The author's app-user ULID, or `null` for a catalog row. */
    readonly userId: string | null;
    /** The 0013 visibility state, narrowed (the CHECK guarantees coherence with `userId`). */
    readonly visibility: 'public' | 'private' | 'promoted';
    /** Whether the root is retired: it has been forwarded, or the seed removed it (ADR-0050 §4). */
    readonly retired: boolean;
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
    /**
     * The prior status(es) the caller actually OBSERVED — turning a check-then-act into a compare-and-set.
     *
     * ⛔ Supply this whenever the decision to write was made from a status READ in an earlier statement.
     * `LEGAL_PRIORS` is the set of transitions that are legal in general, which is deliberately wider than
     * "the row is still what I saw": `RESOLVED` is reachable from `UNRESOLVED`, so a food that moved
     * `PENDING → UNRESOLVED` between a caller's read and its write was completed anyway — published as
     * resolved without ever being disambiguated.
     *
     * ⚠️ It can only NARROW (it is intersected with `LEGAL_PRIORS`), so it is a tightening of FR-028a and
     * never a way around it. Optional because most callers transition from whatever the row holds and have
     * no observed prior to state; a caller that DID read first and omits it keeps the old wider guard.
     */
    from?: readonly FoodStatus[];
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
    // The author's own voluntary delete (0016; owner ruling 5). Only a live golden record can be withdrawn,
    // and it has NO exit: `WITHDRAWN` appears in no other entry's prior set. Un-withdrawal is not ruled, so
    // it is terminal for now — and adding it back later is additive, whereas admitting a transition nobody
    // has designed is not.
    WITHDRAWN: ['RESOLVED'],
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
        private readonly db: FoodWriter,
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
     * The reader facts for many foods in ONE statement (`id = ANY($1)` on the primary key) — what
     * `POST /api/v1/foods/refs/resolve` answers from, and what the authorship gate on `GET /{id}/candidates`
     * decides over.
     *
     * Deciding what a caller may be told is NOT done here: every row comes back, private and `DELETING` ones
     * included, and `domain/foodRefResolution.ts` applies the authorship policy. An id with no row is simply
     * missing from the result.
     *
     * @param ids - The internal food ids (any order; duplicates harmless).
     * @returns One entry per id that names a row, in no guaranteed order.
     * @sideEffect Reads `food`.
     */
    public async readRefFacts(ids: readonly string[]): Promise<FoodRefFacts[]> {
        if (ids.length === 0) {
            return [];
        }

        const rows = await this.db
            .select({
                id: food.id,
                name: food.name,
                status: food.status,
                userId: food.userId,
                visibility: food.visibility,
                retiredAt: food.retiredAt,
            })
            .from(food)
            .where(sql`${food.id} = ANY(${sql.param([...ids])})`);

        return rows.map(({ retiredAt, ...row }) => ({
            ...row,
            visibility: narrowVisibility(row.visibility),
            retired: retiredAt !== null,
        }));
    }

    /**
     * Add-by-name with normalized-name dedup (FR-005/FR-013/FR-028a). Under a short per-name advisory lock
     * (DSN-15): a live catalog row of the name collapses the add to its `id`; a live terminal-state
     * (`NOT_FOUND`/`FAILED`) row PAST its configured TTL (`FOOD_NOT_FOUND_TTL_DAYS`, default 30 days) is
     * reactivated to `PENDING`; otherwise a new `PENDING` root is inserted on a new live item (curated catalog
     * plan KTD-6). The live catalog name index is the durable backstop.
     *
     * It reads before it writes rather than upserting, because an upsert's `DO UPDATE` on a SEEDED name is a
     * service write to a seed-owned row, which the ownership trigger refuses (KTD-12).
     *
     * @param input - The normalized dedup key + optional display name.
     * @returns `{ id, created, reactivated }`.
     * @sideEffect Inserts `food_item` and `food`, or updates `food`; takes a transaction-scoped advisory lock.
     */
    public async createByName(input: CreateByNameInput): Promise<CreateByNameResult> {
        const { normalizedName } = input;
        const displayName = input.displayName ?? null;

        return this.db.transaction(async (tx) => {
            await tx.execute(
                sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.foodNameDedup}, hashtext(${normalizedName}))`,
            );

            // The live catalog row of this name, if any (0013: CATALOG rows only — never another user's private
            // authored food). A retired root has freed its name (0018).
            const existing = await tx.execute<{ id: string; reactivatable: boolean }>(sql`
                SELECT f.id,
                       (f.status IN ('NOT_FOUND', 'FAILED') AND f.tombstoned_at < now() - ${this.terminalTtl}
                            AND NOT i.seed_owned) AS reactivatable
                  FROM food f JOIN food_item i ON i.id = f.item_id
                 WHERE f.normalized_name = ${normalizedName} AND f.user_id IS NULL AND f.retired_at IS NULL
            `);
            const found = existing.rows[0];

            if (found !== undefined) {
                // ⛔ A seeded root is never written here: the ownership trigger refuses the service any write to a
                // seed-owned row (KTD-12), and a seeded root is never in a terminal state anyway. So add-by-name of
                // a seeded name only reads, and only a stale live tombstone is reactivated.
                if (found.reactivatable) {
                    await tx.execute(sql`
                        UPDATE food SET status = 'PENDING', tombstoned_at = NULL, updated_at = now()
                         WHERE id = ${found.id}
                    `);
                }

                return { id: found.id, created: false, reactivated: found.reactivatable };
            }

            // A new live root owns a new live item (KTD-6), both in this transaction. Under the per-name lock no
            // other add can race this one; the catalog name index is the backstop.
            const id = await new FoodItemDao(tx).insertLiveRoot({
                name: displayName,
                normalizedName,
                status: 'PENDING',
            });

            return { id, created: true, reactivated: false };
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
        // ⛔ INTERSECTED, never substituted: `from` may only NARROW the legal prior set, so a caller cannot
        // use it to reach a target FR-028a forbids from the status it names. Absent `from`, the guard is the
        // full matrix exactly as before.
        const legal = LEGAL_PRIORS[status];
        const priors = input.from === undefined ? legal : legal.filter((prior) => input.from?.includes(prior));

        if (priors.length === 0) {
            // No overlap at all: the caller observed a status this target is unreachable from, so the write
            // can never match. Refuse here rather than issuing an `IN ()` that Postgres would reject.
            throw new IllegalStatusTransitionError(id, status);
        }

        const isTerminal = status === 'NOT_FOUND' || status === 'FAILED';
        const tombExpr = isTerminal ? sql`COALESCE(${input.tombstonedAt ?? null}::timestamptz, now())` : sql`NULL`;
        // ⛔ ITS OWN COLUMN, not `tombstoned_at` (0017). That column anchors `createByName`'s NOT_FOUND TTL
        // reactivation, so stamping a withdrawal into it would make an author's delete look like an expired
        // lookup and let the TTL path reactivate it. Stamped on the way in, cleared on any other target so a
        // future un-withdrawal cannot leave a date behind claiming the food is still gone.
        const withdrawnExpr = status === 'WITHDRAWN' ? sql`now()` : sql`NULL`;
        const priorList = sql.join(
            priors.map((prior) => sql`${prior}::food_status`),
            sql`, `,
        );

        const result = await this.db.execute(sql`
            UPDATE food
            SET status = ${status}::food_status,
                tombstoned_at = ${tombExpr},
                withdrawn_at = ${withdrawnExpr},
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
     * @sideEffect Reads `food`, `food_sources`, the nutrition aggregate, `nutrient`, `food_portions`,
     *   `food_field_provenance` and `food_popularity`, the per-item ones through the food's item.
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
                .innerJoin(food, eq(food.itemId, foodSources.itemId))
                .where(eq(food.id, id)),
            this.db
                .select({
                    nutrientId: foodNutritionValue.nutrientId,
                    name: nutrient.name,
                    unit: nutrient.unit,
                    infoodsTag: nutrient.infoodsTag,
                    amount: foodNutritionValue.amount,
                    basis: foodNutritionValue.basis,
                    dataset: foodNutritionCitation.dataset,
                })
                .from(foodNutritionValue)
                .innerJoin(foodNutrition, eq(foodNutrition.id, foodNutritionValue.nutritionId))
                .innerJoin(nutrient, eq(foodNutritionValue.nutrientId, nutrient.id))
                .leftJoin(
                    foodNutritionCitation,
                    and(
                        eq(foodNutritionCitation.nutritionId, foodNutritionValue.nutritionId),
                        eq(foodNutritionCitation.id, foodNutritionValue.citationId),
                    ),
                )
                .where(eq(foodNutrition.foodId, id)),
            this.db
                .select({
                    id: foodPortions.id,
                    label: foodPortions.label,
                    gramWeight: foodPortions.gramWeight,
                    sourceId: foodPortions.sourceId,
                    crosswalkSource: foodSources.source,
                    dataset: foodNutritionCitation.dataset,
                })
                .from(foodPortions)
                .innerJoin(food, eq(food.itemId, foodPortions.itemId))
                .leftJoin(foodSources, eq(foodSources.id, foodPortions.sourceId))
                .leftJoin(foodNutritionCitation, eq(foodNutritionCitation.id, foodPortions.citationId))
                .where(eq(food.id, id)),
            this.db
                .select({ field: foodFieldProvenance.field, sourceId: foodFieldProvenance.sourceId })
                .from(foodFieldProvenance)
                .innerJoin(food, eq(food.itemId, foodFieldProvenance.itemId))
                .where(eq(food.id, id)),
            // U5: the consumption prior (sibling table, KTD-G) — carried on the golden record so the one
            // consumer that CAPTURES it (recipe-service's ingredient cache) reads it from the same
            // aggregate it already reads, with no extra endpoint.
            this.db
                .select({ priorFraction: foodPopularity.priorFraction })
                .from(foodPopularity)
                .innerJoin(food, eq(food.itemId, foodPopularity.itemId))
                .where(eq(food.id, id)),
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
            // A trace mark is a mark, never a number (R53): the golden read carries numbers only.
            nutrients: nutrients.flatMap((value) =>
                value.amount === null
                    ? []
                    : [
                          {
                              nutrientId: value.nutrientId,
                              name: value.name,
                              unit: value.unit,
                              infoodsTag: value.infoodsTag,
                              amount: value.amount,
                              basis: value.basis,
                              source: value.dataset === null ? null : DATASET_SOURCE[value.dataset],
                          },
                      ],
            ),
            // A portion names its crosswalk row, cites a dataset, or names neither because its author wrote it (KTD-19).
            portions: portions.map(({ crosswalkSource, dataset, ...portion }) => ({
                ...portion,
                source: crosswalkSource ?? (dataset === null ? null : DATASET_SOURCE[dataset]),
            })),
            fieldProvenance,
            priorFraction: popularity[0]?.priorFraction === undefined ? null : Number(popularity[0].priorFraction),
            userId: foodRow.userId,
            visibility: narrowVisibility(foodRow.visibility),
        };
    }

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
        return this.rootNutrientRows(ids);
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
            this.rootNutrientRows(ownedIds),
            this.rootPortionRows(ownedIds),
        ]);
        const nutrientsByFood = new Map<string, StoredNutrientAmount[]>();

        for (const row of nutrients) {
            const bucket = nutrientsByFood.get(row.foodId);
            const value: StoredNutrientAmount = {
                nutrient: row.nutrient,
                unit: row.unit,
                basis: row.basis,
                amount: row.amount,
                infoodsTag: row.infoodsTag,
                trace: row.trace,
            };

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

    /**
     * Read the nutrition-relevant rows for MANY foods in **three** statements (KTD-3, plan U8): statuses
     * from `food`, nutrient values through `food_nutrient_view` (0018), portions from `food_portions` through
     * each root's item — each a single `food_id = ANY($1)`.
     *
     * This exists because {@link FoodDao.readGoldenRecord} runs 1 + 4 statements EACH: calling it once per id,
     * a 100-id batch request — one per recipe-list render — costs ~500 round trips. The header's root-arm
     * unique index and `food_portions_item_id_idx` serve the predicates.
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
     * @sideEffect Reads `food`, `food_nutrient_view` (the nutrition aggregate + `nutrient`), `food_portions`.
     */
    public async readNutritionBatch(ids: readonly string[]): Promise<NutritionRecord[]> {
        const [statuses, nutrients, portions] = await Promise.all([
            this.db
                .select({ id: food.id, status: food.status })
                .from(food)
                // ⛔ CATALOG rows ONLY (0013 U10; ADR-0036). This feeds the EDGE-CACHED nutrition
                // endpoint, whose response must not vary by caller (ADR-0020) — an AUTHORED food is
                // author-only and cannot appear here for ANYONE (its id lands in `unknownIds`; U18's
                // cache split serves the author its own rows on the per-caller path).
                .where(sql`${food.id} = ANY(${sql.param(ids)}) AND ${food.userId} IS NULL`),
            this.rootNutrientRows(ids),
            this.rootPortionRows(ids),
        ]);

        const nutrientsByFood = new Map<string, StoredNutrientAmount[]>();

        for (const row of nutrients) {
            const bucket = nutrientsByFood.get(row.foodId);
            const value: StoredNutrientAmount = {
                nutrient: row.nutrient,
                unit: row.unit,
                basis: row.basis,
                amount: row.amount,
                infoodsTag: row.infoodsTag,
                trace: row.trace,
            };

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

    /**
     * The stored values of the given roots, through the view, trace marks included: carbohydrate counts a trace as 0
     * (KTD-23), so dropping the row here would turn a known 0 into an unknown. A trace carries a NULL amount, and
     * `nutrientSelection.ts` is the one reader that decides what each macro makes of it (R53).
     *
     * @param ids - The roots.
     * @returns One row per stored value, `amount` still the driver's string, or NULL for a trace.
     * @sideEffect Reads `food_nutrient_view`.
     */
    private async rootNutrientRows(ids: readonly string[]): Promise<(StoredNutrientAmount & { foodId: string })[]> {
        const rows = await this.db
            .select({
                foodId: foodNutrientView.foodId,
                nutrient: foodNutrientView.nutrient,
                infoodsTag: foodNutrientView.infoodsTag,
                unit: foodNutrientView.unit,
                basis: foodNutrientView.basis,
                amount: foodNutrientView.amount,
                trace: foodNutrientView.trace,
            })
            .from(foodNutrientView)
            .where(sql`${foodNutrientView.foodId} = ANY(${sql.param([...ids])})`);

        return rows.flatMap(({ foodId, ...rest }) => (foodId === null ? [] : [{ ...rest, foodId }]));
    }

    /**
     * The given roots' portions, through each root's item.
     *
     * Portion order is NOT cosmetic: `normalizePortions` de-duplicates by unit FIRST-WINS, so it decides what a `cup`
     * of this food weighs. `food_portions.id` is a ULID, so ordering by it is insertion order.
     *
     * @param ids - The roots.
     * @returns One row per portion, in insertion order.
     * @sideEffect Reads `food_portions` joined to `food`.
     */
    private async rootPortionRows(ids: readonly string[]): Promise<(StoredPortionWeight & { foodId: string })[]> {
        return this.db
            .select({ foodId: food.id, label: foodPortions.label, gramWeight: foodPortions.gramWeight })
            .from(foodPortions)
            .innerJoin(food, eq(food.itemId, foodPortions.itemId))
            .where(sql`${food.id} = ANY(${sql.param([...ids])})`)
            .orderBy(foodPortions.id);
    }
}
