/**
 * `UsdaSourceAdapter` (T-121 / MOD-008, ARCH-008) — wraps `@kitchensink/usda-client` to implement the
 * {@link FoodSourceAdapter} boundary. **This is the ONLY place `fdcId` and USDA-native terms appear**
 * (FR-IDN-2): `mapToCanonical` maps `fdcId → externalKey` inbound, and nothing past this boundary sees a
 * source-native key. The adapter validates/sanitizes every mapped value (type/range/length/text) before
 * it can enter the store — a response failing validation is rejected, not stored (FR-ADP-2/FR-ADP-3) —
 * and classifies upstream transport errors into the source-agnostic {@link SourceApiError}.
 *
 * **Nutrient name normalization (DB-5).** USDA varies nutrient name casing across datasets
 * (`Protein` vs `protein`). The committed `nutrient (name, unit)` UNIQUE is case-SENSITIVE, so without
 * normalization those variants would split into duplicate dictionary rows and defeat the
 * `food_nutrients UNIQUE(food_id, nutrient_id)` golden-value invariant. This adapter is the single
 * boundary where the fix lives: {@link canonicalizeNutrientName}/{@link canonicalizeUnit} fold each
 * `(name, unit)` to a deterministic canonical form, then `mapNutrients` dedups on that key so case
 * variants collapse to one canonical nutrient before any value leaves the adapter.
 *
 * **Per-serving label panel (D-PERSERVING).** USDA Branded foods report their Nutrition-Facts panel as
 * a per-serving `labelNutrients` map (with `servingSize`/`servingSizeUnit`), while Foundation/SR Legacy
 * and the Branded `foodNutrients` array are per-100g. This adapter is the only place the bases are
 * reconciled: per-100g `foodNutrients` are preferred (no conversion); a `labelNutrients` value is
 * converted to per-100g ONLY when `servingSizeUnit` is grams (`amount_per_100g = value * 100 / grams`,
 * `basis=per_100g`); when the serving is NOT grams (ml, or a count) the value is kept on `basis=per_serving`
 * rather than dropped (no `ml = g` assumption). A label key a `foodNutrients` value already filled is
 * skipped so the panel is never double-counted. `labelNutrients`/`servingSize`/`servingSizeUnit` are read
 * from the preserved `raw` payload (the typed `UsdaFoodDetail` does not surface them — same as portions).
 *
 * @implements FR-IDN-2 FR-023 FR-024 FR-ADP-2 FR-ADP-3 FR-MRG-3
 */
import { createHash } from 'node:crypto';

import type { UsdaApiClient, UsdaFoodDetail, UsdaNutrient } from '@kitchensink/usda-client';
import {
    isUsdaNotFoundError,
    isUsdaRateLimitError,
    isUsdaSchemaError,
    isUsdaServerError,
    isUsdaTimeoutError,
} from '@kitchensink/usda-client';
import { z } from 'zod';

import { lookupLabelNutrient } from '../../foods/nutrition/labelNutrientMap.js';
import { AdapterValidationError, SourceApiError } from '../foodSource.errors.js';
import {
    type CanonicalCandidate,
    type CanonicalKind,
    type CanonicalNutrient,
    type CanonicalPortion,
    type FoodSourceAdapter,
    type SourceCandidate,
} from '../foodSourceAdapter.js';

/** The canonical source identifier for this adapter. */
const SOURCE = 'usda' as const;

/** USDA's batch endpoint cap (`POST /api/v1/foods`, ≤20 keys/call counting as 1 windowed call, FR-023). */
export const USDA_BATCH_MAX = 20;

/** Maximum accepted nutrient/scalar name length (sanitization bound). */
const NAME_MAX_LENGTH = 256;

/** Maximum accepted unit length. */
const UNIT_MAX_LENGTH = 32;

/** Maximum accepted portion label length. */
const LABEL_MAX_LENGTH = 256;

/** Upper sanity bound for a per-100g amount / gram weight (rejects a parse/sign blow-up). */
const MAX_AMOUNT = 10_000_000;

/**
 * Raw USDA portion shape read from the client's preserved `raw` payload. The typed `UsdaFoodDetail`
 * does not surface `foodPortions`, so the adapter validates them here at the boundary.
 */
const RawUsdaPortionSchema = z
    .object({
        gramWeight: z.number().optional(),
        amount: z.number().optional(),
        modifier: z.string().optional(),
        portionDescription: z.string().optional(),
        measureUnit: z.object({ name: z.string().optional() }).passthrough().optional(),
    })
    .passthrough();

