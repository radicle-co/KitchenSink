/**
 * `BulkSeedService` — the bulk-seed orchestrator (ingredient-search plan §2 Stage 1, resolutions F-W2 /
 * F-C2). It consumes a stream of {@link CanonicalCandidate}s from a bulk source (today the USDA
 * Foundation + SR Legacy download, via `sources/usda/bulk`) and lands each one as a **RESOLVED golden
 * record** marked `origin='bulk'`.
 *
 * ── PATTERNS ────────────────────────────────────────────────────────────────────────────────────────
 * - **Ports & Adapters.** It depends on three narrow structural ports ({@link SeedFoodStore},
 *   {@link SeedCrosswalkStore}, {@link SeedPersister}) that `FoodDao` / `FoodSourcesDao` /
 *   `MergeAndPersistService` satisfy with no adapter code. The ports also *document the blast radius*:
 *   this importer writes nothing the merge/persist seam does not already own.
 * - **Strategy dispatch over the lifecycle state.** Which persist primitive runs is a total function of
 *   the food's current `status`, resolved by an exhaustive switch — see {@link BulkSeedService.persist}.
 * - **Source-agnostic by construction.** It never names `fdcId`, USDA, or CSV: `candidate.source` carries
 *   the source and `candidate.externalKey` the opaque key (FR-IDN-2/FR-ADP-1), so a future bulk source
 *   reuses this class unchanged.
 *
 * ── WHY THE FIND-OR-CREATE IS LOAD-BEARING (F-W2) ───────────────────────────────────────────────────
 * Idempotency comes from `findByExternalKey` → REUSE the existing `food_id`, **not** from the crosswalk's
 * `UNIQUE(source, external_key)`. A blind "create a new food, then upsert the crosswalk" would hit that
 * unique index and `onConflictDoUpdate` — which does NOT update `food_id` — leaving the crosswalk row
 * pointing at the OLD food while the nutrient/portion values are written against the NEW one, tripping the
 * composite same-food provenance FK (`food_nutrients_provenance_same_food_fk`, D-PROVENANCE-FK).
 *
 * ── WHY DISPATCH ON STATUS INSTEAD OF ALWAYS CALLING `resolveAndPersist` ─────────────────────────────
 * `persistResolved` ends with `setStatus('RESOLVED')`, and `RESOLVED → RESOLVED` is NOT in `FoodDao`'s
 * legal-transition set — so re-seeding an already-RESOLVED food through `resolveAndPersist` would throw
 * `IllegalStatusTransitionError` AND append duplicate portions (that path inserts portions without first
 * deleting them). `mergeChangedSources` is the correct primitive for a food already RESOLVED: it stays
 * RESOLVED, advances the crosswalk's `item_version`, and REPLACES each contributing source's portions.
 *
 * ── WHY `origin` IS STAMPED BEFORE THE FOOD IS RESOLVED (F-C2) ──────────────────────────────────────
 * The live change-refresh scan selects `RESOLVED` foods with `origin <> 'bulk'`. Marking the food `bulk`
 * while it is still PENDING means it is never, at any instant, visible to that scan as refreshable — which
 * matters because a bulk row's content-derived `item_version` can never equal an API version, so an
 * unexcluded bulk food would be re-enqueued on every sweep and have its lab-analyzed nutrition clobbered
 * with API values.
 *
 * @implements FR-005 FR-028 FR-029 FR-031 FR-032 FR-IDN-1 FR-IDN-2
 */
import type { CanonicalCandidate } from '../../sources/foodSourceAdapter.js';
import type { FoodRow, FoodSourceRow } from '../../db/schema/index.js';
import type { CreateByNameInput, CreateByNameResult, MarkOriginInput, SetStatusInput } from '../dao/food.dao.js';
import type { FoodSource } from '../dao/foodSources.dao.js';
import type {
    MergeChangedSourcesInput,
    ResolveAndPersistInput,
    ResolveFromPicksInput,
} from '../merge/mergeAndPersist.service.js';
import type { PersistResult } from '../merge/mergeAndPersist.service.js';
import { normalizeName } from '../merge/mergeEngine.js';
import { ConsoleWorkerLogger, type WorkerLogger } from '../../worker/workerLogger.js';
import { BulkSeedAbortedError } from './bulkSeed.errors.js';

