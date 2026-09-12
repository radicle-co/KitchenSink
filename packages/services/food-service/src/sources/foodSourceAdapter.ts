/**
 * `FoodSourceAdapter` — the pluggable source-adapter boundary (MOD-015 / ARCH-013, plan §5).
 *
 * A food source (USDA today, additive later) implements {@link FoodSourceAdapter}; the fan-out worker
 * (Phase 3) iterates the `SourceAdapterRegistry` to search every wired source by name and fetch
 * the canonical, source-agnostic candidates it returns. **No source-specific structure leaks past this
 * boundary** (FR-ADP-1): the canonical candidate types carry an internal `source` + that source's
 * opaque `externalKey` — NEVER a source-native key such as USDA's `fdcId` (FR-IDN-2). A native key is named
 * only at the USDA boundary: the USDA adapter and `@kitchensink/usda-client`'s `usdaSearchCandidate`, which map
 * `fdcId → externalKey` inbound.
 *
 * @implements FR-ADP-1 FR-MRG-2 FR-MRG-4
 */
import type { LineageKey } from '@kitchensink/usda-client';

import { CITATION_DATASETS, DATASET_SOURCE, type CitationDataset } from '../foods/seed/citationDatasets.js';
import type { RegisteredSourceId } from './sourceRegister.js';

/**
 * The wired sources: those the live path calls through an adapter. Only USDA can (curated catalog plan U26, R57);
 * every other registered source reaches the catalog through the seed's committed extracts. A subset of the
 * `food_source` enum, which holds every registered id (0018).
 */
export const WIRED_SOURCE_IDS = ['usda'] as const satisfies readonly RegisteredSourceId[];

/** A wired source identifier. */
export type FoodSourceId = (typeof WIRED_SOURCE_IDS)[number];

/**
 * Whether a stored source id is wired, so the live path can call it. Pure.
 *
 * @param source - A `food_source` value.
 * @returns `true` for a wired source.
 */
export function isWiredSourceId(source: RegisteredSourceId): source is FoodSourceId {
    return WIRED_SOURCE_IDS.some((wired) => wired === source);
}

/** Generic vs branded classification (FR-IDN-3) — the canonical replacement for a source data-type. */
export type CanonicalKind = 'generic' | 'branded';

/** The amount basis a nutrient value is expressed on (normalized to `per_100g` before any blend). */
export type CanonicalNutrientBasis = 'per_100g' | 'per_serving';

/**
 * A normalized, source-agnostic nutrient value. `name`/`unit` are the canonical (case-normalized)
 * dedup key into the `nutrient` dictionary (DB-5); `amount` is arbitrary-precision `numeric` carried as
 * a string for full source fidelity (SC-008); `code` is a stable external anchor (INFOODS tagname) when
 * the source supplies one, else `null`.
 */
export interface CanonicalNutrient {
    /** Stable external code (e.g. an INFOODS tagname) when known, else `null`. */
    readonly code: string | null;
    /** Canonical (case-normalized) nutrient display name — half of the `(name, unit)` dedup key. */
    readonly name: string;
    /** Canonical (case-normalized) unit — the other half of the dedup key. */
    readonly unit: string;
    /** Arbitrary-precision amount as a string (no float drift, SC-008). */
    readonly amount: string;
    /** The basis the amount is on. */
    readonly basis: CanonicalNutrientBasis;
}

/** A normalized, source-agnostic household-measure / serving-size portion. */
export interface CanonicalPortion {
    /** Human-readable label (e.g. `1 cup, chopped`). */
    readonly label: string;
    /** Gram weight as an arbitrary-precision string (strictly positive). */
    readonly gramWeight: string;
}

/**
 * A search candidate from one source — that source's opaque key plus a display name. Carries
 * `externalKey`, NEVER a source-native key past this boundary (FR-IDN-2).
 */
export interface SourceCandidate {
    /** The source that produced the candidate. */
    readonly source: FoodSourceId;
    /** That source's opaque primary key for the item (USDA: mapped from `fdcId` inside the adapter). */
    readonly externalKey: string;
    /** The candidate's display name. */
    readonly name: string;
    /**
     * The source's link between versions of this food, when it publishes one: USDA's Foundation NDB number
     * (`@kitchensink/usda-client`'s `lineageKey.ts`). The owner reader matches it when the key itself is one the
     * catalog does not hold. Required, so every adapter states whether it has one.
     */
    readonly lineageKey: LineageKey | null;
}

/**
 * A fully-fetched, validated, source-agnostic candidate ready for the golden-record merge (MOD-017).
 * The shape carries `externalKey` and NEVER a source-native identifier — a type-level guarantee the
 * merge engine and persistence never see `fdcId`.
 */
