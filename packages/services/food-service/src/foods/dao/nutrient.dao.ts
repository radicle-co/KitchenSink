/**
 * `NutrientDao` (T-107, MOD-016) — the nutrient dictionary (units live here, once). Resolves a source nutrient to a
 * stable internal `nutrient_id`: by its INFOODS tag when it has one, else by `(name, unit)` (DB-5, KTD-23). The tag is
 * nullable (USDA's Atwater energies have none, and Postgres treats NULLs as distinct), so `(name, unit)` stays the
 * dedup key that always holds.
 *
 * A shared dictionary (KTD-14): the service inserts a missing entry and holds no UPDATE or DELETE, so an entry is
 * written whole at insert. A pair `NUTRIENT_DEFINITIONS` maps gets its tag then, and a stated tag the mapping
 * contradicts is refused rather than stored.
 *
 * @pattern Table Data Gateway — the dictionary's one gateway
 * @implements FR-028 FR-MRG-3 SC-008
 */
import { and, eq } from 'drizzle-orm';

import type { FoodWriter } from '../../database/unitOfWork.js';
import { nutrient, type NutrientRow } from '../../db/schema/index.js';
import { newFoodId } from '../../db/ulid.js';
import { NUTRIENT_DEFINITIONS } from '../nutrition/nutrientIdentity.js';
import { NutrientDefinitionMismatchError } from './dao.errors.js';

/** Input for {@link NutrientDao.resolveOrCreate}. */
export interface ResolveNutrientInput {
    /** Nutrient display name (e.g. `Protein`). */
    name: string;
    /** Unit the amount is expressed in (e.g. `g`). */
    unit: string;
    /** The definition's INFOODS tag when the source states one; else `null`/omitted. */
    infoodsTag?: string | null;
}

/**
 * The tag `NUTRIENT_DEFINITIONS` gives a dictionary pair. Pure.
 *
 * @param name - The canonical name.
 * @param unit - The canonical unit.
 * @returns The tag; `null` for a mapped definition with none; `undefined` for an unmapped pair.
 */
export function mappedTagOf(name: string, unit: string): string | null | undefined {
    return Object.values(NUTRIENT_DEFINITIONS).find(
        (definition) => definition.name === name && definition.unit === unit,
    )?.tag;
}

export class NutrientDao {
    public constructor(private readonly db: FoodWriter) {}

    /**
     * Resolve a nutrient to its dictionary row, creating it when absent.
     *
     * Insert-then-read under `ON CONFLICT DO NOTHING`, so a concurrent insert of the same entry is read back rather
     * than raising inside the caller's transaction (where a raised error would abort it).
     *
     * @param input - The name, unit and optional tag.
     * @returns The dictionary row.
     * @throws {NutrientDefinitionMismatchError} when a stated tag contradicts the pair's mapped tag.
     * @sideEffect Reads `nutrient`; may insert one row.
     */
    public async resolveOrCreate(input: ResolveNutrientInput): Promise<NutrientRow> {
        const mapped = mappedTagOf(input.name, input.unit);
        const stated = input.infoodsTag ?? null;

        if (stated !== null && mapped !== undefined && stated !== mapped) {
            throw new NutrientDefinitionMismatchError(input, stated, mapped ?? 'untagged');
        }

        const infoodsTag = stated ?? mapped ?? null;
        const existing = await this.resolve(input.name, input.unit, infoodsTag);

        if (existing) {
            return existing;
        }

        await this.db
            .insert(nutrient)
            .values({ id: newFoodId(), name: input.name, unit: input.unit, infoodsTag })
            .onConflictDoNothing();

        const created = await this.resolve(input.name, input.unit, infoodsTag);

        if (!created) {
            throw new Error(`nutrient (${input.name}, ${input.unit}) was neither inserted nor found`);
        }

        return created;
    }

    /**
     * The dictionary row by tag, else by `(name, unit)`.
     *
     * @param name - The name.
     * @param unit - The unit.
     * @param infoodsTag - The tag, or `null`.
     * @returns The row, or `undefined`.
     * @sideEffect Reads `nutrient`.
     */
    private async resolve(name: string, unit: string, infoodsTag: string | null): Promise<NutrientRow | undefined> {
        if (infoodsTag !== null) {
            const byTag = await this.db.select().from(nutrient).where(eq(nutrient.infoodsTag, infoodsTag)).limit(1);

            if (byTag[0]) {
                return byTag[0];
            }
        }

        const byNameUnit = await this.db
            .select()
            .from(nutrient)
            .where(and(eq(nutrient.name, name), eq(nutrient.unit, unit)))
            .limit(1);

        return byNameUnit[0];
    }
}