/** The `food` reads/writes the importer needs — satisfied structurally by `FoodDao`. */
export interface SeedFoodStore {
    /** Fetch the raw `food` row by internal id. */
    getById(id: string): Promise<FoodRow | undefined>;
    /** Find-or-create by normalized name (the dedup + reactivation path). */
    createByName(input: CreateByNameInput): Promise<CreateByNameResult>;
    /** Apply a guarded legal status transition. */
    setStatus(input: SetStatusInput): Promise<FoodRow>;
    /** Classify the record's data provenance (`live` | `bulk`). */
    markOrigin(input: MarkOriginInput): Promise<void>;
}

/** The crosswalk read the importer needs — satisfied structurally by `FoodSourcesDao`. */
export interface SeedCrosswalkStore {
    /** Resolve a `(source, external_key)` to its full crosswalk row. */
    findByExternalKey(source: FoodSource, externalKey: string): Promise<FoodSourceRow | undefined>;
}

/** The merge/persist primitives the importer dispatches to — satisfied by `MergeAndPersistService`. */
export interface SeedPersister {
    /** Merge + persist under the survivor-count boundary (a single candidate ⇒ RESOLVED). */
    resolveAndPersist(input: ResolveAndPersistInput): Promise<PersistResult>;
    /** Blend chosen candidates straight to RESOLVED and clear the candidate set. */
    resolveFromPicks(input: ResolveFromPicksInput): Promise<PersistResult>;
    /** Re-pull changed backing items in place; the food stays RESOLVED. */
    mergeChangedSources(input: MergeChangedSourcesInput): Promise<PersistResult>;
}

/** The outcome of a bulk-seed run. Every consumed candidate lands in exactly one of the four buckets. */
export interface BulkSeedResult {
    /** Candidates consumed from the stream. */
    readonly total: number;
    /** Foods brought to RESOLVED from a non-RESOLVED state (fresh, reactivated, or disambiguated). */
    readonly seeded: number;
    /** Already-RESOLVED foods whose bulk values were re-merged in place (a newer bulk revision). */
    readonly refreshed: number;
    /** Already-RESOLVED bulk foods skipped because their `item_version` was unchanged. */
    readonly unchanged: number;
    /** Candidates whose persist threw; logged and skipped (a re-run retries them). */
    readonly failed: number;
}

/** Constructor dependencies for {@link BulkSeedService}. */
export interface BulkSeedDeps {
    /** The `food` store. */
    readonly foods: SeedFoodStore;
    /** The crosswalk store. */
    readonly sources: SeedCrosswalkStore;
    /** The merge/persist seam. */
    readonly persist: SeedPersister;
    /** Optional structured logger (defaults to a JSON console logger tagged `food-bulk-seed`). */
    readonly logger?: WorkerLogger;
    /** Emit a progress record every N candidates (default {@link DEFAULT_PROGRESS_EVERY}). */
    readonly progressEvery?: number;
    /** Consecutive-failure cap before aborting (default {@link DEFAULT_MAX_CONSECUTIVE_FAILURES}). */
    readonly maxConsecutiveFailures?: number;
}

/** Default progress cadence — frequent enough to watch an ~8k-row import, quiet enough for CloudWatch. */
const DEFAULT_PROGRESS_EVERY = 250;

/**
 * Default consecutive-failure cap. Isolated failures are tolerated (a re-run retries them); a run of
 * consecutive failures means the environment is broken, and grinding through thousands of rows to report
 * that is worse than failing fast.
 */
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 25;

/** A mutable tally the per-candidate handler folds its outcome into. */
interface Tally {
    total: number;
    seeded: number;
    refreshed: number;
    unchanged: number;
    failed: number;
}

export class BulkSeedService {
    private readonly foods: SeedFoodStore;
    private readonly sources: SeedCrosswalkStore;
    private readonly persister: SeedPersister;
    private readonly logger: WorkerLogger;
    private readonly progressEvery: number;
    private readonly maxConsecutiveFailures: number;

