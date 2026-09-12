/**
 * Matvaretabellen `foods.json` fixtures, shaped as the publisher served them on 2026-10-01 (`/api/en/foods.json`,
 * 2,121 foods). Only the fields a test varies are typed; the rest are kept so a payload looks like a real one.
 */

/** One constituent of a food, as published. `quantity` is absent or `null` when the table states none. */
export interface MatvaretabellenConstituent {
    readonly nutrientId: string;
    readonly sourceId: string;
    readonly quantity?: number | null;
    readonly unit?: string;
}

/** One food, as published. */
export interface MatvaretabellenFood {
    readonly foodId: string;
    readonly foodName: string;
    readonly calories: { readonly sourceId: string; readonly quantity: number | null; readonly unit: string };
    readonly energy: { readonly sourceId?: string; readonly quantity?: number; readonly unit?: string };
    readonly constituents: readonly MatvaretabellenConstituent[];
    readonly [field: string]: unknown;
}

/**
 * Adzuki beans, uncooked (06.178), trimmed to the fields the mirror reads plus two it does not.
 *
 * @param overrides - Fields to replace.
 * @returns The food.
 */
export function makeMatvaretabellenFood(overrides: Partial<MatvaretabellenFood> = {}): MatvaretabellenFood {
    return {
        foodId: '06.178',
        foodName: 'Adzuki beans, uncooked',
        latinName: 'Vigna angularis (Willd.) Ohwi & H. Ohashi var. angularis',
        uri: 'https://www.matvaretabellen.no/en/adzuki-beans-uncooked/',
        foodGroupId: '12',
        calories: { sourceId: 'MI0115', quantity: 310, unit: 'kcal' },
        energy: { sourceId: 'MI0114', quantity: 1312.4, unit: 'kJ' },
        constituents: [
            { sourceId: '460g', quantity: 0.5, unit: 'g', nutrientId: 'Fett' },
            { sourceId: 'MI0181', quantity: 50.2, unit: 'g', nutrientId: 'Karbo' },
            { sourceId: '460g', quantity: 13, unit: 'g', nutrientId: 'Fiber' },
            { sourceId: '460g', quantity: 19.9, unit: 'g', nutrientId: 'Protein' },
            { sourceId: '460g', quantity: 1.09, unit: 'mg', nutrientId: 'Cu' },
            { sourceId: '10', nutrientId: 'Vit E' },
        ],
        ...overrides,
    };
}

/**
 * A `foods.json` document's text.
 *
 * @param foods - Its foods.
 * @param locale - Its locale.
 * @returns The text.
 */
export function matvaretabellenDocument(foods: readonly unknown[], locale = 'en'): string {
    return JSON.stringify({ foods, locale });
}