/** The `foodPortions` array as it appears in the raw USDA payload. */
const RawUsdaPortionArraySchema = z.array(RawUsdaPortionSchema);

/**
 * The Nutrition-Facts panel of a Branded food as it appears in the raw USDA payload: a map of label
 * keys (`protein`, `fat`, `calories`, …) to a PER-SERVING `{ value }`. The typed `UsdaFoodDetail` does
 * not surface it, so (like portions) the adapter reads + validates it from the preserved `raw` payload.
 */
const RawUsdaLabelNutrientsSchema = z.record(z.string(), z.object({ value: z.number().optional() }).passthrough());

/**
 * Maps each known USDA `labelNutrients` key to the canonical `(name, unit)` it folds into. The names +
 * units mirror the FDC `foodNutrients` display names so a label value dedups against an equivalent
 * per-100g value (the "prefer foodNutrients, do not double-count the label" rule). USDA label units are
 * fixed per key (grams for macros, mg for the listed minerals, kcal for calories), so the panel carries
 * no per-entry unit. Keys absent from this map are skipped — without a known unit they cannot be stored.
 */

/** Decimal places kept when converting a per-serving label value to per-100g (strips float drift). */
const CONVERSION_PRECISION = 6;

/**
 * Fold a nutrient name to a deterministic canonical form (DB-5): trim, collapse internal whitespace,
 * then sentence-case (first char upper, rest lower) so `Protein`/`protein`/`PROTEIN` all become
 * `Protein`. Pure.
 *
 * @param name - The raw source nutrient name.
 * @returns The canonical name.
 */
export function canonicalizeNutrientName(name: string): string {
    const collapsed = name.trim().replace(/\s+/g, ' ').toLowerCase();

    if (collapsed.length === 0) {
        return collapsed;
    }

    return collapsed.charAt(0).toUpperCase() + collapsed.slice(1);
}

/**
 * Fold a unit to a deterministic canonical form: trim + lowercase (`G`→`g`, `KCAL`→`kcal`). Pure.
 *
 * @param unit - The raw source unit.
 * @returns The canonical unit.
 */
export function canonicalizeUnit(unit: string): string {
    return unit.trim().toLowerCase();
}

/**
 * Convert a per-serving label amount to a per-100g amount: `value * 100 / servingSizeGrams`, formatted
 * as a fixed-precision decimal string (no scientific notation, no binary float drift — `2.82 * 100 / 30`
 * yields `'9.4'`, not `'9.399999999999999'`). The result is a clean decimal matching the storable
 * `amount` domain (SC-008). Pure.
 *
 * @param value - The per-serving label amount.
 * @param servingSizeGrams - The serving size in grams (strictly positive).
 * @returns The per-100g amount as a decimal string.
 */
export function convertPerServingToPer100g(value: number, servingSizeGrams: number): string {
    const per100g = (value * 100) / servingSizeGrams;

    return String(Number(per100g.toFixed(CONVERSION_PRECISION)));
}

export class UsdaSourceAdapter implements FoodSourceAdapter {
    /** The source this adapter wraps. */
    public readonly source = SOURCE;

    /** @param client - The typed USDA FoodData Central client (the only `fdcId` boundary). */
    public constructor(private readonly client: UsdaApiClient) {}

    /**
     * Search USDA by name and surface candidates with `externalKey` (mapped from `fdcId`).
     *
     * @param name - The add-by-name query.
     * @returns The USDA candidate hits.
     * @throws {SourceApiError} when the upstream call fails (classified by status).
     * @sideEffect Performs an HTTPS request to USDA via the client.
     */
    public async searchByName(name: string): Promise<SourceCandidate[]> {
        let result;

        try {
            result = await this.client.searchFoods(name);
        } catch (error) {
            throw this.classifyError(error);
        }

        // `fdcId` is named ONLY here; it becomes `externalKey` for everything downstream.
        return result.foods.map((hit) => ({
            source: SOURCE,
            externalKey: String(hit.fdcId),
            name: hit.description,
        }));
    }

