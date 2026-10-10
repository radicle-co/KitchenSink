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
import { and, eq, inArray, or } from 'drizzle-orm';

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

/** One input after its tag is settled: the definition the dictionary is asked for. */
export interface WantedNutrient {
    readonly name: string;
    readonly unit: string;
    readonly infoodsTag: string | null;
}

/**
 * Settle an input's tag against the mapping. Pure.
 *
 * @param input - The name, unit and optional stated tag.
 * @returns The definition: the stated tag, else the mapped one, else none.
 * @throws {NutrientDefinitionMismatchError} when a stated tag contradicts the pair's mapped tag.
 */
export function wantedOf(input: ResolveNutrientInput): WantedNutrient {
    const mapped = mappedTagOf(input.name, input.unit);
    const stated = input.infoodsTag ?? null;

    if (stated !== null && mapped !== undefined && stated !== mapped) {
        throw new NutrientDefinitionMismatchError(input, stated, mapped ?? 'untagged');
    }

    return { name: input.name, unit: input.unit, infoodsTag: stated ?? mapped ?? null };
}

/**
 * The held row a definition resolves to: by tag, else by `(name, unit)`. Pure.
 *
 * @param rows - Dictionary rows read for the batch.
 * @param wanted - The definition.
 * @returns The row, or `undefined`.
 */
export function heldRowFor(rows: readonly NutrientRow[], wanted: WantedNutrient): NutrientRow | undefined {
    const byTag = wanted.infoodsTag === null ? undefined : rows.find((row) => row.infoodsTag === wanted.infoodsTag);

    return byTag ?? rows.find((row) => row.name === wanted.name && row.unit === wanted.unit);
}

export class NutrientDao {
    public constructor(private readonly db: FoodWriter) {}

    /**
     * Resolve a nutrient to its dictionary row, creating it when absent.
     *
     * @param input - The name, unit and optional tag.
     * @returns The dictionary row.
     * @throws {NutrientDefinitionMismatchError} when a stated tag contradicts the pair's mapped tag.
     * @sideEffect Reads `nutrient`; may insert one row.
     */
    public async resolveOrCreate(input: ResolveNutrientInput): Promise<NutrientRow> {
        const [row] = await this.resolveOrCreateMany([input]);

        if (!row) {
            throw new Error(`nutrient (${input.name}, ${input.unit}) was neither inserted nor found`);
        }

        return row;
    }

    /**
     * Resolve many nutrients to their dictionary rows, creating the absent ones, in at most three statements
     * whatever the count: one read, one insert of what the read did not find, one read of what that inserted.
     * A per-nutrient read and insert was an N+1 on every food write (KITCHENSINK-FOOD-SERVICE-2/-8).
     *
     * Insert-then-read under `ON CONFLICT DO NOTHING`, so a concurrent insert of the same entry is read back rather
     * than raising inside the caller's transaction (where a raised error would abort it).
     *
     * ⚠️ Every tag is settled BEFORE any statement, so one contradicted tag refuses the whole batch and writes
     * nothing — the same outcome the one-at-a-time form gave its caller's transaction.
     *
     * @param inputs - The names, units and optional tags.
     * @returns One row per input, in input order; inputs naming one definition share its row.
     * @throws {NutrientDefinitionMismatchError} when any stated tag contradicts its pair's mapped tag.
     * @sideEffect Reads `nutrient`; may insert rows.
     */
    public async resolveOrCreateMany(inputs: readonly ResolveNutrientInput[]): Promise<NutrientRow[]> {
        const wanted = inputs.map(wantedOf);

        if (wanted.length === 0) {
            return [];
        }

        let held = await this.read(wanted);
        const absent = [
            ...new Map(
                wanted
                    .filter((definition) => heldRowFor(held, definition) === undefined)
                    .map((definition) => [JSON.stringify([definition.name, definition.unit]), definition]),
            ).values(),
        ];

        if (absent.length > 0) {
            await this.db
                .insert(nutrient)
                .values(absent.map((definition) => ({ id: newFoodId(), ...definition })))
                .onConflictDoNothing();

            held = [...held, ...(await this.read(absent))];
        }

        return wanted.map((definition) => {
            const row = heldRowFor(held, definition);

            if (!row) {
                throw new Error(`nutrient (${definition.name}, ${definition.unit}) was neither inserted nor found`);
            }

            return row;
        });
    }

    /**
     * Every dictionary row any of the definitions could resolve to — by tag or by `(name, unit)` — in one read.
     *
     * @param wanted - The definitions.
     * @returns The candidate rows.
     * @sideEffect Reads `nutrient`.
     */
    private async read(wanted: readonly WantedNutrient[]): Promise<NutrientRow[]> {
        const tags = wanted.flatMap((definition) => (definition.infoodsTag === null ? [] : [definition.infoodsTag]));
        const byPair = wanted.map((definition) =>
            and(eq(nutrient.name, definition.name), eq(nutrient.unit, definition.unit)),
        );

        return this.db
            .select()
            .from(nutrient)
            .where(or(...byPair, ...(tags.length === 0 ? [] : [inArray(nutrient.infoodsTag, tags)])));
    }
}
