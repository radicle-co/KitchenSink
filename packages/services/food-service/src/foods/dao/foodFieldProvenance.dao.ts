/**
 * `FoodFieldProvenanceDao` (T-108, MOD-019) — per-scalar-field provenance, one row per
 * `(food_id, field)`, no EAV value column. `record` upserts the winning source for a scalar field;
 * `fieldsFromSource` answers "which fields came from source X" in ONE `UNION` query across the
 * scalar-field, nutrient, and portion provenance — no raw payload is read because none is stored
 * (FR-029/R7/SC-013).
 *
 * @implements FR-028 FR-029 R7
 */
import { eq, sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { foodFieldProvenance, type FoodFieldProvenanceRow } from '../../db/schema/index.js';
import type { FoodSource } from './foodSources.dao.js';

/** The controlled scalar-field enum domain (no EAV). */
export type FoodField = FoodFieldProvenanceRow['field'];

/** Input for {@link FoodFieldProvenanceDao.record}. */
export interface RecordFieldProvenanceInput {
    /** Internal food id. */
    foodId: string;
    /** The controlled scalar field. */
    field: FoodField;
    /** Crosswalk row id that supplied the field's winning value (must belong to the SAME food). */
    sourceId: string;
}

/** A single tagged provenance entry from {@link FoodFieldProvenanceDao.fieldsFromSource}. */
export interface SourceField {
    /** Tagged entry: `field:<name>` | `nutrient:<nutrientId>` | `portion:<portionId>`. */
    field: string;
}

export class FoodFieldProvenanceDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Upsert the winning source for a scalar field (one row per `(food_id, field)`). Idempotent: a
     * re-merge overwrites `source_id` (MOD-019). The composite same-food FK is enforced by the DB.
     *
     * @param input - The provenance attributes.
     * @sideEffect Inserts or updates `food_field_provenance`.
     */
    public async record(input: RecordFieldProvenanceInput): Promise<void> {
        await this.db
            .insert(foodFieldProvenance)
            .values({ foodId: input.foodId, field: input.field, sourceId: input.sourceId })
            .onConflictDoUpdate({
                target: [foodFieldProvenance.foodId, foodFieldProvenance.field],
                set: { sourceId: input.sourceId },
            });
    }

    /**
     * List the scalar-field provenance rows for a food.
     *
     * @param foodId - Internal food id.
     * @returns The provenance rows.
     * @sideEffect Reads `food_field_provenance`.
     */
    public async listByFood(foodId: string): Promise<FoodFieldProvenanceRow[]> {
        return this.db.select().from(foodFieldProvenance).where(eq(foodFieldProvenance.foodId, foodId));
    }

    /**
     * Answer "which fields came from source X" for a food in ONE `UNION ALL` query (FR-029/R7),
     * joining each provenance grain (scalar field, nutrient value, portion) to `food_sources` and
     * filtering by `(food_id, source)`. Returns tagged entries; no raw payload is read.
     *
     * @param foodId - Internal food id.
     * @param source - The source identifier.
     * @returns The tagged provenance set contributed by that source.
     * @sideEffect Reads `food_field_provenance`, `food_nutrients`, `food_portions`, `food_sources`.
     */
    public async fieldsFromSource(foodId: string, source: FoodSource): Promise<SourceField[]> {
        const result = await this.db.execute<{ field: string }>(sql`
            SELECT 'field:' || ffp.field AS field
              FROM food_field_provenance ffp
              JOIN food_sources fs ON fs.id = ffp.source_id
             WHERE ffp.food_id = ${foodId} AND fs.source = ${source}::food_source
            UNION ALL
            SELECT 'nutrient:' || fn.nutrient_id AS field
              FROM food_nutrients fn
              JOIN food_sources fs ON fs.id = fn.source_id
             WHERE fn.food_id = ${foodId} AND fs.source = ${source}::food_source
            UNION ALL
            SELECT 'portion:' || fp.id AS field
              FROM food_portions fp
              JOIN food_sources fs ON fs.id = fp.source_id
             WHERE fp.food_id = ${foodId} AND fs.source = ${source}::food_source
        `);

        return result.rows.map((row) => ({ field: row.field }));
    }
}
