/**
 * Programmable stub {@link FoodSourceAdapter} for the food-service e2e suite (T-190).
 *
 * The e2e mocks `../../src/sources/usda/usda.adapter.js` so the real `FoodsModule` factory registers
 * THIS class in place of `UsdaSourceAdapter` (its `source` is `'usda'`, the only wired enum value, so
 * `SOURCE_PRIORITY` resolves it and the merge engine's `priorityOf('usda')` works). No real USDA
 * network call ever happens — every search/fetch is served from per-test programmed behaviour.
 *
 * Behaviour is driven through the module-level {@link stub} controller: a test programs, per normalized
 * food name, whether a fan-out yields one candidate (→ RESOLVED), several distinct-named candidates
 * (→ UNRESOLVED), zero hits (→ NOT_FOUND), or a transport error (→ the FAILED retry path). Call counts
 * are tracked so the search-never-calls-a-source invariant can be asserted.
 */
import {
    SourceApiError,
    type CanonicalCandidate,
    type CanonicalNutrient,
    type CanonicalPortion,
    type FoodSourceAdapter,
    type FoodSourceId,
    type SourceCandidate,
} from '../../src/sources/food-source-adapter.js';
import { normalizeName } from '../../src/foods/merge/merge-engine.js';

/** Overridable canonical-record fields a test can set on a programmed candidate. */
export interface StubCandidateParts {
    /** That source's opaque key (defaults to a slug of the name). */
    readonly externalKey?: string;
    /** Display + golden name. */
    readonly name: string;
    /** Per-100g nutrients (defaults to a single `Protein 2.8 g`). */
    readonly nutrients?: readonly CanonicalNutrient[];
    /** Portions (defaults to a single `1 cup` / 91 g). */
    readonly portions?: readonly CanonicalPortion[];
    /** Product barcode (defaults to `null`). */
    readonly barcode?: string | null;
    /** Free-text description (defaults to `null`). */
    readonly description?: string | null;
    /** Per-item version/etag/hash for change-driven refresh (FR-032); defaults to `null`. */
    readonly itemVersion?: string | null;
}

/** One programmed source candidate (search hit + the canonical record `fetchByKey` returns for it). */
interface ProgrammedCandidate {
    readonly externalKey: string;
    readonly name: string;
    readonly canonical: CanonicalCandidate;
}

/** Per-normalized-name programmed behaviour. */
interface NameScenario {
    /** The candidates a `searchByName` returns for this name (empty → NOT_FOUND). */
    readonly candidates: ProgrammedCandidate[];
    /** When set, `searchByName` throws a {@link SourceApiError} with this status (the FAILED path). */
    readonly errorStatus?: number;
}

/** Default nutrient set for a programmed candidate (per-100g, storable). */
const DEFAULT_NUTRIENTS: readonly CanonicalNutrient[] = [
    { code: null, name: 'Protein', unit: 'g', amount: '2.8', basis: 'per_100g' },
];

/** Default portion set for a programmed candidate. */
const DEFAULT_PORTIONS: readonly CanonicalPortion[] = [{ label: '1 cup', gramWeight: '91' }];

/** Slugify a name into a deterministic default external key. Pure. */
function slugKey(name: string): string {
    return `ek-${normalizeName(name).replace(/[^a-z0-9]+/g, '-')}`;
}

/** Build a full canonical candidate from the test's parts (filling source-agnostic defaults). Pure. */
function toCanonical(parts: StubCandidateParts): CanonicalCandidate {
    return {
        source: 'usda',
        externalKey: parts.externalKey ?? slugKey(parts.name),
        name: parts.name,
        kind: 'generic',
        brandOwner: null,
        brandName: null,
        description: parts.description ?? null,
        barcode: parts.barcode ?? null,
        nutrients: parts.nutrients ?? DEFAULT_NUTRIENTS,
        portions: parts.portions ?? DEFAULT_PORTIONS,
        itemVersion: parts.itemVersion ?? null,
    };
}

/**
 * The module-level programmable controller the e2e drives. Holds per-name scenarios, a key→canonical
 * map (so a `PATCH`-resolve re-fetch by `externalKey` succeeds), and per-method call counters.
 */
class StubController {
    private scenarios = new Map<string, NameScenario>();
    private canonicalByKey = new Map<string, CanonicalCandidate>();
    /** Per-method invocation counters (the search-never-calls-a-source invariant reads these). */
    public calls = { searchByName: 0, fetchByKey: 0, fetchByKeys: 0 };

    /** Reset all programmed behaviour and counters (called in `beforeEach`). */
    public reset(): void {
        this.scenarios = new Map();
        this.canonicalByKey = new Map();
        this.calls = { searchByName: 0, fetchByKey: 0, fetchByKeys: 0 };
    }

    /**
     * Program a name to resolve to a single candidate (→ RESOLVED).
     *
     * @param name - The add-by-name value.
     * @param parts - Optional canonical overrides (external key, barcode, nutrients…).
     * @returns The candidate's `externalKey` (for crosswalk / PATCH assertions).
     */
    public programResolve(name: string, parts: Partial<StubCandidateParts> = {}): string {
        const candidate = this.makeCandidate({ name, ...parts });
        this.scenarios.set(normalizeName(name), { candidates: [candidate] });

        return candidate.externalKey;
    }

