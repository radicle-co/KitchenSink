/**
 * The catalog dataset ROSTER (U12b) — which USDA bulk datasets the reseed imports, and what each one is
 * expected to bring with it. Plan
 * `docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md` §U12, Sequencing step 5.
 *
 * ── WHY THIS IS A MODULE AND NOT A CONSTANT IN THE READER ────────────────────────────────────────────
 * "Which datasets is the catalog built from" is a PRODUCT decision that changes for different reasons
 * than "how is an FDC CSV parsed". Keeping it here means adding or removing a dataset is a change to
 * THIS file plus a `--dir` pointed at the extraction — not an edit to the file-format layer. The reader
 * takes the selection as a parameter (`UsdaBulkReadOptions.dataTypes`) and defaults to today's.
 *
 * ── ⚠️ THE CONSEQUENCE THIS ROSTER RECORDS: THE RESEED LANDS NO ALIASES ──────────────────────────────
 * U2 recovered USDA's curated "additional descriptions" into `food.aliases` — 9,648 alternate names
 * across 5,432 rows of brands, regional synonyms and alternate forms, the cheapest large ranking win
 * available. U2 also MEASURED where they come from: **Survey (FNDDS) foods only**. The two datasets
 * enabled below — `foundation_food` and `sr_legacy_food` — were verified live against FDC on 2026-08-21
 * to return `additionalDescriptions: ''` and to carry no alias attribute.
 *
 * So **after a reseed, `food.aliases` is NULL across the entire bulk catalog.** A reseed does NOT, on its
 * own, make U2's alias ranking observable; aliases reach the catalog only through the LIVE acquisition
 * path (`UsdaSourceAdapter`), one on-demand food at a time. This is stated here, asserted by
 * `tests/catalogReseed.integration.test.ts`, and reported by every run
 * (`aliasesExpected` / `foodsWithAliases`) so it cannot be mistaken for a bug in U2.
 *
 * ⛔ **Whether to seed FNDDS is the OWNER's decision, not this module's.** It is not a code question: FNDDS
 * is composite PREPARED DISHES ("Cheese, cheddar, prepared"), and admitting ~5.4k of them into a catalog
 * whose job is to answer "which ingredient is this recipe line?" puts dishes in direct competition with
 * ingredient rows — immediately before the ranking work that would be measured against them. The entry
 * below is therefore present and DISABLED rather than absent, so enabling it is a one-word decision with
 * its reasoning attached.
 *
 * ⚠️ **Enabling it also needs reader work, and the reseed will TELL you so rather than seed silently.**
 * The bulk zips carry additional descriptions in `food_attribute.csv` + `food_attribute_type.csv`, which
 * `usdaBulk.reader.ts` does not read — so FNDDS rows imported today would arrive alias-less, exactly the
 * state the roster flip was meant to fix. `assertCatalogReseeded` fails the run when an enabled dataset
 * declares `carriesAliases` and no row ends up carrying any.
 *
 * ── PATTERN ─────────────────────────────────────────────────────────────────────────────────────────
 * A Registry of declarative entries plus pure selectors over it. No behaviour, no I/O.
 */
import type { BulkDataType } from '../../sources/usda/bulk/usdaBulk.types.js';

/** One dataset the catalog may be built from. */
export interface CatalogDataset {
    /** Stable identifier for logs and reports. */
    readonly id: string;
    /** The USDA `food.data_type` token this dataset's rows carry. */
    readonly dataType: BulkDataType;
    /** Whether the reseed imports it. */
    readonly enabled: boolean;
    /**
     * Whether USDA publishes curated "additional descriptions" for this dataset (U2).
     *
     * ⚠️ Load-bearing: when an ENABLED entry declares `true`, the reseed's post-condition requires that
     * aliases actually LAND, so enabling an alias-carrying dataset without an alias-reading path fails
     * the run instead of quietly seeding alias-less rows.
     */
    readonly carriesAliases: boolean;
    /** Why this entry is enabled or disabled — the decision, not a restatement of the flags. */
    readonly why: string;
}

/**
 * The shipped roster. Foundation + SR Legacy in; Survey (FNDDS) recorded and out.
 *
 * `branded_food` does not appear at all: it is ~2M manufacturer-submitted rows and stays an on-demand
 * concern (Stage 1 scope), and the bulk parser's `kind: 'generic'` / null brand scalars would be wrong
 * for every one of them — it is not a flag away from being correct, so it is not offered as one.
 */
export const CATALOG_DATASETS: readonly CatalogDataset[] = [
    {
        id: 'foundation',
        dataType: 'foundation_food',
        enabled: true,
        carriesAliases: false,
        why:
            'Lab-analyzed whole foods (~469 rows), the highest-quality nutrition USDA publishes and the ' +
            'core of an ingredient catalog. Verified live against FDC (2026-08-21): no additional ' +
            'descriptions, so it contributes no aliases.',
    },
    {
        id: 'srLegacy',
        dataType: 'sr_legacy_food',
        enabled: true,
        carriesAliases: false,
        why:
            'The frozen SR Legacy reference set (~7,793 rows) — the breadth of the catalog, and never ' +
            're-issued since 2018-04, so a reseed reproduces it exactly. Verified live against FDC ' +
            '(2026-08-21) across eight rows: no additional descriptions, so it contributes no aliases.',
    },
    {
        id: 'surveyFndds',
        dataType: 'survey_fndds_food',
        enabled: false,
        carriesAliases: true,
        why:
            'DISABLED — owner decision pending. The ONLY USDA dataset carrying curated aliases (9,648 ' +
            'across 5,432 rows), and therefore the only way a bulk reseed could make U2 observable — but ' +
            'FNDDS is composite PREPARED DISHES, which would compete with ingredient rows in the very ' +
            'search the ranking work is about to be measured on. That is a product decision, not an ' +
            'engineering one. Enabling it also requires the bulk reader to read food_attribute.csv; ' +
            'until it does, the reseed post-condition fails the run rather than seeding alias-less rows.',
    },
];

/**
 * The `data_type`s an enabled roster selects, in roster order.
 *
 * @param datasets - The roster.
 * @returns The enabled data types (possibly empty — the reseed refuses on that).
 */
export function enabledDataTypes(datasets: readonly CatalogDataset[]): readonly BulkDataType[] {
    return datasets.filter((dataset) => dataset.enabled).map((dataset) => dataset.dataType);
}

/**
 * Whether this roster promises that curated aliases will land — the post-condition's expectation.
 *
 * A DISABLED alias-carrying entry promises nothing: a roster is not a claim about rows it excludes.
 *
 * @param datasets - The roster.
 * @returns `true` when at least one ENABLED entry carries aliases.
 */
export function expectsAliases(datasets: readonly CatalogDataset[]): boolean {
    return datasets.some((dataset) => dataset.enabled && dataset.carriesAliases);
}
