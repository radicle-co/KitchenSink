/**
 * `NutrientDao` (T-107, MOD-016) — the nutrient dictionary (units live here, once). Resolves a
 * source nutrient to a stable internal `nutrient_id`, deduping so duplicate `Protein` rows cannot
 * split the id (DB-5): `external_code` is the primary key when present, with `(name, unit)` as the
 * fallback — `external_code` is nullable (a source nutrient with no INFOODS tagname yields multiple
 * NULLs, which Postgres treats as distinct), so it cannot be the sole dedup key. A later-known
 * `external_code` is backfilled onto the existing `(name, unit)` row.
 *
 * @implements FR-028 FR-MRG-3 SC-008
 */
import { and, eq } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { nutrient, type NutrientRow } from '../../db/schema/index.js';
import { newFoodId } from '../../db/ulid.js';
import { isUniqueViolation } from './dao.errors.js';

/** Input for {@link NutrientDao.resolveOrCreate}. */
export interface ResolveNutrientInput {
    /** Nutrient display name (e.g. `Protein`). */
    name: string;
    /** Unit the amount is expressed in (e.g. `g`). */
    unit: string;
    /** Stable external code (INFOODS tagname) when the source provides one; else `null`/omitted. */
    externalCode?: string | null;
}

export class NutrientDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Resolve a source nutrient to its dictionary `nutrient_id`, creating the row when absent (DB-5).
     * Resolution order: `external_code` (when present) → `(name, unit)` fallback. A newly-known
     * `external_code` is backfilled onto an existing `(name, unit)` row. A lost insert race
     * (`23505`) is recovered by re-resolving.
     *
     * @param input - The source nutrient's name, unit, and optional external code.
     * @returns The resolved (or newly created) dictionary row.
     * @sideEffect Reads, and may insert/update, `nutrient`.
     */
    public async resolveOrCreate(input: ResolveNutrientInput): Promise<NutrientRow> {
        const externalCode = input.externalCode ?? null;
        const existing = await this.resolve(input);

        if (existing) {
            // Backfill a now-known code onto a row that was first seen without one.
            if (externalCode && !existing.externalCode) {
                const updated = await this.db
                    .update(nutrient)
                    .set({ externalCode })
                    .where(eq(nutrient.id, existing.id))
                    .returning();

                return updated[0] ?? existing;
            }

            return existing;
        }

        try {
            const inserted = await this.db
                .insert(nutrient)
                .values({ id: newFoodId(), name: input.name, unit: input.unit, externalCode })
                .returning();

            const row = inserted[0];

            if (!row) {
                throw new Error('nutrient insert produced no row');
            }

            return row;
        } catch (error) {
            if (isUniqueViolation(error)) {
                const after = await this.resolve(input);

                if (after) {
                    return after;
                }
            }

            throw error;
        }
    }

    /**
     * Resolve an existing dictionary row by `external_code` (when present) then by `(name, unit)`.
     *
     * @param input - The source nutrient's name, unit, and optional external code.
     * @returns The matching dictionary row, or `undefined`.
     * @sideEffect Reads `nutrient`.
     */
    private async resolve(input: ResolveNutrientInput): Promise<NutrientRow | undefined> {
        if (input.externalCode) {
            const byCode = await this.db
                .select()
                .from(nutrient)
                .where(eq(nutrient.externalCode, input.externalCode))
                .limit(1);

            if (byCode[0]) {
                return byCode[0];
            }
        }

        const byNameUnit = await this.db
            .select()
            .from(nutrient)
            .where(and(eq(nutrient.name, input.name), eq(nutrient.unit, input.unit)))
            .limit(1);

        return byNameUnit[0];
    }
}
