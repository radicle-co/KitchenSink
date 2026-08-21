/**
 * `GoldenRecordMergeEngine` (T-160, MOD-017) — the pure, deterministic field-level cross-source merge.
 *
 * Rules (FR-MRG-2/FR-MRG-3): **presence beats absence**; identity/short fields (`name`, `kind`,
 * `brand_owner`, `brand_name`, `barcode`) → the **higher-priority source** wins (NOT the longest value);
 * free-text (`description`) → the **longer** value wins (ties → higher priority); a nutrient value is kept
 * on the basis the adapter emitted — `per_100g` where derivable, otherwise `per_serving` (the engine never
 * drops a `per_serving` value; D-PERSERVING). On a same-nutrient conflict a `per_100g` value beats a
 * `per_serving` one (the normalized basis wins the golden value); within one basis the higher-priority
 * source wins and its winning crosswalk is recorded; portions are unioned across contributors. The **auto-resolve boundary**
 * (FR-MRG-5, D-AUTORESOLVE) is the survivor count after normalized-name exact match: exactly 1 →
 * `RESOLVED`; >1 → `UNRESOLVED` (the surviving set is surfaced for human disambiguation); 0 → `NOT_FOUND`.
 * There is no nutrient-tolerance knob — the engine biases to `UNRESOLVED` over a wrong auto-pick.
 *
 * The engine is generic over the source-id type (`S extends string`, defaulting to {@link FoodSourceId})
 * so its priority rules are unit-testable with synthetic multi-source inputs even though the wired
 * `food_source` enum currently lists only `usda`. It is side-effect-free; persistence + provenance are
 * the caller's job (see `MergeAndPersistService`, T-161).
 *
 * @implements FR-MRG-1 FR-MRG-2 FR-MRG-3 FR-MRG-5 FR-RES-3
 */
import type {
    CanonicalCandidate,
    CanonicalNutrient,
    CanonicalNutrientBasis,
    FoodSourceId,
} from '../../sources/foodSourceAdapter.js';
import { SourceAdapterRegistry } from '../../sources/SourceAdapterRegistry.js';
import { normalizeName } from '../foodName.js';

/**
 * A merge input candidate, generic over the source-id type. Structurally a {@link CanonicalCandidate}
 * whose `source` is the type parameter `S` (defaulting to {@link FoodSourceId}).
 */
export type MergeCandidate<S extends string = FoodSourceId> = Omit<CanonicalCandidate, 'source'> & {
    readonly source: S;
};

/** The deterministic merge outcome (the survivor-count auto-resolve boundary, FR-MRG-5). */
export type MergeOutcome = 'RESOLVED' | 'UNRESOLVED' | 'NOT_FOUND';

/** A merged scalar field: the winning value plus the contributor `(source, externalKey)` that supplied it. */
export interface MergedScalar<S extends string = FoodSourceId> {
    /** The winning scalar value. */
    readonly value: string;
    /** The winning source. */
    readonly source: S;
    /** The winning contributor's opaque key (maps to the `food_sources` crosswalk row for provenance). */
    readonly externalKey: string;
}

/**
 * The merged curated-alias list plus the contributor that supplied it.
 *
 * ⛔ A LIST from ONE contributor, never a union across them. `food.aliases` is one column with one
 * `food_field_provenance` row, so exactly one source can own it: unioning two lists would assert a set no
 * source published and leave the provenance row naming only one of the two. Portions solve the same
 * problem the other way (their own table, per-row `source_id`) — aliases feed a generated tsvector on
 * `food`, so they must live on `food`.
 */
export interface MergedAliases<S extends string = FoodSourceId> {
    /** The winning contributor's alias values, in its own significance order. */
    readonly values: readonly string[];
    /** The winning source. */
    readonly source: S;
    /** The winning contributor's opaque key (maps to the `food_sources` crosswalk row for provenance). */
    readonly externalKey: string;
}

/** A merged, per-100g-normalized golden nutrient value tagged with its winning contributor. */
export interface MergedNutrient<S extends string = FoodSourceId> {
    /** Stable external code (INFOODS tagname) when known, else `null`. */
    readonly code: string | null;
    /** Canonical nutrient name (dictionary dedup half). */
    readonly name: string;
    /** Canonical unit (dictionary dedup half). */
    readonly unit: string;
    /** Arbitrary-precision amount as a string (no float drift, SC-008). */
    readonly amount: string;
    /** The basis the kept amount is on: `per_100g` where derivable, else `per_serving` (D-PERSERVING). */
    readonly basis: CanonicalNutrientBasis;
    /** The winning source. */
    readonly source: S;
    /** The winning contributor's opaque key. */
    readonly externalKey: string;
}

