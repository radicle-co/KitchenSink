/**
 * `FoodFieldProvenanceDao` (T-108, MOD-019) — per-scalar-field provenance, one row per
 * `(food_id, field)`, no EAV value column. `record` upserts the winning source for a scalar field;
 * `fieldsFromSource` answers "which fields came from source X" in ONE `UNION` query across the
 * scalar-field, nutrient, and portion provenance — no raw payload is read because none is stored
 * (FR-029/R7/SC-013).
 *
 * @implements FR-028 FR-029 R7
 */
import { eq, getTableColumns, sql } from 'drizzle-orm';

import type { FoodWriter } from '../../database/unitOfWork.js';
import { food, foodFieldProvenance } from '../../db/schema/index.js';
import { itemIdOfFood } from './foodItem.dao.js';
import type { FoodSource } from './foodSources.dao.js';

/** The controlled scalar-field enum domain (no EAV). */
export type FoodField = (typeof foodFieldProvenance.$inferSelect)['field'];

/** A scalar-field provenance row, read through its food. */
export type FoodFieldProvenanceRow = typeof foodFieldProvenance.$inferSelect;

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
    public constructor(private readonly db: FoodWriter) {}

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
            .values({ itemId: itemIdOfFood(input.foodId), field: input.field, sourceId: input.sourceId })
            .onConflictDoUpdate({
                target: [foodFieldProvenance.itemId, foodFieldProvenance.field],
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
        return this.db
            .select(getTableColumns(foodFieldProvenance))
            .from(foodFieldProvenance)
            .innerJoin(food, eq(food.itemId, foodFieldProvenance.itemId))
            .where(eq(food.id, foodId));
    }

    /**
     * Answer "which fields came from source X" for a food in ONE `UNION ALL` query (FR-029/R7),
     * joining each provenance grain (scalar field, nutrient value, portion) to `food_sources` and
     * filtering by `(food_id, source)`. Returns tagged entries; no raw payload is read.
     *
     * @param foodId - Internal food id.
     * @param source - The source identifier.
     * @returns The tagged provenance set contributed by that source.
     * @sideEffect Reads `food_field_provenance`, the nutrition aggregate, `food_portions`, `food_sources`.
     */
    public async fieldsFromSource(foodId: string, source: FoodSource): Promise<SourceField[]> {
        const result = await this.db.execute<{ field: string }>(sql`
            SELECT 'field:' || ffp.field AS field
              FROM food f
              JOIN food_field_provenance ffp ON ffp.item_id = f.item_id
              JOIN food_sources fs ON fs.id = ffp.source_id
             WHERE f.id = ${foodId} AND fs.source = ${source}::food_source
            UNION ALL
            -- A value cites a source item through its citation; the source row of that item is this food's crosswalk
            -- row for the same key.
            SELECT 'nutrient:' || v.nutrient_id AS field
              FROM food f
              JOIN food_nutrition h ON h.food_id = f.id
              JOIN food_nutrition_value v ON v.nutrition_id = h.id
              JOIN food_nutrition_citation c ON c.nutrition_id = v.nutrition_id AND c.id = v.citation_id
              JOIN food_sources fs ON fs.item_id = f.item_id AND fs.external_key = c.external_key
             WHERE f.id = ${foodId} AND fs.source = ${source}::food_source
            UNION ALL
            SELECT 'portion:' || fp.id AS field
              FROM food f
              JOIN food_portions fp ON fp.item_id = f.item_id
              JOIN food_sources fs ON fs.id = fp.source_id
             WHERE f.id = ${foodId} AND fs.source = ${source}::food_source
        `);

        return result.rows.map((row) => ({ field: row.field }));
    }
}
