/**
 * USDA **bulk download** → {@link CanonicalCandidate} mapping (ingredient-search plan §2 Stage 1, F-W2).
 *
 * This is the second — and only other — place in the system where USDA's native `fdc_id` is named
 * (FR-IDN-2); it becomes the source-agnostic `externalKey` here and nothing downstream sees it again.
 *
 * **Why this is NOT a reuse of `UsdaSourceAdapter.mapToCanonical`.** The bulk CSVs are a normalized
 * relational dump (`food.csv` + `food_nutrient.csv` + `food_portion.csv` joined through `nutrient.csv` /
 * `measure_unit.csv`, fields `gram_weight` / `portion_description` / `measure_unit`), while the private
 * API mapper consumes one denormalized `UsdaFoodDetail` document (`foodNutrients[].nutrient.unitName`,
 * `foodPortions[].gramWeight`, `labelNutrients`). Different shape, different join, different nullability —
 * so the mapping is re-implemented. What IS shared is the *knowledge that must not diverge*: the
 * `(name, unit)` dictionary canonicalization is imported from the adapter
 * ({@link canonicalizeNutrientName} / {@link canonicalizeUnit}) rather than re-derived, because a bulk
 * value and a live value for the same nutrient MUST resolve to ONE `nutrient (name, unit)` row (DB-5).
 *
 * **Reject-not-store at the VALUE grain.** The API adapter throws and rejects a whole candidate on a bad
 * value — correct there, where a malformed response means the whole document is suspect. Bulk files are
 * different: FDC ships *known* bad rows in an otherwise-good 8k-row dataset (33 Foundation rows have a
 * blank `amount`, and all 33 point at `nutrient_id` 2066 which does not exist in `nutrient.csv`; 273
 * portion rows are orphans). Dropping a whole lab-analyzed food over one unusable nutrient would lose
 * good data for no benefit, so this mapper drops the VALUE and keeps the food — the same grain
 * `sanitizeCandidates` uses at the merge boundary (FR-ADP-2/FR-ADP-3). Only a food with no usable NAME is
 * dropped whole.
 *
 * All functions here are PURE: no I/O, no clock, no randomness. The reader owns the file I/O.
 *
 * @implements FR-IDN-2 FR-IDN-3 FR-ADP-2 FR-ADP-3 FR-MRG-3
 */
import { createHash } from 'node:crypto';

import type { CanonicalCandidate, CanonicalNutrient, CanonicalPortion } from '../../food-source-adapter.js';
import { canonicalizeNutrientName, canonicalizeUnit } from '../usda.adapter.js';
import type { BulkFoodBundle, BulkLookups } from './usda-bulk.types.js';

/** The canonical source identifier for USDA data (matches `UsdaSourceAdapter`). */
const SOURCE = 'usda' as const;

/**
 * Prefix on every bulk-derived `item_version`. Two jobs:
 *
 *  1. it makes the value **self-describing** in the crosswalk, so `food_sources.item_version` reads as
 *     "this came from a bulk file" at a glance; and
 *  2. it guarantees a bulk version can NEVER collide with an API `publicationDate` (`2019-04-01`) or a
 *     raw content hash from the live adapter — the two version spaces stay provably disjoint.
 *
 * Note this is a convenience, NOT the refresh gate: `food.origin` is the gate (F-C2/F3), because
 * `item_version` is compared for equality only and a bulk value can never equal an API value anyway.
 */
export const BULK_ITEM_VERSION_PREFIX = 'bulk:';

/** Upper sanity bound on an amount / gram weight (mirrors the API adapter's `MAX_AMOUNT`). */
const MAX_AMOUNT = 10_000_000;

/**
 * A non-negative plain decimal — the `numeric` domain `food_nutrients.amount >= 0` accepts. Mirrors
 * `merge-sanitize.ts`'s `NON_NEGATIVE_DECIMAL` deliberately: a value this rejects would be dropped one
 * layer later anyway, so rejecting it here keeps the emitted candidate honest about what will persist.
 * Scientific notation (`1e5`) is excluded — it round-trips through `Number` but is not a form the file
 * format uses, so it signals a corrupt field rather than a value.
 */