/** A merged portion (union grain) tagged with the contributor that supplied it. */
export interface MergedPortion<S extends string = FoodSourceId> {
    /** Household-measure label. */
    readonly label: string;
    /** Gram weight as an arbitrary-precision string (strictly positive). */
    readonly gramWeight: string;
    /** The contributing source. */
    readonly source: S;
    /** The contributing source's opaque key. */
    readonly externalKey: string;
}

/** A contributing source crosswalk entry the persistence layer upserts to back per-value provenance. */
export interface MergedContributingSource<S extends string = FoodSourceId> {
    /** The contributing source. */
    readonly source: S;
    /** That source's opaque key for the contributing item. */
    readonly externalKey: string;
    /** Per-item version/etag for change-driven refresh, else `null`. */
    readonly itemVersion: string | null;
}

/** The assembled golden record draft (the merge engine's output; persisted atomically by the caller). */
export interface GoldenRecordDraft<S extends string = FoodSourceId> {
    /** Golden display name (identity/short → higher-priority source). */
    readonly name: MergedScalar<S> | null;
    /** Golden free-text description (longer-wins). */
    readonly description: MergedScalar<S> | null;
    /** Generic/branded classification (identity → higher-priority source). */
    readonly kind: MergedScalar<S> | null;
    /** Brand owner (identity/short → higher-priority source). */
    readonly brandOwner: MergedScalar<S> | null;
    /** Brand name (identity/short → higher-priority source). */
    readonly brandName: MergedScalar<S> | null;
    /** Product barcode (identity → higher-priority source). */
    readonly barcode: MergedScalar<S> | null;
    /** Curated alternate names (richest list wins; ties → higher priority), or `null` when none. */
    readonly aliases: MergedAliases<S> | null;
    /** Per-100g golden nutrients (one winner per nutrient dedup key). */
    readonly nutrients: readonly MergedNutrient<S>[];
    /** Unioned portions across contributors. */
    readonly portions: readonly MergedPortion<S>[];
    /** Every contributing source crosswalk (each value's `source_id` resolves to one of these). */
    readonly contributingSources: readonly MergedContributingSource<S>[];
}

/** The deterministic merge result. `goldenRecord` is non-null only for `RESOLVED`; `candidateSet` only for `UNRESOLVED`. */
export interface MergeResult<S extends string = FoodSourceId> {
    /** The survivor-count outcome (FR-MRG-5). */
    readonly outcome: MergeOutcome;
    /** The assembled golden record (RESOLVED), else `null`. */
    readonly goldenRecord: GoldenRecordDraft<S> | null;
    /** The surviving candidate set surfaced for human disambiguation (UNRESOLVED), else `[]`. */
    readonly candidateSet: readonly MergeCandidate<S>[];
}

/** A non-empty string is "present" for the presence-beats-absence rule. */
function isPresent(value: string | null): value is string {
    return value !== null && value.trim() !== '';
}

/**
 * Whether an incoming nutrient value should replace the current winner for its dedup key (FR-MRG-3,
 * D-PERSERVING). Contributors are visited in priority order (highest first), so the first value seen for
 * a key is the highest-priority one. The only case where a later (lower-priority) value supersedes it is
 * a basis upgrade: a `per_100g` value beats an already-recorded `per_serving` value, because `per_100g`
 * is the normalized basis and wins the golden value on a same-nutrient conflict. A `per_serving` value is
 * never dropped — when it is the only basis available for a key it is kept as-is. Pure.
 *
 * @param incoming - The nutrient value under consideration.
 * @param current - The winner already recorded for the same dedup key, if any.
 * @returns `true` when `incoming` should become (or remain) the winner.
 */
function shouldReplaceNutrient<S extends string>(
    incoming: CanonicalNutrient,
    current: MergedNutrient<S> | undefined,
): boolean {
    if (current === undefined) {
        return true;
    }

    return current.basis === 'per_serving' && incoming.basis === 'per_100g';
}

/** The nutrient dedup key (DB-5): external code when present, else `name|unit`. */
function nutrientKey(nutrient: CanonicalNutrient): string {
    return nutrient.code ?? `${nutrient.name}|${nutrient.unit}`;
}

/**
 * Blend a survivor group's contributing candidates into a golden record draft (FR-MRG-2/FR-MRG-3).
 * Candidates are ranked by source priority (descending; ties keep input order via stable sort), so the
 * first ranked contributor with a value wins identity/short fields and nutrient conflicts.
 *
 * @param contributors - The contributing candidates (same normalized name, or an explicit human pick set).
 * @param priorityOf - Source-priority resolver (higher number = higher priority).
 * @returns The assembled golden record draft.
 */