    /** @param deps - The injected stores, persist seam, logger, and run bounds. */
    public constructor(deps: BulkSeedDeps) {
        this.foods = deps.foods;
        this.sources = deps.sources;
        this.persister = deps.persist;
        this.logger = deps.logger ?? new ConsoleWorkerLogger('food-bulk-seed');
        this.progressEvery = deps.progressEvery ?? DEFAULT_PROGRESS_EVERY;
        this.maxConsecutiveFailures = deps.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
    }

    /**
     * Seed (or re-seed) every candidate in the stream, logging periodic progress and a final count.
     *
     * Resumable and idempotent: an unchanged, already-RESOLVED bulk food is skipped without a write, so
     * re-running after a crash costs one crosswalk read + one food read per already-done row rather than a
     * full re-persist. Candidates are processed SEQUENTIALLY on purpose — each one runs a transaction that
     * takes the per-name advisory lock and touches the shared `nutrient` dictionary, so concurrency would
     * buy contention and lock-order risk, not throughput.
     *
     * @param candidates - The bulk candidate stream (e.g. `streamBulkCandidates`).
     * @returns The run tally.
     * @throws {BulkSeedAbortedError} when consecutive failures hit the cap (systemic breakage).
     * @sideEffect Creates/updates `food`, `food_sources`, `nutrient`, `food_nutrients`, `food_portions`,
     *   and `food_field_provenance`.
     */
    public async seed(candidates: AsyncIterable<CanonicalCandidate>): Promise<BulkSeedResult> {
        const tally: Tally = { total: 0, seeded: 0, refreshed: 0, unchanged: 0, failed: 0 };
        let consecutiveFailures = 0;

        for await (const candidate of candidates) {
            tally.total += 1;

            try {
                await this.seedOne(candidate, tally);
                consecutiveFailures = 0;
            } catch (error) {
                tally.failed += 1;
                consecutiveFailures += 1;
                this.logger.error('bulk-seed-food-failed', {
                    source: candidate.source,
                    externalKey: candidate.externalKey,
                    error: error instanceof Error ? error.message : 'unknown error',
                });

                if (consecutiveFailures >= this.maxConsecutiveFailures) {
                    this.logger.error('bulk-seed-aborted', { ...tally, consecutiveFailures });

                    throw new BulkSeedAbortedError(consecutiveFailures, tally.total, error);
                }
            }

            if (tally.total % this.progressEvery === 0) {
                this.logger.info('bulk-seed-progress', { ...tally });
            }
        }

        this.logger.info('bulk-seed-complete', { ...tally });

        return { ...tally };
    }

    /**
     * Seed one candidate: find-or-create its food, classify it `bulk`, then persist through the primitive
     * its current lifecycle status allows.
     *
     * @param candidate - The bulk candidate.
     * @param tally - The run tally to fold the outcome into.
     * @sideEffect Reads and writes the food aggregate.
     */
    private async seedOne(candidate: CanonicalCandidate, tally: Tally): Promise<void> {
        const crosswalk = await this.sources.findByExternalKey(candidate.source, candidate.externalKey);
        const foodId = crosswalk?.foodId ?? (await this.createFood(candidate));
        const row = await this.foods.getById(foodId);

        if (!row) {
            // The row we just found-or-created is gone: a concurrent delete (erasure/cleanup). Treat as a
            // per-row failure so the run continues and a re-run re-creates it.
            throw new Error(`food '${foodId}' disappeared while seeding`);
        }

        if (this.isUnchanged(candidate, crosswalk, row)) {
            tally.unchanged += 1;

            return;
        }

        // BEFORE any status change: a bulk food must never be visible to the live refresh scan (F-C2).
        await this.foods.markOrigin({ id: foodId, origin: 'bulk' });

        const outcome = await this.persist(foodId, row.status, candidate);

        if (outcome === 'refreshed') {
            tally.refreshed += 1;
        } else {
            tally.seeded += 1;
        }
    }

