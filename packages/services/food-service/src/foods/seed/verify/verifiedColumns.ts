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
    food_popularity: {
        item_id: 'compared',
        consumption_weight: 'compared',
        prior_fraction: 'compared',
        source: 'compared',
        seeded_at: 'clock',
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
    // The history checks (KTD-3) own forwards: every row resolves to a live root or variant, whoever wrote it.
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

/** The compared columns some verifier SQL already compares. Empty until session V2 adds the first comparison. */
export const COVERED: readonly ComparedColumn[] = [];

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
