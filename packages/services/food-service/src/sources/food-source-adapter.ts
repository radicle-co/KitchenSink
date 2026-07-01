/**
 * `FoodSourceAdapter` — the pluggable source-adapter boundary (MOD-015 / ARCH-013, plan §5).
 *
 * A food source (USDA today, additive later) implements {@link FoodSourceAdapter}; the fan-out worker
 * (Phase 3) iterates the {@link SourceAdapterRegistry} to search every wired source by name and fetch
 * the canonical, source-agnostic candidates it returns. **No source-specific structure leaks past this
 * boundary** (FR-ADP-1): the canonical candidate types carry an internal `source` + that source's
 * opaque `externalKey` — NEVER a source-native key such as USDA's `fdcId` (FR-IDN-2). The only place a
 * native key is named is inside the USDA adapter, which maps `fdcId → externalKey` inbound.
 *
 * @implements FR-ADP-1 FR-MRG-2 FR-MRG-4
 */
import { foodSourceEnum } from '../db/schema/index.js';

/**
 * A wired source identifier — the `food_source` enum domain (`'usda'` today; additive). Derived from
 * the canonical schema enum so the adapter layer and the database can never drift.
 */
export type FoodSourceId = (typeof foodSourceEnum.enumValues)[number];

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
 * `fdcId → externalKey` mapping (the only place a native key is named).
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
 * Static source-priority order — higher index closer to the front = higher priority. `usda` is the
 * default highest until an explicit ranking is configured. Additive: a new source appends a value
 * (FR-MRG-2/FR-MRG-4) and never touches the canonical schema.
 */
export const SOURCE_PRIORITY: readonly FoodSourceId[] = ['usda'];

// ── Adapter-boundary errors ──────────────────────────────────────────────────────────────────────

/**
 * Thrown when a source's API call fails in a transport/HTTP sense (the source-agnostic classification
 * of an upstream error). `statusCode` lets the worker decide window-full backoff (429) vs retry (5xx)
 * vs no-contribution (404) without knowing the source. Carries no upstream payload.
 */
export class SourceApiError extends Error {
    /** The source whose call failed. */
    public readonly source: FoodSourceId;
    /** The classified status code (HTTP status, or `0` for a timeout/transport failure). */
    public readonly statusCode: number;

    /**
     * @param source - The failing source.
     * @param statusCode - The classified status code (`0` = timeout/transport).
     * @param message - A sanitized, source-agnostic message (never an upstream body).
     */
    public constructor(source: FoodSourceId, statusCode: number, message: string) {
        super(message);
        this.name = 'SourceApiError';
        this.source = source;
        this.statusCode = statusCode;
        Object.setPrototypeOf(this, SourceApiError.prototype);
    }
}

/** Type guard for {@link SourceApiError}. */
export function isSourceApiError(error: unknown): error is SourceApiError {
    return error instanceof SourceApiError;
}

/**
 * Thrown when a mapped value fails the adapter's validation/sanitization (type/range/length/text):
 * reject-not-store (FR-ADP-2/FR-ADP-3). The candidate is rejected as a whole and never enters the
 * store; the worker drops it (the food may still resolve from other valid candidates).
 */
export class AdapterValidationError extends Error {
    /** The source whose candidate failed validation. */
    public readonly source: FoodSourceId;
    /** The opaque key of the rejected item. */
    public readonly externalKey: string;
    /** The field that failed validation (e.g. `nutrient.amount`, `portion.gramWeight`). */
    public readonly field: string;

    /**
     * @param source - The source.
     * @param externalKey - The rejected item's opaque key.
     * @param field - The offending field.
     * @param message - A sanitized reason.
     */
    public constructor(source: FoodSourceId, externalKey: string, field: string, message: string) {
        super(message);
        this.name = 'AdapterValidationError';
        this.source = source;
        this.externalKey = externalKey;
        this.field = field;
        Object.setPrototypeOf(this, AdapterValidationError.prototype);
    }
}

/** Type guard for {@link AdapterValidationError}. */
export function isAdapterValidationError(error: unknown): error is AdapterValidationError {
    return error instanceof AdapterValidationError;
}