export function blendCandidates<S extends string = FoodSourceId>(
    contributors: readonly MergeCandidate<S>[],
    priorityOf: (source: S) => number,
): GoldenRecordDraft<S> {
    const ranked = [...contributors].sort((left, right) => priorityOf(right.source) - priorityOf(left.source));

    // Identity/short fields: the highest-priority contributor with a present value wins (NOT the longest).
    const highestPriorityWith = (select: (candidate: MergeCandidate<S>) => string | null): MergedScalar<S> | null => {
        for (const candidate of ranked) {
            const value = select(candidate);

            if (isPresent(value)) {
                return { value, source: candidate.source, externalKey: candidate.externalKey };
            }
        }

        return null;
    };

    // Free-text fields: the LONGEST present value wins; ties keep the higher-priority contributor (ranked first).
    const longestWith = (select: (candidate: MergeCandidate<S>) => string | null): MergedScalar<S> | null => {
        let winner: MergedScalar<S> | null = null;

        for (const candidate of ranked) {
            const value = select(candidate);

            if (isPresent(value) && (winner === null || value.length > winner.value.length)) {
                winner = { value, source: candidate.source, externalKey: candidate.externalKey };
            }
        }

        return winner;
    };

    // Curated aliases: the RICHEST list wins, ties keeping the higher-priority contributor (`ranked` is
    // already priority-ordered, so `>` rather than `>=` preserves the tie). This mirrors `longestWith`'s
    // "richer free text wins" rule applied to a list, and for the same reason: a longer alias list is
    // strictly more retrieval signal, and there is no basis on which to prefer a shorter one.
    let aliases: MergedAliases<S> | null = null;

    for (const candidate of ranked) {
        if (candidate.aliases.length > 0 && (aliases === null || candidate.aliases.length > aliases.values.length)) {
            aliases = {
                values: candidate.aliases,
                source: candidate.source,
                externalKey: candidate.externalKey,
            };
        }
    }

    // Nutrients: keep each value on the basis the adapter emitted (per_100g where derivable, else
    // per_serving — never dropped). The highest-priority value wins per dedup key, except a per_100g
    // value upgrades over an already-recorded per_serving one (per_100g wins a basis conflict).
    const nutrientWinners = new Map<string, MergedNutrient<S>>();

    for (const candidate of ranked) {
        for (const nutrient of candidate.nutrients) {
            const key = nutrientKey(nutrient);

            if (shouldReplaceNutrient(nutrient, nutrientWinners.get(key))) {
                nutrientWinners.set(key, {
                    code: nutrient.code,
                    name: nutrient.name,
                    unit: nutrient.unit,
                    amount: nutrient.amount,
                    basis: nutrient.basis,
                    source: candidate.source,
                    externalKey: candidate.externalKey,
                });
            }
        }
    }

    // Portions: union across every contributor, each carrying its own provenance handle.
    const portions: MergedPortion<S>[] = contributors.flatMap((candidate) =>
        candidate.portions.map((portion) => ({
            label: portion.label,
            gramWeight: portion.gramWeight,
            source: candidate.source,
            externalKey: candidate.externalKey,
        })),
    );

    // Contributing crosswalks: distinct (source, externalKey) — every value's source_id resolves to one.
    const contributingSources: MergedContributingSource<S>[] = [];
    const seen = new Set<string>();

    for (const candidate of contributors) {
        const handle = `${candidate.source}::${candidate.externalKey}`;

        if (!seen.has(handle)) {
            seen.add(handle);
            contributingSources.push({
                source: candidate.source,
                externalKey: candidate.externalKey,
                itemVersion: candidate.itemVersion,
            });
        }
    }

    return {
        name: highestPriorityWith((candidate) => candidate.name),
        description: longestWith((candidate) => candidate.description),
        kind: highestPriorityWith((candidate) => candidate.kind),
        brandOwner: highestPriorityWith((candidate) => candidate.brandOwner),
        brandName: highestPriorityWith((candidate) => candidate.brandName),
        barcode: highestPriorityWith((candidate) => candidate.barcode),
        aliases,
        nutrients: [...nutrientWinners.values()],
        portions,
        contributingSources,
    };
}