    /**
     * Create (or dedup onto) the food row for a candidate, keyed by its NORMALIZED name — the same dedup
     * key the add-by-name path uses (FR-005), so a bulk food and a user-added food of the same name are
     * one record. This also covers the case two different external keys normalize to the same name: the
     * second collapses onto the first's row instead of raising `23505` on `food.normalized_name`.
     *
     * @param candidate - The bulk candidate.
     * @returns The internal food id.
     * @sideEffect Inserts or updates `food`.
     */
    private async createFood(candidate: CanonicalCandidate): Promise<string> {
        const created = await this.foods.createByName({
            normalizedName: normalizeName(candidate.name),
            displayName: candidate.name,
        });

        return created.id;
    }

    /**
     * Whether this candidate is already fully persisted and needs no write — the resumability fast path.
     *
     * ALL of the following must hold, and each condition is load-bearing:
     *  - the crosswalk already exists AND records a non-null `item_version` (a null means the food was
     *    never persisted with a version, so we cannot prove it is current);
     *  - the recorded version equals the incoming one (same bulk content);
     *  - the food is already `RESOLVED` (a PENDING/UNRESOLVED row still needs its golden values); and
     *  - the food is already `origin='bulk'` — a `live` food MUST be re-classified even when the version
     *    matches, or it stays in the change-refresh scan and gets clobbered (F-C2).
     *
     * @param candidate - The incoming candidate.
     * @param crosswalk - The existing crosswalk row, if any.
     * @param row - The current `food` row.
     * @returns `true` when nothing needs to be written.
     */
    private isUnchanged(candidate: CanonicalCandidate, crosswalk: FoodSourceRow | undefined, row: FoodRow): boolean {
        return (
            crosswalk !== undefined &&
            crosswalk.itemVersion !== null &&
            crosswalk.itemVersion === candidate.itemVersion &&
            row.status === 'RESOLVED' &&
            row.origin === 'bulk'
        );
    }

    /**
     * Persist the candidate through the primitive the food's CURRENT status permits (Strategy dispatch —
     * exhaustive over `FoodStatus`, so a future lifecycle state fails to compile rather than silently
     * falling through to the wrong primitive):
     *
     *  - `PENDING` → `resolveAndPersist` (single candidate ⇒ single survivor ⇒ RESOLVED);
     *  - `UNRESOLVED` → `resolveFromPicks`, the only primitive that persists RESOLVED **and clears the
     *    now-obsolete candidate set** (leaving it would surface disambiguation candidates for a resolved
     *    food);
     *  - `RESOLVED` → `mergeChangedSources` (stays RESOLVED, replaces this source's portions) — see the
     *    class note on why `resolveAndPersist` would throw here;
     *  - `NOT_FOUND` / `FAILED` → reactivate to `PENDING` first (the only legal way back in), then persist.
     *
     * @param foodId - The internal food id.
     * @param status - The food's current lifecycle status.
     * @param candidate - The bulk candidate.
     * @returns `'refreshed'` for an in-place re-merge, `'seeded'` for a transition to RESOLVED.
     * @sideEffect Writes the golden record via the merge/persist seam.
     */
    private async persist(
        foodId: string,
        status: FoodRow['status'],
        candidate: CanonicalCandidate,
    ): Promise<'seeded' | 'refreshed'> {
        switch (status) {
            case 'RESOLVED':
                await this.persister.mergeChangedSources({ foodId, changed: [candidate] });

                return 'refreshed';

            case 'UNRESOLVED':
                await this.persister.resolveFromPicks({ foodId, picks: [candidate] });

                return 'seeded';

            case 'NOT_FOUND':
            case 'FAILED':
                await this.foods.setStatus({ id: foodId, status: 'PENDING' });
                await this.persister.resolveAndPersist({ foodId, candidates: [candidate] });

                return 'seeded';

            case 'PENDING':
                await this.persister.resolveAndPersist({ foodId, candidates: [candidate] });

                return 'seeded';

            default: {
                const unreachable: never = status;

                throw new Error(`unhandled food status '${String(unreachable)}'`);
            }
        }
    }
}
