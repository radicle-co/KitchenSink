/**
 * @module @commise/features-recipes/foodPage — the "Your edit" comparison of state 9 (private foods spec D4): the fields a
 * waiting edit changes, as "from to" pairs over the public version, and nothing else. Pure.
 *
 * Macros to macros: the public version's figures are the food's `authoredMacros`, which food-service reads from the live
 * row by nutrient identity, and the waiting edit's are its `PublicationSnapshot.macros`.
 */
import type { AuthoredMacros, FoodResponse, PublicationSnapshot } from '@kitchensink/schema-food';

/** A figure the comparison can list, in the order it lists them. */
export type ComparedField = 'name' | keyof AuthoredMacros;

const ORDER: readonly ComparedField[] = ['name', 'calories', 'proteinG', 'carbsG', 'fatG'];

/** One changed field. `unit` is null for the name. */
export interface ComparedRow {
    readonly field: ComparedField;
    readonly from: string;
    readonly to: string;
    readonly unit: 'kcal' | 'g' | null;
}

const UNIT_OF: Readonly<Record<keyof AuthoredMacros, 'kcal' | 'g'>> = {
    calories: 'kcal',
    proteinG: 'g',
    carbsG: 'g',
    fatG: 'g',
};

/** A figure as the cook reads it: its decimals only when it has some. Pure. */
export function figureText(amount: number): string {
    return String(Math.round(amount * 100) / 100);
}

/**
 * The fields the waiting edit changes. Pure.
 *
 * @param food - The public version the page shows.
 * @param snapshot - What the waiting edit says.
 * @returns One row per changed field, in a fixed order; empty when nothing changed.
 */
export function foodEditComparison(food: FoodResponse, snapshot: PublicationSnapshot): readonly ComparedRow[] {
    const live: Partial<AuthoredMacros> = food.authoredMacros ?? {};
    const rows: ComparedRow[] = [];

    for (const field of ORDER) {
        if (field === 'name') {
            if ((food.name ?? '') !== snapshot.name) {
                rows.push({ field, from: food.name ?? '', to: snapshot.name, unit: null });
            }

            continue;
        }

        const before = live[field];
        const after = snapshot.macros[field];

        if (before !== after) {
            rows.push({
                field,
                from: before === undefined ? '' : figureText(before),
                to: figureText(after),
                unit: UNIT_OF[field],
            });
        }
    }

    return rows;
}