/**
 * Change-refresh selective re-blend (T-171, FR-031/FR-032, DSN-4). Re-applies the field-level merge over
 * ONLY the re-pulled CHANGED source items, returning the blended draft of those items. The selective
 * nature ("a field moves only when its originating item changed") is enforced by the caller passing only
 * the items whose upstream `item_version` changed; this function therefore **always** yields a
 * `RESOLVED`-shaped draft — it never re-runs name disambiguation and so can never demote a food to
 * `UNRESOLVED`. Pure (no I/O); persistence + per-value provenance are the caller's job
 * (`MergeAndPersistService.mergeChangedSources`).
 *
 * @param changed - The re-fetched candidates whose backing item changed upstream.
 * @param priorityOf - Source-priority resolver (higher number = higher priority).
 * @returns The blended golden record draft for the changed items.
 */
export function mergeChanged<S extends string = FoodSourceId>(
    changed: readonly MergeCandidate<S>[],
    priorityOf: (source: S) => number,
): GoldenRecordDraft<S> {
    return blendCandidates(changed, priorityOf);
}

/**
 * Merge pre-fetched candidates into a golden record under the survivor-count auto-resolve boundary
 * (FR-MRG-5, D-AUTORESOLVE). After pre-merge dedup by normalized-name exact match: exactly 1 survivor →
 * `RESOLVED` (blend it); >1 → `UNRESOLVED` (surface the surviving set); 0 → `NOT_FOUND`.
 *
 * @param candidates - The (sanitized) candidates from the fan-out.
 * @param priorityOf - Source-priority resolver (higher number = higher priority).
 * @returns The deterministic merge result.
 */
export function mergeCandidates<S extends string = FoodSourceId>(
    candidates: readonly MergeCandidate<S>[],
    priorityOf: (source: S) => number,
): MergeResult<S> {
    if (candidates.length === 0) {
        return { outcome: 'NOT_FOUND', goldenRecord: null, candidateSet: [] };
    }

    const groups = new Map<string, MergeCandidate<S>[]>();

    for (const candidate of candidates) {
        const key = normalizeName(candidate.name);
        const group = groups.get(key);

        if (group) {
            group.push(candidate);
        } else {
            groups.set(key, [candidate]);
        }
    }

    if (groups.size > 1) {
        // >1 distinct survivor → bias to human disambiguation (no nutrient-tolerance auto-pick).
        return { outcome: 'UNRESOLVED', goldenRecord: null, candidateSet: [...candidates] };
    }

    const [survivor] = [...groups.values()];

    if (!survivor) {
        return { outcome: 'NOT_FOUND', goldenRecord: null, candidateSet: [] };
    }

    return { outcome: 'RESOLVED', goldenRecord: blendCandidates(survivor, priorityOf), candidateSet: [] };
}

/**
 * The production merge seam. Binds the field-level merge to a {@link SourceAdapterRegistry} for
 * source-priority resolution (FR-MRG-2/FR-MRG-4). Stateless; the Phase-5 worker and the Phase-4
 * `PATCH`-resolve both drive merges through this engine.
 */
export class GoldenRecordMergeEngine {
    public constructor(private readonly registry: SourceAdapterRegistry) {}

    /**
     * Merge fan-out candidates into a golden record under the survivor-count auto-resolve boundary.
     *
     * @param candidates - The sanitized canonical candidates.
     * @returns The deterministic merge result.
     */
    public merge(candidates: readonly CanonicalCandidate[]): MergeResult<FoodSourceId> {
        return mergeCandidates(candidates, (source) => this.registry.priorityOf(source));
    }

    /**
     * Blend an explicit, human-picked candidate set into a golden record (manual resolution, T-163) —
     * the survivor-count gate is bypassed because the human has already disambiguated.
     *
     * @param picks - The re-fetched picked candidates.
     * @returns The assembled golden record draft.
     */
    public blendPicks(picks: readonly CanonicalCandidate[]): GoldenRecordDraft<FoodSourceId> {
        return blendCandidates(picks, (source) => this.registry.priorityOf(source));
    }

    /**
     * Re-blend the re-pulled changed source items for the change-refresh branch (T-171). Returns the
     * draft of the changed items only — the caller applies it in place over the existing golden record
     * (updating just the changed items' values + `item_version`). Never re-runs disambiguation, so a
     * refresh can never demote a `RESOLVED` food (DSN-4/FR-031).
     *
     * @param changed - The re-fetched candidates whose backing item changed upstream.
     * @returns The blended golden record draft for the changed items.
     */
    public mergeChanged(changed: readonly CanonicalCandidate[]): GoldenRecordDraft<FoodSourceId> {
        return mergeChanged(changed, (source) => this.registry.priorityOf(source));
    }
}