    /**
     * Program a name to fan out to several distinct-named candidates (→ UNRESOLVED).
     *
     * @param name - The add-by-name value.
     * @param variants - The distinct candidate variants surfaced for disambiguation.
     * @returns The variants' external keys, in order.
     */
    public programUnresolved(name: string, variants: readonly StubCandidateParts[]): string[] {
        const candidates = variants.map((variant) => this.makeCandidate(variant));
        this.scenarios.set(normalizeName(name), { candidates });

        return candidates.map((candidate) => candidate.externalKey);
    }

    /**
     * Program a name to return zero hits (→ NOT_FOUND).
     *
     * @param name - The add-by-name value.
     */
    public programNotFound(name: string): void {
        this.scenarios.set(normalizeName(name), { candidates: [] });
    }

    /**
     * Program a name whose search throws a transport error (→ the FAILED retry path).
     *
     * @param name - The add-by-name value.
     * @param errorStatus - The classified status code (default 503 — a real failure).
     */
    public programSearchError(name: string, errorStatus = 503): void {
        this.scenarios.set(normalizeName(name), { candidates: [], errorStatus });
    }

    /**
     * Simulate an UPSTREAM change to an already-programmed source item: replace the canonical record a
     * later `fetchByKey(externalKey)` returns (the change-refresh re-fetch path, FR-032). Only the
     * provided parts change; a new `itemVersion` is how the worker detects the change.
     *
     * @param externalKey - The programmed item's opaque key.
     * @param parts - The fields to change upstream (e.g. a new `itemVersion` + nutrients/description).
     * @throws {Error} when no item was programmed for the key.
     */
    public mutateItem(externalKey: string, parts: Partial<StubCandidateParts>): void {
        const existing = this.canonicalByKey.get(externalKey);

        if (!existing) {
            throw new Error(`stub: cannot mutate unknown item '${externalKey}'`);
        }

        this.canonicalByKey.set(externalKey, {
            ...existing,
            ...(parts.name !== undefined ? { name: parts.name } : {}),
            ...(parts.description !== undefined ? { description: parts.description } : {}),
            ...(parts.barcode !== undefined ? { barcode: parts.barcode } : {}),
            ...(parts.nutrients !== undefined ? { nutrients: parts.nutrients } : {}),
            ...(parts.portions !== undefined ? { portions: parts.portions } : {}),
            ...(parts.itemVersion !== undefined ? { itemVersion: parts.itemVersion } : {}),
        });
    }

    /** Look up the scenario for a (already-normalized) query. */
    public scenarioFor(name: string): NameScenario | undefined {
        return this.scenarios.get(normalizeName(name));
    }

    /** Look up the canonical record for an external key (PATCH-resolve re-fetch). */
    public canonicalFor(externalKey: string): CanonicalCandidate | undefined {
        return this.canonicalByKey.get(externalKey);
    }

    /** Build + register a programmed candidate and its key→canonical mapping. */
    private makeCandidate(parts: StubCandidateParts): ProgrammedCandidate {
        const canonical = toCanonical(parts);
        this.canonicalByKey.set(canonical.externalKey, canonical);

        return { externalKey: canonical.externalKey, name: canonical.name, canonical };
    }
}

/** The shared controller instance the e2e programs per scenario. */
export const stub = new StubController();

/**
 * The stub adapter substituted for `UsdaSourceAdapter`. Constructed by the `FoodsModule` factory with a
 * (real, unused) USDA client argument it ignores; all behaviour is served from {@link stub}.
 */
export class StubSourceAdapter implements FoodSourceAdapter {
    public readonly source: FoodSourceId = 'usda';

    /** Accepts (and ignores) the `UsdaApiClient` the production factory passes — no network is used. */
    public constructor(_client?: unknown) {}

    /**
     * Search by name from the programmed scenario; throws a {@link SourceApiError} when one is armed.
     *
     * @param name - The (normalized) fan-out query.
     * @returns The programmed source candidates (empty when none/NOT_FOUND).
     * @throws {SourceApiError} when a search error is programmed for the name.
     * @sideEffect Increments the search call counter.
     */
    public async searchByName(name: string): Promise<SourceCandidate[]> {
        stub.calls.searchByName += 1;
        const scenario = stub.scenarioFor(name);

        if (scenario?.errorStatus !== undefined) {
            throw new SourceApiError('usda', scenario.errorStatus, 'stub: programmed source error');
        }

        return (scenario?.candidates ?? []).map((candidate) => ({
            source: 'usda',
            externalKey: candidate.externalKey,
            name: candidate.name,
        }));
    }

    /**
     * Fetch a single candidate by its opaque key (PATCH-resolve re-fetch path).
     *
     * @param externalKey - The programmed candidate key.
     * @returns The canonical candidate.
     * @throws {SourceApiError} (404) when no candidate is programmed for the key.
     * @sideEffect Increments the fetch call counter.
     */
    public async fetchByKey(externalKey: string): Promise<CanonicalCandidate> {
        stub.calls.fetchByKey += 1;
        const canonical = stub.canonicalFor(externalKey);

        if (!canonical) {
            throw new SourceApiError('usda', 404, 'stub: no candidate for key');
        }

        return canonical;
    }

    /**
     * Batch-fetch candidates by key (the worker's preferred ≤20-key path); unknown keys are skipped.
     *
     * @param externalKeys - The programmed candidate keys.
     * @returns The canonical candidates present for the keys.
     * @sideEffect Increments the batch-fetch call counter.
     */
    public async fetchByKeys(externalKeys: readonly string[]): Promise<CanonicalCandidate[]> {
        stub.calls.fetchByKeys += 1;

        return externalKeys
            .map((key) => stub.canonicalFor(key))
            .filter((candidate): candidate is CanonicalCandidate => candidate !== undefined);
    }
}