const NON_NEGATIVE_DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Raw bulk `nutrient.unit_name` tokens mapped to the unit the LIVE API reports for the same nutrient.
 *
 * This alignment is the whole point: `nutrient` is UNIQUE on `(name, unit)` and case-SENSITIVE, so if bulk
 * emitted `ug` while the API emits `µg`, "Vitamin D (D2 + D3)" would split into two dictionary rows and
 * defeat the `food_nutrients UNIQUE(food_id, nutrient_id)` golden-value invariant (DB-5).
 *
 * Only the four tokens whose API spelling is *verified* are mapped — they cover 464 of the 477 rows in
 * FDC's `nutrient.csv` (G 205, MG 186, UG 70, KCAL 3). The remaining 13 rows use rare tokens
 * (`IU`, `kJ`, `UMOL_TE`, `MCG_RE`, `MG_ATE`, `MG_GAE`, `PH`, `SP_GR`) whose API spelling is NOT
 * verified, so they fall through to {@link canonicalizeUnit} (plain lowercase) rather than being guessed
 * at. Residual risk if a guess were wrong is a duplicate dictionary row for a rare nutrient; guessing is
 * strictly worse than the honest lowercase default. Lookup is case-insensitive because `kJ` is the only
 * lowercase token in the file.
 */
const BULK_UNIT_TO_API_UNIT: Readonly<Record<string, string>> = {
    g: 'g',
    mg: 'mg',
    ug: 'µg',
    kcal: 'kcal',
};

/** The `measure_unit.csv` name FDC uses for "no household measure" — never a usable portion label. */
const UNDETERMINED_MEASURE_UNIT = 'undetermined';

/**
 * Canonicalize a raw bulk unit token to the unit the live API reports (see {@link BULK_UNIT_TO_API_UNIT}).
 * Pure.
 *
 * @param unitName - The raw `nutrient.unit_name` token (e.g. `G`, `UG`, `kJ`).
 * @returns The canonical unit for the `nutrient (name, unit)` dictionary key.
 */
export function canonicalizeBulkUnit(unitName: string): string {
    const lowered = canonicalizeUnit(unitName);

    return BULK_UNIT_TO_API_UNIT[lowered] ?? lowered;
}

/** The mapped content a bulk {@link bulkItemVersion} is derived from. */
export interface BulkVersionInput {
    /** The golden display name. */
    readonly name: string;
    /** The golden description. */
    readonly description: string | null;
    /** The mapped, already-validated nutrients. */
    readonly nutrients: readonly CanonicalNutrient[];
    /** The mapped, already-validated portions. */
    readonly portions: readonly CanonicalPortion[];
}

/**
 * Derive a bulk food's `item_version` from the CONTENT this importer would persist — the importer's
 * skip-unchanged key, and what makes a re-run over ~8k rows resumable rather than 8k no-op transactions.
 *
 * Deliberately NOT `food.publication_date`: SR Legacy's is a frozen `2019-04-01` on every row, so a
 * publication-date version could never distinguish "same file again" (skip) from "revised values in a
 * newer download" (re-merge). Deliberately derived from the MAPPED values rather than the raw CSV text so
 * it tracks what actually lands in the golden record — a change in a column we ignore is not a change.
 *
 * The serialization sorts, so a re-ordered CSV (FDC does not guarantee row order) never reads as an
 * upstream revision. Pure.
 *
 * @param input - The mapped name/description/nutrients/portions.
 * @returns A `bulk:`-prefixed hex SHA-256 digest.
 */
export function bulkItemVersion(input: BulkVersionInput): string {
    const nutrients = input.nutrients
        .map((entry) => `${entry.name}\u0000${entry.unit}\u0000${entry.amount}\u0000${entry.basis}`)
        .sort();
    const portions = input.portions.map((entry) => `${entry.label}\u0000${entry.gramWeight}`).sort();
    const payload = [input.name, input.description ?? '', ...nutrients, '\u0001', ...portions].join('\u0002');

    return `${BULK_ITEM_VERSION_PREFIX}${createHash('sha256').update(payload).digest('hex')}`;
}

/**
 * Map one bulk food bundle to a validated {@link CanonicalCandidate} ready for the merge/persist seam.
 *
 * Foundation and SR Legacy are lab-analyzed whole foods, so `kind` is always `generic` and the branded
 * scalars (`brandOwner`/`brandName`/`barcode`) are always `null` — the bulk Branded dataset is NOT seeded
 * (Stage 1 scope decision), so there is no branded shape to model here.
 *
 * @param bundle - The bulk food plus its nutrient/portion rows.
 * @param lookups - The `nutrient.csv` / `measure_unit.csv` reference tables.
 * @returns The canonical candidate, or `null` when the food has no usable name (dropped whole).
 */