    /**
     * Fetch one USDA item by its `externalKey`, map it to a validated canonical candidate.
     *
     * @param externalKey - The USDA item key (the inbound `fdcId` as a string).
     * @returns The validated canonical candidate.
     * @throws {AdapterValidationError} when `externalKey` is not a positive integer, or a mapped value
     *   fails validation (reject-not-store).
     * @throws {SourceApiError} when the upstream call fails (classified by status).
     * @sideEffect Performs an HTTPS request to USDA via the client.
     */
    public async fetchByKey(externalKey: string): Promise<CanonicalCandidate> {
        const fdcId = Number(externalKey);

        if (!Number.isInteger(fdcId) || fdcId <= 0) {
            throw new AdapterValidationError(
                SOURCE,
                externalKey,
                'externalKey',
                `USDA external key must be a positive integer, got '${externalKey}'`,
            );
        }

        let detail: UsdaFoodDetail;

        try {
            detail = await this.client.getFood(fdcId);
        } catch (error) {
            throw this.classifyError(error);
        }

        return this.mapToCanonical(detail);
    }

    /**
     * Batch-fetch up to {@link USDA_BATCH_MAX} USDA items in ONE windowed source call (FR-023/T-155),
     * mapping + validating each. The fan-out worker uses this to pull a drain's resolved keys as a
     * single call rather than one `fetchByKey` per key (the ≤20-key cap is the caller's to chunk; the
     * USDA client itself rejects an over-cap batch). The `fdcId → externalKey` mapping stays internal.
     *
     * @param externalKeys - The USDA item keys (inbound `fdcId`s as strings; ≤20).
     * @returns The validated canonical candidates.
     * @throws {AdapterValidationError} when a key is not a positive integer, or a mapped value fails
     *   validation (reject-not-store — aborts the batch; the worker may retry the chunk per key).
     * @throws {SourceApiError} when the upstream call fails (classified by status).
     * @sideEffect Performs one HTTPS batch request to USDA via the client.
     */
    public async fetchByKeys(externalKeys: readonly string[]): Promise<CanonicalCandidate[]> {
        const fdcIds = externalKeys.map((externalKey) => {
            const fdcId = Number(externalKey);

            if (!Number.isInteger(fdcId) || fdcId <= 0) {
                throw new AdapterValidationError(
                    SOURCE,
                    externalKey,
                    'externalKey',
                    `USDA external key must be a positive integer, got '${externalKey}'`,
                );
            }

            return fdcId;
        });

        let details: UsdaFoodDetail[];

        try {
            details = await this.client.getFoodsBatch(fdcIds);
        } catch (error) {
            throw this.classifyError(error);
        }

        return details.map((detail) => this.mapToCanonical(detail));
    }

    /**
     * Map a typed USDA food detail to a source-agnostic {@link CanonicalCandidate}. The `fdcId →
     * externalKey` mapping happens here; the result carries no source-native key. Throws
     * {@link AdapterValidationError} when any mapped value fails validation (reject-not-store).
     *
     * @param detail - The typed USDA detail.
     * @returns The validated canonical candidate.
     */
    private mapToCanonical(detail: UsdaFoodDetail): CanonicalCandidate {
        const externalKey = String(detail.fdcId);
        const kind: CanonicalKind = detail.dataType === 'Branded' ? 'branded' : 'generic';

        return {
            source: SOURCE,
            externalKey,
            name: detail.description,
            kind,
            brandOwner: detail.brandOwner ?? null,
            brandName: detail.brandName ?? null,
            description: detail.description,
            barcode: detail.gtinUpc ?? null,
            // The client has already selected the `Additional Description` attributes and ranked them;
            // value-grain hygiene and the storable bounds are `foodAliases.ts`'s, applied at the merge
            // boundary alongside the nutrient/portion filters. An unusable synonym must never cost a food
            // its lab-analyzed nutrition, so nothing here throws over one.
            aliases: detail.additionalDescriptions,
            nutrients: this.mapNutrients(detail.foodNutrients, detail.raw, externalKey),
            portions: this.mapPortions(detail.raw, externalKey),
            itemVersion: detail.publicationDate ?? hashItem(detail.raw),
        };
    }

