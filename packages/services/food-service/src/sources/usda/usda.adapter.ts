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
 * @implements FR-IDN-2 FR-023 FR-024 FR-ADP-2 FR-ADP-3
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

import {
    AdapterValidationError,
    SourceApiError,
    type CanonicalCandidate,
    type CanonicalKind,
    type CanonicalNutrient,
    type CanonicalPortion,
    type FoodSourceAdapter,
    type SourceCandidate,
} from '../food-source-adapter.js';

/** The canonical source identifier for this adapter. */
const SOURCE = 'usda' as const;

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
            nutrients: this.mapNutrients(detail.foodNutrients, externalKey),
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
     * @param nutrients - The typed USDA nutrients.
     * @param externalKey - The item key (for error context).
     * @returns The deduped canonical nutrients.
     */
    private mapNutrients(nutrients: readonly UsdaNutrient[], externalKey: string): CanonicalNutrient[] {
        const byKey = new Map<string, CanonicalNutrient>();

        for (const entry of nutrients) {
            if (entry.value === undefined) {
                continue; // USDA omitted the measurement — absent, not malformed.
            }

            if (!Number.isFinite(entry.value) || entry.value < 0 || entry.value > MAX_AMOUNT) {
                throw new AdapterValidationError(
                    SOURCE,
                    externalKey,
                    'nutrient.amount',
                    `Nutrient '${entry.nutrientName}' has an out-of-range amount`,
                );
            }

            const name = canonicalizeNutrientName(entry.nutrientName);
            const unit = canonicalizeUnit(entry.unitName);

            if (name.length === 0 || name.length > NAME_MAX_LENGTH) {
                throw new AdapterValidationError(
                    SOURCE,
                    externalKey,
                    'nutrient.name',
                    'Nutrient name invalid/over-length',
                );
            }

            if (unit.length === 0 || unit.length > UNIT_MAX_LENGTH) {
                throw new AdapterValidationError(
                    SOURCE,
                    externalKey,
                    'nutrient.unit',
                    'Nutrient unit invalid/over-length',
                );
            }

            const key = `${name} ${unit}`;

            if (!byKey.has(key)) {
                byKey.set(key, { code: null, name, unit, amount: String(entry.value), basis: 'per_100g' });
            }
        }

        return [...byKey.values()];
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
            // 2xx whose body drifted from the modelled shape — treat as an upstream (bad-gateway) failure.
            return new SourceApiError(SOURCE, 502, 'USDA response failed schema validation');
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
