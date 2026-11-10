/**
 * An authored food's four macros and the nutrient identities they are stored under (plan U10, Q3a; ADR-0029 §7).
 *
 * ONE mapping serves both directions: `AuthoredFoodsDao` writes each macro as the value of its dictionary row, and
 * {@link authoredMacrosOf} reads them back from the same rows for the author's own read. The identity is `name` AND
 * `unit` ({@link LABEL_NUTRIENT_MAP}): `Energy` is stored once in `kcal` and once in `kj` under one name.
 */
import type { AuthoredMacros } from '../foods.schema.js';
import { LABEL_NUTRIENT_MAP } from '../nutrition/labelNutrientMap.js';

/** Each authored macro and the dictionary row it is stored as, in write order. */
export const AUTHORED_MACRO_IDENTITIES = [
    { key: 'calories', identity: LABEL_NUTRIENT_MAP.calories },
    { key: 'proteinG', identity: LABEL_NUTRIENT_MAP.protein },
    { key: 'carbsG', identity: LABEL_NUTRIENT_MAP.carbohydrates },
    { key: 'fatG', identity: LABEL_NUTRIENT_MAP.fat },
] as const satisfies readonly { readonly key: keyof AuthoredMacros; readonly identity: object }[];

/** A stored nutrient value, as the golden record carries it. */
export interface StoredNutrientValue {
    readonly name: string;
    readonly unit: string;
    readonly amount: string;
}

/**
 * The four macros a food's nutrient rows hold, read by their exact identity. Pure.
 *
 * @param nutrients - The food's live nutrient rows.
 * @returns The macros, or `undefined` when any of the four is missing (an authored food always writes all four).
 */
export function authoredMacrosOf(nutrients: readonly StoredNutrientValue[]): AuthoredMacros | undefined {
    const found: Partial<Record<keyof AuthoredMacros, number>> = {};

    for (const { key, identity } of AUTHORED_MACRO_IDENTITIES) {
        const row = nutrients.find((candidate) => candidate.name === identity.name && candidate.unit === identity.unit);

        if (row !== undefined) {
            found[key] = Number(row.amount);
        }
    }

    const { calories, proteinG, carbsG, fatG } = found;

    return calories === undefined || proteinG === undefined || carbsG === undefined || fatG === undefined
        ? undefined
        : { calories, proteinG, carbsG, fatG };
}