    /**
     * Map + validate + dedup USDA nutrients into canonical per-100g values. Entries USDA omits a value
     * for are skipped (absent, not malformed); a present-but-invalid value (negative / non-finite /
     * over-range) or an over-length name/unit rejects the whole candidate (reject-not-store). Case
     * variants of `(name, unit)` collapse to one canonical row (DB-5).
     *
     * Two inputs feed one deduped set: the per-100g `foodNutrients` (preferred) and, for Branded foods,
     * the per-serving `labelNutrients` panel read from the raw payload (D-PERSERVING); a label entry
     * whose canonical key a `foodNutrients` value already filled is skipped so it is never double-counted.
     *
     * @param nutrients - The typed USDA per-100g nutrients.
     * @param raw - The verbatim USDA payload (carries `labelNutrients`/`servingSize`/`servingSizeUnit`).
     * @param externalKey - The item key (for error context).
     * @returns The deduped canonical nutrients.
     */
    private mapNutrients(
        nutrients: readonly UsdaNutrient[],
        raw: Record<string, unknown>,
        externalKey: string,
    ): CanonicalNutrient[] {
        const byKey = new Map<string, CanonicalNutrient>();

        for (const entry of nutrients) {
            if (entry.value === undefined) {
                continue; // USDA omitted the measurement — absent, not malformed.
            }

            this.assertAmountInRange(entry.value, entry.nutrientName, externalKey);

            const name = this.assertNutrientName(canonicalizeNutrientName(entry.nutrientName), externalKey);
            const unit = this.assertNutrientUnit(canonicalizeUnit(entry.unitName), externalKey);
            const key = `${name} ${unit}`;

            if (!byKey.has(key)) {
                byKey.set(key, { code: null, name, unit, amount: String(entry.value), basis: 'per_100g' });
            }
        }

        // Per-serving label panel (Branded): converted to per-100g for a gram serving, else kept as-is.
        this.addLabelNutrients(byKey, raw, externalKey);

        return [...byKey.values()];
    }

    /**
     * Fold a Branded food's per-serving `labelNutrients` panel into the deduped nutrient map
     * (D-PERSERVING). For a gram serving the value is converted to per-100g (`value * 100 / grams`,
     * `basis=per_100g`); for a non-gram serving (ml, or a count like `2 cookies`) the value is KEPT
     * as-is with `basis=per_serving` — never dropped, never assumed to be grams. A label key already
     * filled by a `foodNutrients` value is skipped (prefer the per-100g value, do not double-count).
     * A present-but-invalid label value rejects the whole candidate (reject-not-store).
     *
     * @param byKey - The deduped nutrient map to fold into.
     * @param raw - The verbatim USDA payload.
     * @param externalKey - The item key (for error context).
     * @sideEffect Mutates the supplied `byKey` map.
     */
    private addLabelNutrients(
        byKey: Map<string, CanonicalNutrient>,
        raw: Record<string, unknown>,
        externalKey: string,
    ): void {
        const parsed = RawUsdaLabelNutrientsSchema.safeParse(raw['labelNutrients']);

        if (!parsed.success) {
            return; // No (or malformed) label panel — nothing to fold in.
        }

        const servingSize = typeof raw['servingSize'] === 'number' ? raw['servingSize'] : undefined;
        const servingUnit = typeof raw['servingSizeUnit'] === 'string' ? canonicalizeUnit(raw['servingSizeUnit']) : '';
        const isGramServing =
            (servingUnit === 'g' || servingUnit === 'grm') &&
            servingSize !== undefined &&
            Number.isFinite(servingSize) &&
            servingSize > 0;

        for (const [labelKey, entry] of Object.entries(parsed.data)) {
            const mapping = lookupLabelNutrient(labelKey);

            if (mapping === undefined || entry.value === undefined) {
                continue; // Unmapped label key (unknown unit) or absent value — skip.
            }

            this.assertAmountInRange(entry.value, labelKey, externalKey);

            const name = this.assertNutrientName(canonicalizeNutrientName(mapping.name), externalKey);
            const unit = this.assertNutrientUnit(canonicalizeUnit(mapping.unit), externalKey);
            const key = `${name} ${unit}`;

            if (byKey.has(key)) {
                continue; // A foodNutrients per-100g value already filled this — never double-count.
            }

            if (isGramServing) {
                const amount = convertPerServingToPer100g(entry.value, servingSize);

                this.assertAmountInRange(Number(amount), labelKey, externalKey);
                byKey.set(key, { code: null, name, unit, amount, basis: 'per_100g' });
            } else {
                byKey.set(key, { code: null, name, unit, amount: String(entry.value), basis: 'per_serving' });
            }
        }
    }

    /**
     * Assert a nutrient amount is finite, non-negative, and within the sanity bound (reject-not-store).
     *
     * @param value - The raw amount.
     * @param label - The nutrient name/key (for error context).
     * @param externalKey - The item key (for error context).
     * @throws {AdapterValidationError} when the amount is out of range.
     */
    private assertAmountInRange(value: number, label: string, externalKey: string): void {
        if (!Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) {
            throw new AdapterValidationError(
                SOURCE,
                externalKey,
                'nutrient.amount',
                `Nutrient '${label}' has an out-of-range amount`,
            );
        }
    }