export function mapBulkFoodToCanonical(bundle: BulkFoodBundle, lookups: BulkLookups): CanonicalCandidate | null {
    const name = bundle.description.trim();

    if (name.length === 0) {
        return null; // No usable name — the golden record would be unnameable and undedupable (FR-005).
    }

    const nutrients = mapBulkNutrients(bundle, lookups);
    const portions = mapBulkPortions(bundle, lookups);

    return {
        source: SOURCE,
        externalKey: bundle.fdcId,
        name,
        kind: 'generic',
        brandOwner: null,
        brandName: null,
        description: name,
        barcode: null,
        nutrients,
        portions,
        itemVersion: bulkItemVersion({ name, description: name, nutrients, portions }),
    };
}

/**
 * Map + validate + dedup a bundle's `food_nutrient.csv` rows into canonical per-100g values. A row whose
 * `nutrient_id` is absent from `nutrient.csv`, or whose `amount` is blank / non-decimal / out of range, is
 * DROPPED (the food survives). Repeated `(name, unit)` keys collapse first-wins, mirroring the adapter.
 *
 * @param bundle - The bulk food bundle.
 * @param lookups - The reference tables.
 * @returns The deduped canonical nutrients.
 */
function mapBulkNutrients(bundle: BulkFoodBundle, lookups: BulkLookups): CanonicalNutrient[] {
    const byKey = new Map<string, CanonicalNutrient>();

    for (const row of bundle.nutrients) {
        const definition = lookups.nutrientsById.get(row.nutrientId);

        if (definition === undefined) {
            continue; // FDC references nutrient ids that do not exist in nutrient.csv (e.g. 2066).
        }

        const amount = row.amount.trim();

        if (!isStorableAmount(amount)) {
            continue; // Blank / negative / non-numeric / over-range — dropped at the value grain.
        }

        const name = canonicalizeNutrientName(definition.name);
        const unit = canonicalizeBulkUnit(definition.unitName);

        if (name.length === 0 || unit.length === 0) {
            continue;
        }

        const key = `${name}\u0000${unit}`;

        if (!byKey.has(key)) {
            byKey.set(key, { code: null, name, unit, amount, basis: 'per_100g' });
        }
    }

    return [...byKey.values()];
}

/**
 * Map + validate a bundle's `food_portion.csv` rows into canonical portions. The label falls back
 * `modifier` → `portion_description` → the `measure_unit.csv` name (matching the API adapter's precedence
 * — SR Legacy usually carries the label in `modifier`, Foundation in `portion_description`). FDC's
 * `undetermined` measure unit is never used as a label, and a portion with no label or a non-positive /
 * out-of-range `gram_weight` is dropped (mirrors `CHECK (gram_weight > 0)`).
 *
 * The row's `amount` is deliberately NOT folded into the label: the live adapter's labels are the bare
 * modifier text, and a portion set for one food can mix bulk-sourced and API-sourced rows.
 *
 * @param bundle - The bulk food bundle.
 * @param lookups - The reference tables.
 * @returns The canonical portions.
 */
function mapBulkPortions(bundle: BulkFoodBundle, lookups: BulkLookups): CanonicalPortion[] {
    const portions: CanonicalPortion[] = [];

    for (const row of bundle.portions) {
        const measureUnit = lookups.measureUnitsById.get(row.measureUnitId)?.trim() ?? '';
        const measureUnitLabel = measureUnit.toLowerCase() === UNDETERMINED_MEASURE_UNIT ? '' : measureUnit;
        const label = (row.modifier.trim() || row.portionDescription.trim() || measureUnitLabel).trim();
        const gramWeight = row.gramWeight.trim();

        if (label.length === 0) {
            continue; // Unlabellable portion (orphan row, or `undetermined` with no free text).
        }

        if (!isStorableAmount(gramWeight) || Number(gramWeight) <= 0) {
            continue; // Mirrors CHECK (gram_weight > 0) — a 0/blank/negative weight is unusable.
        }

        portions.push({ label, gramWeight });
    }

    return portions;
}

/**
 * Whether a raw CSV amount is a storable non-negative decimal within the sanity bound. Pure.
 *
 * @param amount - The trimmed raw field.
 * @returns `true` when the value may be persisted as a `numeric`.
 */
function isStorableAmount(amount: string): boolean {
    return NON_NEGATIVE_DECIMAL.test(amount) && Number(amount) <= MAX_AMOUNT;
}
