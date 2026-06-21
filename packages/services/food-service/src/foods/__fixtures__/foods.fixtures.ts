/**
 * Fixture factories for the foods domain (`make*` convention, `Partial<T>` override).
 */
import type { FoodRow } from '../../db/schema/usda.js';

/**
 * Build a `foods` DB row with sensible fetched-apple defaults.
 *
 * @param overrides - Partial fields to override.
 * @returns A complete {@link FoodRow}.
 */
export function makeFoodRow(overrides: Partial<FoodRow> = {}): FoodRow {
    const now = new Date();

    return {
        fdcId: 171688,
        description: 'Apple, raw, granny smith',
        dataType: 'Foundation',
        fetchStatus: 'fetched',
        upcCode: null,
        brandOwner: null,
        brandName: null,
        calories: '58',
        proteinG: '0.3',
        carbsG: '13.4',
        fatG: '0.2',
        fiberG: '2.4',
        sodiumMg: '1',
        sugarG: '10.1',
        saturatedFatG: '0.03',
        cholesterolMg: '0',
        vitaminAIu: '54',
        vitaminCMg: '4.6',
        calciumMg: '6',
        ironMg: '0.12',
        rawJson: null,
        searchVector: null,
        requestCount: 0,
        fetchedAt: now,
        lastRequestedAt: now,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    } as FoodRow;
}
