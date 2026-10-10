/**
 * How the catalog verifier treats each column of each catalog table, and which compared columns it still owes
 * (curated catalog plan U6, KTD-3).
 *
 * @pattern Registry — one authority for every catalog column's disposition under the verifier
 *
 * A disposition says how a column takes part in "the database equals the committed bytes":
 *
 * - `compared` — its value equals the value the committed bytes imply. A reference to another row is compared by
 *   the row it points at, through that row's natural key, never by its minted id.
 * - `identity` — the row's own minted id. It means nothing beyond the row, so rows are matched by natural key.
 * - `clock` — an instant the applier stamps. No committed byte implies it.
 * - `generated` — computed by Postgres from other columns, which are compared instead. `food_item.seed_owned`, the
 *   seeder's ownership column, is one, so the verifier never reads it.
 *
 * ⛔ This module imports nothing. The verifier may not import the schema (the fence in `eslint.config.js`), and the
 * repo gate `seedVerifierOwed.test.ts` imports {@link OWED} from outside the package. `__tests__/verifiedColumns.test.ts`
 * holds the register to exactly the catalog's declared columns and refutes any `identity`, `clock` or `generated`
 * claim the declaration contradicts.
 *
 * A session that adds SQL comparing a column adds it to {@link COVERED}. Forgetting to is the safe failure: the column
 * stays owed and the gate stays shut. Claiming a column it does not compare is the unsafe one, which the corruption
 * matrix (plan U6, session V5) refutes column by column.
 */

/** How the verifier treats one column. */
export type ColumnDisposition = 'compared' | 'identity' | 'clock' | 'generated';

/** Every catalog table's columns, by SQL name. */
export const VERIFIED_COLUMNS = {
    food: {
        id: 'identity',
        name: 'compared',
        normalized_name: 'compared',
        description: 'compared',
        kind: 'compared',
        brand_owner: 'compared',
        brand_name: 'compared',
        barcode: 'compared',
        aliases: 'compared',
        status: 'compared',
        item_id: 'compared',
        item_owner_kind: 'compared',
        seed_key: 'compared',
        // A live seeded root has none. Retired roots are the history checks' (KTD-3), so the null-ness is compared.
        retired_at: 'compared',
        user_id: 'compared',
        visibility: 'compared',
        tombstoned_at: 'compared',
        withdrawn_at: 'compared',
        created_at: 'clock',
        updated_at: 'clock',
        search_vector: 'generated',
        aliases_search_vector: 'generated',
        rank_folded: 'generated',
        rank_tokens: 'generated',
        rank_head: 'generated',
    },
    food_item: {
        id: 'identity',
        natural_key: 'compared',
        seed_owned: 'generated',
        owner_kind: 'compared',
        created_at: 'clock',
    },
    food_variant: {
        id: 'identity',
        food_id: 'compared',
        item_id: 'compared',
        item_owner_kind: 'compared',
        retired_at: 'compared',
        created_at: 'clock',
    },
    food_variant_part: {
        variant_id: 'compared',
        attribute: 'compared',
        ordinal: 'compared',
        text: 'compared',
    },
    food_sources: {
        id: 'identity',
        item_id: 'compared',
        source: 'compared',
        external_key: 'compared',
        fetch_state: 'compared',
        item_version: 'compared',
        fetched_at: 'clock',
        lineage_key: 'compared',
    },
    food_field_provenance: {
        item_id: 'compared',
        field: 'compared',
        source_id: 'compared',
    },
    food_category_assignment: {
        item_id: 'compared',
        category_id: 'compared',
        source_id: 'compared',
    },
    food_portions: {
        id: 'identity',
        item_id: 'compared',
        label: 'compared',
        gram_weight: 'compared',
        source_id: 'compared',
        citation_id: 'compared',
    },
    food_nutrition: {
        id: 'identity',
        food_id: 'compared',
        food_variant_id: 'compared',
    },
    food_nutrition_citation: {
        id: 'identity',
        nutrition_id: 'compared',
        dataset: 'compared',
        external_key: 'compared',
        match: 'compared',
        density_g_per_ml: 'compared',
        kcal_from_kj: 'compared',
        url: 'compared',
        retrieved_on: 'compared',
        manufacturer: 'compared',
        serving_label: 'compared',
        serving_grams: 'compared',
    },
    food_nutrition_value: {
        nutrition_id: 'compared',
        nutrient_id: 'compared',
        amount: 'compared',
        trace: 'compared',
        basis: 'compared',
        citation_id: 'compared',
    },
    // The history checks (KTD-3, `checkForwards.sql`) own forwards, whoever wrote them.
    food_forward: {
        source_id: 'identity',
        source_kind: 'compared',
        source_key: 'compared',
        target_food_id: 'compared',
        target_variant_id: 'compared',
        created_at: 'clock',
    },
} as const satisfies Readonly<Record<string, Readonly<Record<string, ColumnDisposition>>>>;