/** Thrown when an adapter is registered for a `source` that already has one (boot misconfiguration). */
export class DuplicateSourceError extends Error {
    /** The duplicated source. */
    public readonly source: FoodSourceId;

    /** @param source - The duplicated source. */
    public constructor(source: FoodSourceId) {
        super(`A source adapter is already registered for '${source}'`);
        this.name = 'DuplicateSourceError';
        this.source = source;
        Object.setPrototypeOf(this, DuplicateSourceError.prototype);
    }
}

/** Type guard for {@link DuplicateSourceError}. */
export function isDuplicateSourceError(error: unknown): error is DuplicateSourceError {
    return error instanceof DuplicateSourceError;
}

/** Thrown when a source is referenced that is not part of {@link SOURCE_PRIORITY} or not registered. */
export class UnknownSourceError extends Error {
    /** The unknown source. */
    public readonly source: string;

    /** @param source - The unknown source. */
    public constructor(source: string) {
        super(`Unknown source '${source}'`);
        this.name = 'UnknownSourceError';
        this.source = source;
        Object.setPrototypeOf(this, UnknownSourceError.prototype);
    }
}

/** Type guard for {@link UnknownSourceError}. */
export function isUnknownSourceError(error: unknown): error is UnknownSourceError {
    return error instanceof UnknownSourceError;
}

/**
 * In-process registry of wired source adapters plus the static source-priority order the merge engine
 * consults (MOD-015). Populated once at bootstrap and read-only thereafter. Adding a source is
 * additive — implement {@link FoodSourceAdapter}, append the `food_source` enum value, and call
 * {@link SourceAdapterRegistry.register} once (FR-MRG-4/FR-ADP-1).
 */
export class SourceAdapterRegistry {
    private readonly adaptersBySource = new Map<FoodSourceId, FoodSourceAdapter>();

    /**
     * Register an adapter for its source.
     *
     * @param adapter - The adapter to wire.
     * @throws {DuplicateSourceError} when a source already has a registered adapter.
     * @sideEffect Mutates the in-process registry map.
     */
    public register(adapter: FoodSourceAdapter): void {
        if (this.adaptersBySource.has(adapter.source)) {
            throw new DuplicateSourceError(adapter.source);
        }

        this.adaptersBySource.set(adapter.source, adapter);
    }

    /**
     * Whether a source has a registered adapter.
     *
     * @param source - The source.
     * @returns `true` when an adapter is registered for `source`.
     */
    public has(source: FoodSourceId): boolean {
        return this.adaptersBySource.has(source);
    }

    /**
     * Resolve the adapter for a source.
     *
     * @param source - The source.
     * @returns The registered adapter.
     * @throws {UnknownSourceError} when no adapter is registered for `source`.
     */
    public adapterFor(source: FoodSourceId): FoodSourceAdapter {
        const adapter = this.adaptersBySource.get(source);

        if (adapter === undefined) {
            throw new UnknownSourceError(source);
        }

        return adapter;
    }

    /**
     * All wired adapters, in priority order (highest priority first).
     *
     * @returns The registered adapters ordered by {@link SOURCE_PRIORITY}.
     */
    public adapters(): FoodSourceAdapter[] {
        return SOURCE_PRIORITY.filter((source) => this.adaptersBySource.has(source)).map((source) =>
            this.adapterFor(source),
        );
    }

    /**
     * The priority of a source (higher number = higher priority). Consulted by the merge engine for
     * higher-priority-source-wins scalar/nutrient conflicts (FR-MRG-2). `usda` (index 0) ranks highest.
     *
     * @param source - The source.
     * @returns The source's priority (≥ 1).
     * @throws {UnknownSourceError} when the source is not in {@link SOURCE_PRIORITY}.
     */
    public priorityOf(source: FoodSourceId): number {
        const index = SOURCE_PRIORITY.indexOf(source);

        if (index < 0) {
            throw new UnknownSourceError(source);
        }

        return SOURCE_PRIORITY.length - index;
    }
}