export interface CanonicalCandidate {
    /** The source that produced the candidate. */
    readonly source: FoodSourceId;
    /** That source's opaque primary key (USDA: mapped from `fdcId`). */
    readonly externalKey: string;
    /**
     * The register dataset the item belongs to (KTD-22), which a live food's citation records (plan U4). USDA's
     * three datasets rank apart, so the source alone does not say it.
     */
    readonly dataset: CitationDataset;
    /** Golden display name. */
    readonly name: string;
    /** Canonical kind (`generic` | `branded`). */
    readonly kind: CanonicalKind;
    /** Brand owner when present, else `null`. */
    readonly brandOwner: string | null;
    /** Brand name when present, else `null`. */
    readonly brandName: string | null;
    /** Free-text description when present, else `null`. */
    readonly description: string | null;
    /** Product barcode (GTIN/UPC) when present, else `null`. */
    readonly barcode: string | null;
    /**
     * The source's curated ALTERNATE NAMES for this food — brands, regional synonyms and alternate forms
     * — in the source's own significance order, or `[]` when it publishes none (plan U2/KTD-2, R11).
     *
     * Total rather than optional on purpose: this field is the one the system was silently DROPPING, so
     * every adapter (and every fixture) is made to state what it has. `[]` is "this source publishes
     * none", which the write boundary turns into a NULL column rather than an `''` sentinel.
     *
     * Source-agnostic, like every other field here: USDA's `foodAttributes` / `additionalDescriptions`
     * naming does not cross this boundary (FR-ADP-1).
     */
    readonly aliases: readonly string[];
    /** Normalized per-value nutrients (per-100g). */
    readonly nutrients: readonly CanonicalNutrient[];
    /** Normalized portions. */
    readonly portions: readonly CanonicalPortion[];
    /** Per-item version/etag/hash for change-driven refresh (FR-032), else `null`. */
    readonly itemVersion: string | null;
}

/**
 * The pluggable food-source contract. No source-specific structure crosses this interface (FR-ADP-1).
 * `mapToCanonical` is an implementation detail internal to `fetchByKey`; for USDA it performs the
 * `fdcId → externalKey` mapping for a fetched item.
 */
export interface FoodSourceAdapter {
    /** The source this adapter wraps. */
    readonly source: FoodSourceId;
    /**
     * Search the source by free-text name.
     *
     * @param name - The add-by-name query.
     * @returns The source's candidate hits (source + opaque key + name).
     */
    searchByName(name: string): Promise<SourceCandidate[]>;
    /**
     * Fetch a single item by its opaque source key, map it to a canonical candidate, and
     * validate/sanitize it (reject-not-store).
     *
     * @param externalKey - The source's opaque key for the item.
     * @returns The validated canonical candidate.
     */
    fetchByKey(externalKey: string): Promise<CanonicalCandidate>;
    /**
     * OPTIONAL batch fetch (FR-023/T-155): fetch several items by their opaque keys in one source
     * round trip, mapping + validating each (reject-not-store). A source whose API supports a batch
     * endpoint (USDA's `POST /v1/foods`, ≤20 keys/call) implements this so the fan-out worker can pull
     * a drain's resolved keys as a single windowed call; sources without one omit it and the worker
     * falls back to {@link fetchByKey} per key. An adapter-internal optimization invisible to the
     * canonical API.
     *
     * @param externalKeys - The source's opaque keys for the items (caller chunks to the source's cap).
     * @returns The validated canonical candidates (order not guaranteed).
     */
    fetchByKeys?(externalKeys: readonly string[]): Promise<CanonicalCandidate[]>;
}

/**
 * Rank sources by the first dataset each owns in a precedence-ordered dataset list. Pure.
 *
 * @param datasets - Datasets, highest precedence first.
 * @param sourceOf - The source each dataset belongs to.
 * @param ranked - The sources to rank; any other source is left out.
 * @returns The ranked sources, each once, highest first.
 */
export function sourcePriorityFrom<Dataset extends string, Source extends string>(
    datasets: readonly Dataset[],
    sourceOf: Readonly<Record<Dataset, string>>,
    ranked: readonly Source[],
): Source[] {
    const order: Source[] = [];

    for (const dataset of datasets) {
        const source = ranked.find((candidate) => candidate === sourceOf[dataset]);

        if (source !== undefined && !order.includes(source)) {
            order.push(source);
        }
    }

    return order;
}

/**
 * Source priority, front = highest: each wired source ranked by its first dataset in R50's precedence
 * (`CITATION_DATASETS`, read through `DATASET_SOURCE`), so the order is derived from the one precedence list
 * rather than kept beside it (ADR-0053 §8). Additive: wiring a source places it, and never touches the schema.
 */
export const SOURCE_PRIORITY: readonly FoodSourceId[] = sourcePriorityFrom(
    CITATION_DATASETS,
    DATASET_SOURCE,
    WIRED_SOURCE_IDS,
);