/** The register's tables. */
type VerifiedTable = keyof typeof VERIFIED_COLUMNS;

/** A compared column of one table, as `table.column`. */
type ComparedColumnOf<T extends VerifiedTable> = {
    [C in keyof (typeof VERIFIED_COLUMNS)[T]]: (typeof VERIFIED_COLUMNS)[T][C] extends 'compared'
        ? `${T}.${C & string}`
        : never;
}[keyof (typeof VERIFIED_COLUMNS)[T]];

/** Any compared column, as `table.column`. */
type ComparedColumn = { [T in VerifiedTable]: ComparedColumnOf<T> }[VerifiedTable];

/**
 * The compared columns some verifier SQL already compares. Each is held by a case that changes it and fails `verify`, or
 * that shows the schema refuses the change: in `tests/e2e/catalogVerifierCompare.e2e.test.ts` over a miniature seed, and
 * in `tests/e2e/catalogVerifierSeeded.e2e.test.ts` over the real seed, whose matrix is held to this list exactly.
 */
export const COVERED: readonly ComparedColumn[] = [
    // Session V2: roots, items and source rows (`sql/checkRoots.sql`, `checkItems.sql`, `checkSources.sql`).
    'food.name',
    'food.normalized_name',
    'food.aliases',
    'food.status',
    'food.item_id',
    'food.item_owner_kind',
    'food.seed_key',
    'food.retired_at',
    'food.user_id',
    'food.visibility',
    'food.tombstoned_at',
    'food.withdrawn_at',
    'food_item.natural_key',
    'food_item.owner_kind',
    'food_sources.item_id',
    'food_sources.source',
    'food_sources.external_key',
    'food_sources.lineage_key',
    // The seeder's write contract (`catalog/catalogWriteSet.ts`): the constants every seeded root and source row
    // carries, and no field provenance (`checkRoots.sql`, `checkSources.sql`, `checkFieldProvenance.sql`).
    'food.description',
    'food.kind',
    'food.brand_owner',
    'food.brand_name',
    'food.barcode',
    'food_sources.fetch_state',
    'food_sources.item_version',
    'food_field_provenance.item_id',
    'food_field_provenance.field',
    'food_field_provenance.source_id',
    // Session V3: variants, parts and food groups (`checkVariants.sql`, `checkParts.sql`, `checkCategories.sql`). A
    // part's ordinal is compared by the order it gives.
    'food_variant.food_id',
    'food_variant.item_id',
    'food_variant.item_owner_kind',
    'food_variant.retired_at',
    'food_variant_part.variant_id',
    'food_variant_part.attribute',
    'food_variant_part.ordinal',
    'food_variant_part.text',
    'food_category_assignment.item_id',
    'food_category_assignment.category_id',
    'food_category_assignment.source_id',
    // Session V4: portions and nutrition (`checkPortions.sql`, `checkNutrition.sql`, `checkCitations.sql`,
    // `checkValues.sql`, `checkSeedHeaders.sql`). A reference is compared by what it points at.
    'food_portions.item_id',
    'food_portions.label',
    'food_portions.gram_weight',
    'food_portions.source_id',
    'food_portions.citation_id',
    'food_nutrition.food_id',
    'food_nutrition.food_variant_id',
    'food_nutrition_citation.nutrition_id',
    'food_nutrition_citation.dataset',
    'food_nutrition_citation.external_key',
    'food_nutrition_citation.match',
    'food_nutrition_citation.density_g_per_ml',
    'food_nutrition_citation.kcal_from_kj',
    'food_nutrition_citation.url',
    'food_nutrition_citation.retrieved_on',
    'food_nutrition_citation.manufacturer',
    'food_nutrition_citation.serving_label',
    'food_nutrition_citation.serving_grams',
    'food_nutrition_value.nutrition_id',
    'food_nutrition_value.nutrient_id',
    'food_nutrition_value.amount',
    'food_nutrition_value.trace',
    'food_nutrition_value.basis',
    'food_nutrition_value.citation_id',
    // Session V5: history, one way (`checkRetired.sql`, `checkForwards.sql`).
    'food_forward.source_kind',
    'food_forward.source_key',
    'food_forward.target_food_id',
    'food_forward.target_variant_id',
];

/** Whether a register entry is a compared column. Pure. */
const isCompared = (entry: readonly [string, ColumnDisposition]): boolean => entry[1] === 'compared';

/**
 * The compared columns no verifier SQL compares yet, as `table.column`, sorted. While any remain, no deploy may run the
 * seed (`packages/infra/global/__tests__/seedVerifierOwed.test.ts`).
 */
export const OWED: readonly string[] = Object.entries(VERIFIED_COLUMNS)
    .flatMap(([table, columns]) =>
        Object.entries<ColumnDisposition>(columns)
            .filter(isCompared)
            .map(([column]) => `${table}.${column}`),
    )
    .filter((column) => !COVERED.some((covered) => covered === column))
    .sort();
