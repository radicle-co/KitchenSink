/**
 * Fixture factories for the USDA **bulk-download** parser (Stage 1 seed importer). `make*` builders
 * accepting `Partial<T>` per CODING_STANDARDS §"Fixture factories".
 *
 * The shapes mirror the REAL FDC bulk CSVs (`food.csv` / `food_nutrient.csv` / `food_portion.csv` /
 * `nutrient.csv` / `measure_unit.csv`) as measured from the published zips — every field is a STRING
 * because every CSV field arrives quoted, and several are legitimately empty (`food_nutrient.amount`
 * is blank on 33 Foundation rows; `food_portion.amount`/`footnote` are blank on many).
 */
import type {
    BulkFoodBundle,
    BulkLookups,
    BulkNutrientDefinition,
    BulkNutrientRow,
    BulkPortionRow,
} from '../usdaBulk.types.js';

/**
 * Build a `food_nutrient.csv`-shaped row (narrowed to the fields the mapping reads).
 *
 * @param overrides - Field overrides merged over a valid protein row.
 * @returns The bulk nutrient row.
 */
export function makeBulkNutrientRow(overrides: Partial<BulkNutrientRow> = {}): BulkNutrientRow {
    return { nutrientId: '1003', amount: '2.82', ...overrides };
}

/**
 * Build a `food_portion.csv`-shaped row (narrowed to the fields the mapping reads).
 *
 * @param overrides - Field overrides merged over a valid `1 cup, chopped` portion.
 * @returns The bulk portion row.
 */
export function makeBulkPortionRow(overrides: Partial<BulkPortionRow> = {}): BulkPortionRow {
    return { measureUnitId: '1000', portionDescription: '', modifier: 'cup, chopped', gramWeight: '91', ...overrides };
}

/**
 * Build a bulk food bundle (one `food.csv` row plus its nutrient/portion rows) — the parser's input unit.
 *
 * @param overrides - Field overrides merged over an SR-Legacy-shaped broccoli bundle.
 * @returns The bulk food bundle.
 */
export function makeBulkFoodBundle(overrides: Partial<BulkFoodBundle> = {}): BulkFoodBundle {
    return {
        fdcId: '170379',
        dataType: 'sr_legacy_food',
        description: 'Broccoli, raw',
        publicationDate: '2019-04-01',
        nutrients: [makeBulkNutrientRow()],
        portions: [makeBulkPortionRow()],
        ...overrides,
    };
}

/** The `nutrient.csv` dictionary rows the fixtures reference (real FDC ids/names/units). */
const FIXTURE_NUTRIENTS: ReadonlyArray<readonly [string, BulkNutrientDefinition]> = [
    ['1003', { name: 'Protein', unitName: 'G' }],
    ['1004', { name: 'Total lipid (fat)', unitName: 'G' }],
    ['1008', { name: 'Energy', unitName: 'KCAL' }],
    ['1087', { name: 'Calcium, Ca', unitName: 'MG' }],
    ['1110', { name: 'Vitamin D (D2 + D3), International Units', unitName: 'IU' }],
    ['1114', { name: 'Vitamin D (D2 + D3)', unitName: 'UG' }],
    ['1062', { name: 'Energy', unitName: 'kJ' }],
];

/** The `measure_unit.csv` rows the fixtures reference (real FDC ids/names). */
const FIXTURE_MEASURE_UNITS: ReadonlyArray<readonly [string, string]> = [
    ['1000', 'cup'],
    ['1002', 'tbsp'],
    ['9999', 'undetermined'],
];

/**
 * Build the reference lookups the parser resolves `nutrient_id` / `measure_unit_id` against.
 *
 * @param overrides - Optional partial lookups (either map replaces the default wholesale).
 * @returns The bulk reference lookups.
 */
export function makeBulkLookups(overrides: Partial<BulkLookups> = {}): BulkLookups {
    return {
        nutrientsById: new Map(FIXTURE_NUTRIENTS),
        measureUnitsById: new Map(FIXTURE_MEASURE_UNITS),
        ...overrides,
    };
}
