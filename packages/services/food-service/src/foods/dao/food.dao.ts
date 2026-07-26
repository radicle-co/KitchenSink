/**
 * `FoodDao` (T-105, MOD-016) — per-aggregate DAO for the golden `food` record. Owns add-by-name
 * dedup (`createByName`), the guarded legal status-transition set (`setStatus`), scalar golden-field
 * writes (`upsertGoldenScalars`), and the golden-record aggregate read (`readGoldenRecord`). A food's
 * identity is ALWAYS the internal ULID `id`, NEVER a source-native key (R1/FR-IDN-1); no source term
 * leaks into the read shape (FR-ADP-1/SC-013).
 *
 * @implements FR-002 FR-005 FR-013 FR-025 FR-028 FR-028a FR-IDN-1
 */
import { eq, sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import {
    food,
    foodFieldProvenance,
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
    /** Crosswalk row id that supplied this value (per-value provenance). */
    sourceId: string;
}

/** A household-measure portion in the golden read shape. */
export interface GoldenPortion {
    /** Internal portion row id. */
    id: string;
    /** Human label (e.g. `1 cup`). */
    label: string;
    /** Gram weight as a string (numeric, strictly positive). */
    gramWeight: string;
    /** Crosswalk row id that supplied this portion. */
    sourceId: string;
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
    /** `true` when a terminal-state row past its 30-day TTL was reset to `PENDING` (FR-028a). */
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
}

/** Two-int advisory-lock classid for per-name dedup (DSN-15) — distinct from the drainer/limiter classes. */
const LOCK_CLASS_DEDUP = 2;

/** The 30-day terminal-row / NOT_FOUND TTL window (FR-025/FR-028a). */
const TERMINAL_TTL = sql`interval '30 days'`;

/**
 * Legal status-transition set (FR-028a) expressed as the set of prior statuses from which each
 * target is reachable. `setStatus` runs a conditional UPDATE gated on this prior set, so an illegal
 * transition matches no row (`rowCount=0`) and is rejected without mutating the record.
 */
const LEGAL_PRIORS: Record<FoodStatus, readonly FoodStatus[]> = {
    PENDING: ['FAILED', 'NOT_FOUND'],
    RESOLVED: ['PENDING', 'UNRESOLVED'],
    UNRESOLVED: ['PENDING'],
    NOT_FOUND: ['PENDING'],
    FAILED: ['PENDING'],
};

export class FoodDao {
    public constructor(private readonly db: FoodDrizzle) {}

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
     * (`NOT_FOUND`/`FAILED`) row PAST its 30-day TTL is reactivated to `PENDING` (never a `23505`). A
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
                    SELECT id, status, tombstoned_at FROM food WHERE normalized_name = ${normalizedName}
                ),
                upserted AS (
                    INSERT INTO food (id, name, normalized_name, status)
                    VALUES (${newId}, ${displayName}, ${normalizedName}, 'PENDING')
                    ON CONFLICT (normalized_name) DO UPDATE SET
                        status = CASE
                            WHEN food.status IN ('NOT_FOUND', 'FAILED')
                                 AND food.tombstoned_at < now() - ${TERMINAL_TTL}
                            THEN 'PENDING'::food_status ELSE food.status END,
                        tombstoned_at = CASE
                            WHEN food.status IN ('NOT_FOUND', 'FAILED')
                                 AND food.tombstoned_at < now() - ${TERMINAL_TTL}
                            THEN NULL ELSE food.tombstoned_at END,
                        updated_at = CASE
                            WHEN food.status IN ('NOT_FOUND', 'FAILED')
                                 AND food.tombstoned_at < now() - ${TERMINAL_TTL}
                            THEN now() ELSE food.updated_at END
                    RETURNING id, (xmax = 0) AS inserted
                )
                SELECT
                    u.id,
                    u.inserted,
                    COALESCE(
                        e.status IN ('NOT_FOUND', 'FAILED') AND e.tombstoned_at < now() - ${TERMINAL_TTL},
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

        const [sources, nutrients, portions, fieldProvenance] = await Promise.all([
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
        };
    }
}
