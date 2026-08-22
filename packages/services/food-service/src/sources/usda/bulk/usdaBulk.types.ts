/**
 * Row shapes for the USDA FoodData Central **bulk download** CSVs (ingredient-search plan §2 Stage 1).
 *
 * These are NOT the API shapes. The bulk schema is a normalized relational dump — `food.csv` +
 * `food_nutrient.csv` + `food_portion.csv` joined through the `nutrient.csv` / `measure_unit.csv`
 * reference tables — whereas the live API returns one denormalized `UsdaFoodDetail` document per food.
 * That is exactly why Stage 1 needs its own mapper rather than reusing `UsdaSourceAdapter.mapToCanonical`
 * (resolution F-W2).
 *
 * Every field is a `string`, deliberately: every CSV field arrives double-quoted, and several are
 * legitimately EMPTY in the published files (`food_nutrient.amount` is blank on 33 Foundation rows;
 * `food_portion.amount`/`footnote` are blank on many; `food_portion.fdc_id` is blank on 273 orphans).
 * Coercion + range validation happens in the parser, at the value grain.
 *
 * @see usdaBulk.parser.ts for the mapping to `CanonicalCandidate`.
 */

/**
 * Every `food.data_type` this reader knows how to map — the closed set a selection may name.
 *
 * ⚠️ Membership here is "the mapper handles this shape", NOT "the catalog imports it". WHICH of these a
 * run imports is CONFIGURATION, declared by the catalog roster (`src/foods/seed/catalogDatasets.ts`) and
 * passed to the reader as `dataTypes` — so adding Survey (FNDDS) to the catalog is a roster flip, not a
 * rewrite of this filter. `branded_food` is absent on purpose: ~2M manufacturer-submitted rows, and the
 * parser's `kind: 'generic'` / null brand scalars would be wrong for every one of them.
 *
 * ⚠️ `survey_fndds_food` is the ONLY USDA data type carrying curated "additional descriptions" (U2), and
 * this reader does NOT read them — they live in the bulk zips' `food_attribute.csv` /
 * `food_attribute_type.csv`, which is not in {@link BulkLookups}. A Survey row read here therefore lands
 * with `aliases: []`. The reseed's post-condition (`assertCatalogReseeded`) is what stops that landing
 * silently: a roster that enables an alias-carrying dataset must produce alias-carrying rows.
 */
export const BULK_DATA_TYPES = ['foundation_food', 'sr_legacy_food', 'survey_fndds_food'] as const;

/** A bulk `food.data_type` this reader can map. */
export type BulkDataType = (typeof BULK_DATA_TYPES)[number];

/**
 * The DEFAULT selection: the small, high-quality, lab-analyzed whole-food datasets (Stage 1).
 *
 * **Branded is deliberately NOT seeded** (~2M rows, manufacturer-submitted, junk risk) — it stays an
 * on-demand concern. This filter is not cosmetic: the published Foundation zip's `food.csv` holds 87,990
 * rows of which only 469 are `foundation_food`; the rest are the `sub_sample_food` / `market_acquisition`
 * / `sample_food` / `agricultural_acquisition` sample-provenance chain. Reading the file wholesale would
 * seed ~187× the intended rows.
 */
export const SEEDED_BULK_DATA_TYPES: readonly BulkDataType[] = ['foundation_food', 'sr_legacy_food'];

/** One `nutrient.csv` dictionary entry: the source's nutrient name and its RAW bulk unit token. */
export interface BulkNutrientDefinition {
    /** The nutrient display name (e.g. `Protein`). */
    readonly name: string;
    /** The raw bulk unit token (e.g. `G`, `MG`, `UG`, `KCAL`) — canonicalized by the parser. */
    readonly unitName: string;
}

/** The small reference tables the per-food rows are resolved against. */
export interface BulkLookups {
    /** `nutrient.csv` keyed by `nutrient.id`. */
    readonly nutrientsById: ReadonlyMap<string, BulkNutrientDefinition>;
    /** `measure_unit.csv` name keyed by `measure_unit.id` (empty when the file is absent). */
    readonly measureUnitsById: ReadonlyMap<string, string>;
}

/** One `food_nutrient.csv` row, narrowed to the fields the mapping reads. */
export interface BulkNutrientRow {
    /** FK into `nutrient.csv`. FDC ships rows referencing ids that do NOT exist there (e.g. 2066). */
    readonly nutrientId: string;
    /** The per-100g amount as written in the file — may be blank. */
    readonly amount: string;
}

/** One `food_portion.csv` row, narrowed to the fields the mapping reads. */
export interface BulkPortionRow {
    /** FK into `measure_unit.csv`; may be blank (orphan rows) or `9999` (`undetermined`). */
    readonly measureUnitId: string;
    /** Free-text portion description (Foundation's usual label carrier), e.g. `1 cup, diced`. */
    readonly portionDescription: string;
    /** Free-text modifier (SR Legacy's usual label carrier), e.g. `cup, chopped`. */
    readonly modifier: string;
    /** Gram weight as written in the file — may be blank. */
    readonly gramWeight: string;
}

/**
 * One bulk food together with all of its nutrient and portion rows — the parser's input unit. Produced by
 * the reader (which owns the file I/O and the `data_type` filter) and consumed by the PURE parser.
 */
export interface BulkFoodBundle {
    /** The USDA `fdc_id`. **This and the reader/parser are the ONLY places the native key is named** —
     *  it becomes the source-agnostic `externalKey` the moment it leaves this boundary (FR-IDN-2). */
    readonly fdcId: string;
    /** The bulk dataset this food came from. */
    readonly dataType: BulkDataType;
    /** The food description — the golden `name` (may be blank; such foods are dropped). */
    readonly description: string;
    /** `food.publication_date` as written (usually ISO `YYYY-MM-DD`; 80 FDC rows use `M/D/YYYY`). */
    readonly publicationDate: string;
    /** This food's `food_nutrient.csv` rows. */
    readonly nutrients: readonly BulkNutrientRow[];
    /** This food's `food_portion.csv` rows. */
    readonly portions: readonly BulkPortionRow[];
}