    /**
     * Assert a canonical nutrient name is present and within the length bound; returns it for chaining.
     *
     * @param name - The canonicalized nutrient name.
     * @param externalKey - The item key (for error context).
     * @returns The validated name.
     * @throws {AdapterValidationError} when the name is empty or over-length.
     */
    private assertNutrientName(name: string, externalKey: string): string {
        if (name.length === 0 || name.length > NAME_MAX_LENGTH) {
            throw new AdapterValidationError(SOURCE, externalKey, 'nutrient.name', 'Nutrient name invalid/over-length');
        }

        return name;
    }

    /**
     * Assert a canonical unit is present and within the length bound; returns it for chaining.
     *
     * @param unit - The canonicalized unit.
     * @param externalKey - The item key (for error context).
     * @returns The validated unit.
     * @throws {AdapterValidationError} when the unit is empty or over-length.
     */
    private assertNutrientUnit(unit: string, externalKey: string): string {
        if (unit.length === 0 || unit.length > UNIT_MAX_LENGTH) {
            throw new AdapterValidationError(SOURCE, externalKey, 'nutrient.unit', 'Nutrient unit invalid/over-length');
        }

        return unit;
    }

    /**
     * Map + validate USDA portions (read from the preserved raw payload — the typed detail does not
     * surface them). A portion missing a gram weight or a label is skipped (incomplete); a present
     * gram weight that is non-positive / non-finite / over-range rejects the candidate (reject-not-store).
     *
     * @param raw - The verbatim USDA payload.
     * @param externalKey - The item key (for error context).
     * @returns The canonical portions.
     */
    private mapPortions(raw: Record<string, unknown>, externalKey: string): CanonicalPortion[] {
        const parsed = RawUsdaPortionArraySchema.safeParse(raw['foodPortions']);

        if (!parsed.success) {
            return [];
        }

        const portions: CanonicalPortion[] = [];

        for (const entry of parsed.data) {
            const label = (entry.modifier ?? entry.portionDescription ?? entry.measureUnit?.name ?? '').trim();

            if (entry.gramWeight === undefined || label.length === 0) {
                continue; // Incomplete portion — cannot label or weight it; skip.
            }

            if (!Number.isFinite(entry.gramWeight) || entry.gramWeight <= 0 || entry.gramWeight > MAX_AMOUNT) {
                throw new AdapterValidationError(
                    SOURCE,
                    externalKey,
                    'portion.gramWeight',
                    'Portion gram weight must be strictly positive and in range',
                );
            }

            if (label.length > LABEL_MAX_LENGTH) {
                throw new AdapterValidationError(SOURCE, externalKey, 'portion.label', 'Portion label over-length');
            }

            portions.push({ label, gramWeight: String(entry.gramWeight) });
        }

        return portions;
    }

    /**
     * Classify a USDA client error into a source-agnostic {@link SourceApiError} (no upstream body
     * leaks). Unknown non-client errors are returned as-is. Pure (constructs, never throws).
     *
     * @param error - The thrown value.
     * @returns The error to throw.
     */
    private classifyError(error: unknown): Error {
        if (isUsdaNotFoundError(error)) {
            return new SourceApiError(SOURCE, 404, 'Item not found in USDA');
        }

        if (isUsdaRateLimitError(error)) {
            return new SourceApiError(SOURCE, 429, 'USDA rate limit exceeded');
        }

        if (isUsdaServerError(error)) {
            return new SourceApiError(SOURCE, error.status, 'USDA server error');
        }

        if (isUsdaTimeoutError(error)) {
            return new SourceApiError(SOURCE, 0, 'USDA request timed out');
        }

        if (isUsdaSchemaError(error)) {
            // A 2xx whose body drifted from the modelled shape. Use 422 (not 502) so the consumer can tell
            // persistent schema corruption (a genuine per-food failure) apart from a transient gateway 502
            // under load (backpressure) — the two must NOT share a status code.
            return new SourceApiError(SOURCE, 422, 'USDA response failed schema validation');
        }

        return error instanceof Error ? error : new Error('Unknown USDA adapter error');
    }
}

/**
 * Stable content hash of a raw payload, used as `itemVersion` when USDA omits a publication date
 * (change-driven refresh, FR-032). Pure.
 *
 * @param raw - The verbatim payload.
 * @returns A hex SHA-256 digest.
 */
function hashItem(raw: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(raw)).digest('hex');
}
