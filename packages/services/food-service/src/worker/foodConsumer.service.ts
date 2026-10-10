/**
 * `FoodConsumerService` (MOD-004, ARCH-004 — T-151..T-155) — the per-row fan-out/merge logic of the
 * single Fargate consumer. It does NOT own the advisory lock or the LISTEN/NOTIFY loop (that is
 * `WorkerRuntime`); it is the testable core driven once per leased `fetch_queue` row:
 *
 *   lease (highest-demand, demotion-aware — `FetchQueueDao.leaseNext`)
 *     → catalog first (FOOD-SERVICE-6; ADR-0055 point 4): a name that IS a live catalog root or variant
 *       (`CatalogNameMatcher`) forwards the food to it, with no source call
 *     → fan out by `normalized_name` across every wired adapter (`SourceAdapterRegistry.adapters()`),
 *       every request admitted by the registry's rate-limited transport (ADR-0053 §3): a refusal → defer
 *     → `searchByName`, hiding every hit the catalog holds (`partitionHeldHits`; its holders join the merge as
 *       survivors), then a ≤20-key BATCH `fetchByKeys` (T-155) of the rest — falling back to per-key `fetchByKey` —
 *       collecting `CanonicalCandidate[]`, with EVERY one of those requests separately admitted (PR #91
 *       review; a refusal mid-fan-out defers the row like any other back-pressure)
 *     → merge + persist (`MergeAndPersistService.resolveAndPersist`) under the survivor-count boundary
 *     → on RESOLVED/UNRESOLVED: delete the queue row + prune requesters (`resolve`); emit FoodFetchCompleted
 *     → 0 hits, 0 source errors: NOT_FOUND tombstone (emit FoodFetchCompleted; NO FetchFailed, DSN-9)
 *     → all sources errored: recordFailure (attempts++ + backoff); at the budget → FAILED tombstone +
 *       FoodFetchCompleted + FetchFailed (DSN-9)
 *
 * `attempts` is incremented ONLY on a real source failure (a 500 or a 422) — never on a busy, blocked or
 * contended refusal, our own accounting failure, or a 429/5xx back-off (those `deferLease`, DSN-5). An already-`RESOLVED` row on the queue is a
 * change-refresh re-enqueue (DSN-4): it takes the selective in-place re-pull branch
 * ({@link FoodConsumerService.refreshResolvedFood}) — re-fetching each backing `food_sources` item by
 * `external_key`, re-merging only those whose `item_version` changed, never re-fanning-out by name and
 * never clobbering a manual pick (FR-031/FR-032).
 *
 * Before any source call, each leased row is provenance-checked (FR-048, T-053): the recorded
 * `fetch_requesters` set must name at least one real principal (an app-user ULID or an
 * allowlisted `svc_*` service principal) — a row with no valid recorded requester is refused
 * (tombstoned, no source call), so no unauthenticated producer can drive external consumption.
 *
 * @implements FR-015 FR-016 FR-018 FR-019 FR-023 FR-024 FR-025 FR-026 FR-027 FR-031 FR-032 FR-048 FR-MRG-1 FR-MRG-4 FR-ADP-1
 */
import type { FoodSourceRow } from '../db/schema/index.js';
import type { FoodEventPublisher } from '../events/FoodEventEmitter.js';
import type { CatalogNameMatcher } from '../foods/catalogNameMatcher.service.js';
import type { CatalogOwnerReader } from '../foods/catalogOwnerReader.service.js';
import { FetchQueueDao, type ClaimedFetchQueueRow } from '../foods/dao/fetchQueue.dao.js';
import { FoodDao } from '../foods/dao/food.dao.js';
import { FoodSourcesDao } from '../foods/dao/foodSources.dao.js';
import { holdersOfItems, partitionHeldHits } from '../foods/domain/heldCandidatePolicy.js';
import type { FoodRef } from '../foods/foods.schema.js';
import { isSourceHeldError } from '../foods/merge/merge.errors.js';
import { MergeAndPersistService, type PersistResult } from '../foods/merge/mergeAndPersist.service.js';
import { SourceAdapterRegistry } from '../sources/SourceAdapterRegistry.js';
import { isAdapterValidationError, isSourceApiError } from '../sources/foodSource.errors.js';
import {
    isWiredSourceId,
    type CanonicalCandidate,
    type FoodSourceAdapter,
    type FoodSourceId,
} from '../sources/foodSourceAdapter.js';
import { backpressureReasonOf, isSourceBackpressure } from '../sources/transport/blockRule.js';
import { FoodMetrics } from '../observability/emfMetrics.js';
import { isLeaseLostError, type LeaseFence } from '../foods/dao/leaseFence.js';
import { isRetryBudgetExhausted } from './backoff.js';
import { hasValidProvenance } from './provenance.js';
import { RoutedWorkerLogger } from './RoutedWorkerLogger.js';
import { type WorkerLogger } from './workerLogger.js';

/** Max keys pulled in one batch source call (USDA's `POST /api/v1/foods` cap; counts as 1 windowed call). */
const FETCH_BATCH_MAX = 20;

/** Dispositions that resolved a row to a terminal state — the ones that count toward resolution latency. */
const TERMINAL_DISPOSITIONS: ReadonlySet<ProcessDisposition> = new Set([
    'resolved',
    'forwarded',
    'unresolved',
    'not_found',
    'failed',
    'refreshed',
]);

/** Seconds a row is deferred when the transport refuses a call or its accounting fails (DSN-5 — no `attempts++`). */
const DEFER_PAUSE_SECONDS = 30;

/** Seconds a row is deferred on source backpressure — a `429` or a gateway 502/503/504 (no `attempts++`). */
const DEFER_429_SECONDS = 60;

/** Seconds a single food is deferred after a client timeout / transport failure (statusCode 0). Per-food
 *  (no source-wide pause), so shorter than the authoritative-backpressure back-off. No `attempts++`. */
const DEFER_TIMEOUT_SECONDS = 30;

/** The outcome of a per-source fan-out pass over the wired adapters. */
type FanOutResult =
    | { readonly kind: 'deferred' }
    | {
          readonly kind: 'collected';
          /** The fetched candidates the catalog does not hold. */
          readonly candidates: CanonicalCandidate[];
          /** The live catalog entries holding the hits the catalog does hold. */
          readonly holders: FoodRef[];
          readonly failedSources: number;
      };

/** The disposition applied to a leased row this pass (the worker's decision, MOD-004 §3). */
export type ProcessDisposition =
    | 'idle' // nothing eligible to lease
    | 'resolved' // confident merge → RESOLVED, row cleared
    | 'forwarded' // the food IS a catalog entry → forwarded to it, reported RESOLVED, row cleared (FOOD-SERVICE-6)
    | 'unresolved' // multi-candidate → UNRESOLVED, candidate set persisted, row cleared
    | 'not_found' // no source has it → NOT_FOUND tombstone
    | 'failed' // all sources errored after the retry budget → FAILED tombstone
    | 'record_failure' // a real source error this pass → re-queued with backoff (under budget)
    | 'deferred' // back-pressure (the worker's share spent / a block / 429) → re-queued, no attempts change
    | 'refreshed' // a RESOLVED row reached the drainer → change-refresh selective in-place re-pull (DSN-4)
    | 'rejected_provenance' // a leased row had no valid recorded requester → refused, no source call (FR-048)
    | 'lease_lost'; // the claim was reaped/reclaimed mid-work → this loop's result was refused (R16)

/** Constructor dependencies for {@link FoodConsumerService}. */
export interface FoodConsumerDeps {
    /** Golden-record / lifecycle DAO. */
    readonly foodDao: FoodDao;
    /** Crosswalk DAO — the change-refresh branch iterates a RESOLVED food's backing items (T-171). */
    readonly sources: FoodSourcesDao;
    /** Demand-weighted queue DAO (lease/defer/recordFailure/resolve/tombstone). */
    readonly queue: FetchQueueDao;
    /** Wired source adapters in priority order. */
    readonly registry: SourceAdapterRegistry;
    /** Merge + persist seam (survivor-count boundary). */
    readonly merge: MergeAndPersistService;
    /** What the catalog already holds, asked before and during the fan-out (FOOD-SERVICE-6). */
    readonly catalog: WorkerCatalog;
    /** Completion/failure event publisher. */
    readonly events: FoodEventPublisher;
    /** Optional structured logger (defaults to a JSON console logger). */
    readonly logger?: WorkerLogger;
    /** Optional EMF metric recorder — when present, per-row resolution latency is emitted (T-181). */
    readonly metrics?: FoodMetrics;
    /**
     * Lease window in seconds. Left UNSET by the composition roots on purpose: omitted, the queue DAO
     * applies the configured `FOOD_LEASE_TIMEOUT_SECONDS` (FR-018). Restating a default here is what made
     * that variable dead — this service passed its own literal 30 on every call, so the DAO's configured
     * default never applied.
     */
    readonly leaseSeconds?: number;
    /**
     * How many foods to process concurrently in {@link FoodConsumerService.drain} (default 1). The fan-out
     * is ~80% USDA network I/O, so K in-flight foods overlap their waits for ~K× throughput; `leaseNext`
     * uses `FOR UPDATE SKIP LOCKED`, so concurrent claims never collide. The worker sizes this off vCPUs.
     */
    readonly concurrency?: number;
}

/**
 * The catalog questions the worker asks (FOOD-SERVICE-6; ADR-0055 point 4). Required, not optional: a composition root
 * that left it out would fan out over the catalog's own foods and offer the items it holds, which is the defect.
 */
export interface WorkerCatalog {
    /** Which catalog entry a food's name IS. */
    readonly names: Pick<CatalogNameMatcher, 'identicalEntryFor'>;
    /** Which source items the catalog holds, and by whom. */
    readonly owners: Pick<CatalogOwnerReader, 'standingOfKeys' | 'standingOfItems'>;
}

export class FoodConsumerService {
    private readonly foodDao: FoodDao;
    private readonly sources: FoodSourcesDao;
    private readonly queue: FetchQueueDao;
    private readonly registry: SourceAdapterRegistry;
    private readonly merge: MergeAndPersistService;
    private readonly catalog: WorkerCatalog;
    private readonly events: FoodEventPublisher;
    private readonly logger: WorkerLogger;
    private readonly metrics: FoodMetrics | undefined;
    private readonly leaseSeconds: number | undefined;
    private readonly concurrency: number;

    /** Set on shutdown: claim loops stop asking for work, so the drain winds down instead of being cut off. */
    private halted = false;

    /** @param deps - The injected DAOs, registry, merge seam, and event publisher. */
    public constructor(deps: FoodConsumerDeps) {
        this.foodDao = deps.foodDao;
        this.sources = deps.sources;
        this.queue = deps.queue;
        this.registry = deps.registry;
        this.merge = deps.merge;
        this.catalog = deps.catalog;
        this.events = deps.events;
        this.logger = deps.logger ?? new RoutedWorkerLogger();
        this.metrics = deps.metrics;
        this.leaseSeconds = deps.leaseSeconds;
        this.concurrency = Math.max(1, deps.concurrency ?? 1);
    }

    /**
     * Lease the next eligible row and process it; `idle` when nothing is eligible (T-151).
     *
     * @returns The disposition applied (or `idle`).
     * @sideEffect Leases + mutates a `fetch_queue` row; may call sources, merge/persist, emit events.
     */
    public async processNext(): Promise<ProcessDisposition> {
        const row = await this.queue.leaseNext(this.leaseSeconds);

        if (!row) {
            return 'idle';
        }

        this.logger.info('lease-claimed', { foodId: row.foodId, requestCount: row.requestCount });

        const startedAt = Date.now();
        let disposition: ProcessDisposition;

        // ⛔ ONE containment boundary for the whole claim, and the error names its OWN site.
        //
        // This was three nested try/catches, each ending in a hand-written operation string — and one of
        // them was unreachable, because `tombstoneFailed` settles out of band and out-of-band never throws.
        // Three copies of "a lost lease means abandon" is three chances to write the fourth one wrong, and
        // the literals were worse than what they replaced: `LeaseLostError` already carries the food AND
        // the DAO method that refused, minted where the refusal happened, where `'settle'` was vaguer than
        // the truth and `'tombstoneFailed'` named a method the DAO never sees.
        try {
            disposition = await this.processClaim(row);
        } catch (error) {
            if (isLeaseLostError(error)) {
                return this.abandonLostClaim(error.foodId, error.operation);
            }

            throw error;
        }

        // T-181: a row that reached a terminal lifecycle state contributes to resolution latency
        // (lease → disposition). Defers/back-pressure are NOT terminal and are excluded.
        //
        // ⚠️ OUTSIDE the boundary on purpose: a claim that lost its lease returned above, so an abandoned
        // claim contributes no latency sample and no worker error. It reached no lifecycle state, and
        // counting it would put deploy noise into both series.
        if (TERMINAL_DISPOSITIONS.has(disposition)) {
            this.metrics?.recordResolutionLatencySeconds((Date.now() - startedAt) / 1000);
        }

        // A real source/processing failure this pass — the dashboard worker-error signal (T-182).
        if (disposition === 'failed' || disposition === 'record_failure') {
            this.metrics?.recordWorkerError();
        }

        return disposition;
    }

    /**
     * Process one claimed row, converting an UNEXPECTED processing failure into the FR-016 retry path.
     *
     * Split from {@link processNext} so that method owns exactly one lease-lost boundary: every settle
     * below is fenced, including the ones in the failure handler, so any of them may refuse and all of
     * them must land in the same place.
     *
     * @param row - The claimed row, carrying its fence.
     * @returns The disposition applied.
     * @throws {LeaseLostError} when any settle found the claim reaped or reclaimed.
     * @sideEffect Everything {@link processRow} does, plus the failure path's settle and events.
     */
    private async processClaim(row: ClaimedFetchQueueRow): Promise<ProcessDisposition> {
        try {
            return await this.processRow(row);
        } catch (error) {
            if (isLeaseLostError(error)) {
                throw error;
            }

            // An UNEXPECTED processing failure (e.g. a DB upsert error) — a genuine failure that
            // consumes the FR-016 retry budget with backoff (DSN-5). No upstream detail is leaked.
            const failed = await this.queue.recordFailure(row.foodId, 'processing_error', row.fence);

            this.logger.error('processing-error', {
                foodId: row.foodId,
                attempts: failed.attempts,
                error: error instanceof Error ? error.message : 'unknown',
            });

            if (isRetryBudgetExhausted(failed.attempts)) {
                return this.tombstoneFailed(row.foodId, failed.attempts, 'processing_error');
            }

            await this.markAwaitingRetry(row.foodId);

            return 'record_failure';
        }
    }

    /**
     * Stop claiming new rows (SIGTERM). Rows already in flight run to their settle.
     *
     * ⛔ This exists because of the fence, not beside it. `WorkerRuntime.stop` releases this worker's
     * in-flight leases so a replacement re-claims them at once (FR-017) — and since U5 a release
     * invalidates the claim of anything still running, so releasing UNDER a live drain turns every
     * in-flight food into a refused settle: wasted fetches on every deploy, and a `FoodLeaseLost` signal
     * that cries wolf exactly when it should mean something. Letting the drain wind down first makes the
     * release describe what it says it describes for the foods that finish in time.
     *
     * ⚠️ The wait is BOUNDED (`WorkerRuntime`'s grace), so a claim mid-fan-out can still outlive it. That
     * residual is why `abandonLostClaim` reads this flag: a lease lost while halting is a deploy, not a
     * derivation failure, and only the second belongs on the metric.
     *
     * @sideEffect Flips the drain's stop flag; no I/O.
     */
    public halt(): void {
        this.halted = true;
    }

    /**
     * Drain the queue until nothing is eligible (T-151) — invoked on a NOTIFY wake or poll interval.
     *
     * @returns The number of rows processed before the queue drained.
     * @sideEffect Repeatedly leases + processes `fetch_queue` rows.
     */
    public async drain(): Promise<number> {
        let processed = 0;

        // Bounded concurrency: run `this.concurrency` claim→process loops in parallel. Because each food is
        // ~80% network wait (USDA), the in-flight foods overlap their I/O for ~K× throughput. `leaseNext`
        // (FOR UPDATE SKIP LOCKED) hands each loop a distinct row, so they never double-claim; a loop stops
        // when nothing is eligible (`idle`), and the drain returns once every loop has idled. JS is
        // single-threaded, so `processed += 1` between awaits is race-free.
        const claimLoop = async (): Promise<void> => {
            for (;;) {
                if (this.halted) {
                    return;
                }

                const disposition = await this.processNext();

                if (disposition === 'idle') {
                    return;
                }

                processed += 1;
            }
        };

        await Promise.all(Array.from({ length: this.concurrency }, () => claimLoop()));

        return processed;
    }

    /**
     * Process a single already-leased row (the fan-out/merge core, T-152..T-155).
     *
     * @param row - The claimed `fetch_queue` row, carrying the fence every settle below presents.
     * @returns The disposition applied.
     * @throws {LeaseLostError} when the claim was reaped or reclaimed mid-work (caught by
     *   {@link processNext}, which turns it into `lease_lost`).
     * @sideEffect Calls sources, merges/persists, mutates the queue row, emits events.
     */
    public async processRow(row: ClaimedFetchQueueRow): Promise<ProcessDisposition> {
        const foodId = row.foodId;
        const fence = row.fence;
        const food = await this.foodDao.getById(foodId);

        if (!food) {
            // The food row vanished (cascade) — ack the orphaned queue row and move on.
            this.logger.warn('orphan-row-acked', { foodId });
            await this.queue.resolve(foodId, fence);

            return 'idle';
        }

        // Async-producer provenance (FR-048, T-053): refuse to drain a row whose recorded requester set
        // does not name a real principal — no requester at all, or a forbidden `'system'` shortcut means
        // an unauthenticated/unauthorized producer enqueued it, so NO external source call may happen on
        // its behalf. Tombstone the row (it never should have existed) without touching the source.
        //
        // An operator requeue (U9) satisfies this like any other producer: it re-enqueues through
        // `EnqueueEmitter` as the named `svc_admin_requeue` service principal, so the recovered row has a
        // real recorded requester and needs no special case here.
        const requesterIds = await this.queue.listRequesterIds(foodId);

        if (!hasValidProvenance(requesterIds)) {
            await this.queue.tombstone(foodId, 'unauthenticated_producer', fence);
            this.logger.warn('provenance-refused', { foodId, requesters: requesterIds.length });

            return 'rejected_provenance';
        }

        // Change-refresh branch (DSN-4/FR-031/FR-032): a RESOLVED food only reaches the drainer because the
        // change-refresh scheduler re-enqueued it (a fresh add never re-enqueues a RESOLVED food, DSN-1), so
        // a RESOLVED row on the queue is unambiguously a refresh. Take the SELECTIVE in-place re-pull —
        // never a name fan-out, never re-running disambiguation, never clobbering a manual pick.
        if (food.status === 'RESOLVED') {
            return this.refreshResolvedFood(foodId, fence);
        }

        // Catalog first (FOOD-SERVICE-6; ADR-0055 point 4): a name that IS a catalog entry is answered by it, and no
        // source is asked. Asked on the same stable name the fan-out uses.
        const entry = await this.catalog.names.identicalEntryFor(food.normalizedName);

        if (entry !== undefined) {
            return this.settleResolved(
                foodId,
                fence,
                await this.merge.resolveToHolder({ foodId, to: entry, from: [food.status] }),
            );
        }

        // Fan out on the STABLE normalized_name (DB-11) — never the golden `name` a merge may rewrite.
        const result = await this.fanOut(foodId, food.normalizedName, fence);

        if (result.kind === 'deferred') {
            return 'deferred';
        }

        const { candidates, holders, failedSources } = result;
        const answered = candidates.length > 0 || holders.length > 0;

        // No source has it (0 hits, 0 errors) → NOT_FOUND tombstone immediately, no retry. A NORMAL
        // outcome: completion event only, NO FetchFailed / no alarm (FR-025/DSN-9).
        if (!answered && failedSources === 0) {
            await this.foodDao.setStatus({ id: foodId, status: 'NOT_FOUND' });
            await this.queue.tombstone(foodId, 'no_source_has_item', fence);
            await this.events.publishFoodFetchCompleted({ id: foodId, status: 'NOT_FOUND' });
            this.logger.info('tombstone-not-found', { foodId });

            return 'not_found';
        }

        // Every source that had a chance errored this pass → record the REAL failure (attempts++ + backoff,
        // FR-016/DSN-5) and tombstone FAILED once the budget is exhausted.
        if (!answered && failedSources > 0) {
            const failed = await this.queue.recordFailure(foodId, 'all_sources_errored', fence);

            if (isRetryBudgetExhausted(failed.attempts)) {
                return this.tombstoneFailed(foodId, failed.attempts, 'all_sources_errored');
            }

            await this.markAwaitingRetry(foodId);
            this.logger.warn('record-failure', { foodId, attempts: failed.attempts });

            return 'record_failure';
        }

        // Candidates collected → merge + persist under the survivor-count boundary (FR-MRG-5), each holder a survivor.
        const persisted = await this.persistFanOut(foodId, candidates, holders);

        if (persisted.status === 'NOT_FOUND') {
            // Every survivor was held and no single holder answers, or nothing could be offered.
            await this.queue.tombstone(foodId, 'no_source_has_item', fence);
            await this.events.publishFoodFetchCompleted({ id: foodId, status: 'NOT_FOUND' });

            return 'not_found';
        }

        return this.settleResolved(foodId, fence, persisted);
    }

    /**
     * Merge and persist a fan-out's answer. A merge refused because a contributor became held after the fan-out read
     * the catalog (`SourceHeldError`) is re-decided with that item's holder as the only survivor: the food is forwarded
     * to the one live holder, or tombstoned when there is none or several. Never a failed row: the source answered.
     *
     * @param foodId - The food.
     * @param candidates - The fetched candidates the catalog does not hold.
     * @param holders - The live catalog entries holding the rest.
     * @returns The persisted result.
     * @sideEffect Writes through the merge seam; reads the catalog's standing on a refusal.
     */
    private async persistFanOut(
        foodId: string,
        candidates: readonly CanonicalCandidate[],
        holders: readonly FoodRef[],
    ): Promise<PersistResult> {
        try {
            return await this.merge.resolveAndPersist({ foodId, candidates, holders });
        } catch (error) {
            if (!isSourceHeldError(error)) {
                throw error;
            }

            const standings = await this.catalog.owners.standingOfItems(error.held);

            this.logger.warn('merge-source-held', { foodId, held: error.held.length });

            return this.merge.resolveAndPersist({
                foodId,
                candidates: [],
                holders: holdersOfItems(error.held, standings, foodId),
            });
        }
    }

    /**
     * Settle a row whose food reached `RESOLVED` (merged or forwarded) or `UNRESOLVED`: clear the queue row and emit
     * the completion event.
     *
     * @param foodId - The food.
     * @param fence - The claim's lease fence.
     * @param persisted - What the merge seam persisted.
     * @returns The disposition.
     * @throws {LeaseLostError} when the claim was reaped or reclaimed.
     * @sideEffect Deletes the queue row and its requesters; emits an event.
     */
    private async settleResolved(
        foodId: string,
        fence: LeaseFence,
        persisted: PersistResult,
    ): Promise<ProcessDisposition> {
        await this.queue.resolve(foodId, fence);
        await this.events.publishFoodFetchCompleted({ id: foodId, status: persisted.status });

        if (persisted.forwardedTo !== undefined) {
            this.logger.info('forwarded', { foodId, kind: persisted.forwardedTo.kind, to: persisted.forwardedTo.id });

            return 'forwarded';
        }

        this.logger.info('resolved', { foodId, status: persisted.status });

        return persisted.status === 'RESOLVED' ? 'resolved' : 'unresolved';
    }

    /**
     * Change-refresh selective in-place re-pull for a `RESOLVED` food (T-171, FR-031/FR-032, DSN-4). For
     * each backing `food_sources` item: re-fetch by `external_key` (admitted by the registry's transport) and
     * compare the new `item_version`. Only items whose version changed upstream are re-pulled and re-merged in
     * place (their `source_id` provenance + `item_version` updated); an item whose re-fetch errors is skipped
     * (its field(s) left intact). The food STAYS `RESOLVED` — disambiguation is never re-run, so a refresh
     * can never demote it or overwrite a manual pick whose item did not change. Emits `FoodFetchCompleted`
     * like the first-time path.
     *
     * A refused call, our own accounting failure, or a 429/502/503/504 STOPS the refresh and defers the row
     * (ADR-0053 §4): the source is busy or blocked for every task, so the next item would be refused too, and
     * a partial refresh is not applied.
     *
     * @param foodId - The RESOLVED food id.
     * @param fence - The claim's lease fence (R16), presented by every settle below.
     * @returns `deferred` when a source was busy or blocked mid-scan, else `refreshed`.
     * @throws {LeaseLostError} when the claim was reaped or reclaimed mid-refresh.
     * @sideEffect Calls sources (rate-limited), may re-merge/persist, acks the queue row, emits an event.
     */
    private async refreshResolvedFood(foodId: string, fence: LeaseFence): Promise<ProcessDisposition> {
        // A seed-owned food has nothing re-pullable (R14): the row settles below with no source call.
        const backing = await this.sources.listRefreshableByFood(foodId);
        const changed: CanonicalCandidate[] = [];

        for (const item of backing) {
            const source = item.source;

            // Only a wired source can be re-fetched (R57); a live food never holds another, so this skips nothing today.
            if (!isWiredSourceId(source)) {
                continue;
            }

            let current: CanonicalCandidate | undefined;

            try {
                current = await this.refetchItem(foodId, source, item);
            } catch (error) {
                if (isSourceBackpressure(error)) {
                    await this.queue.deferLease(foodId, DEFER_PAUSE_SECONDS, fence);
                    this.logger.warn('refresh-defer-source-busy', {
                        foodId,
                        source,
                        reason: backpressureReasonOf(error),
                    });

                    return 'deferred';
                }

                throw error;
            }

            if (current && current.itemVersion !== item.itemVersion) {
                changed.push(current);
            }
        }

        if (changed.length > 0) {
            await this.merge.mergeChangedSources({ foodId, changed });
            this.logger.info('refresh-applied', { foodId, changed: changed.length });
        }

        await this.queue.resolve(foodId, fence);
        await this.events.publishFoodFetchCompleted({ id: foodId, status: 'RESOLVED' });

        return 'refreshed';
    }

    /**
     * Re-fetch one backing item for the refresh compare, swallowing a per-item source/validation error (the
     * item is skipped this cycle and its field(s) are left intact — no overwrite, MOD-020 error table).
     *
     * @param foodId - The food the item backs.
     * @param source - The item's wired source.
     * @param item - The backing crosswalk row.
     * @returns The re-fetched candidate, or `undefined` when the re-fetch failed validation/transport.
     * @throws {SourceBusyError} or {SourceAccountingError} when the transport refused the call or failed its own
     *   accounting, and {SourceApiError} for a 429/502/503/504 — the caller stops the refresh on each.
     * @sideEffect Performs a source fetch via the adapter.
     */
    private async refetchItem(
        foodId: string,
        source: FoodSourceId,
        item: FoodSourceRow,
    ): Promise<CanonicalCandidate | undefined> {
        try {
            return await this.registry.adapterFor(source).fetchByKey(item.externalKey);
        } catch (error) {
            if (isSourceBackpressure(error)) {
                throw error;
            }

            if (isSourceApiError(error) || isAdapterValidationError(error)) {
                this.logger.warn('refresh-refetch-skipped', { foodId, source });

                return undefined;
            }

            throw error;
        }
    }

    /**
     * Revert orphaned `in_flight` leases back to `pending` (the reaper, T-153 — run at start + every
     * minute by `WorkerRuntime`).
     *
     * @returns The number of reclaimed rows.
     * @sideEffect Updates `fetch_queue`.
     */
    public async reapStaleLeases(): Promise<number> {
        return this.queue.reapExpiredLeases(this.leaseSeconds);
    }

    /**
     * Fan out by name across every wired adapter (T-152). Every request is admitted by the registry's
     * rate-limited transport (ADR-0053 §3): a refusal — busy, blocked or contended — or our own accounting
     * failure DEFERS the whole row with no `attempts++` (DSN-5); a source `429` or gateway 502/503/504 defers it
     * too (the transport has already written the block every task reads); a 500/422 counts as a real failure for
     * that source; a 404 / other 4xx is "this source doesn't have it" (no contribution, no failure). Collected
     * hits are pulled via the adapter's ≤20-key BATCH (T-155) with a per-key fallback.
     *
     * @param foodId - The leased food id (for defer bookkeeping).
     * @param name - The stable fan-out query (`normalized_name`).
     * @param fence - The claim's lease fence (R16), presented by every deferral below.
     * @returns Either a `deferred` signal or the collected candidates + real-failure count.
     * @throws {LeaseLostError} when the claim was reaped or reclaimed mid-fan-out.
     * @sideEffect Calls sources (each call admitted against its window), may defer the queue row.
     */
    private async fanOut(foodId: string, name: string, fence: LeaseFence): Promise<FanOutResult> {
        const candidates: CanonicalCandidate[] = [];
        const holders = new Map<string, FoodRef>();
        let failedSources = 0;

        for (const adapter of this.registry.adapters()) {
            const source = adapter.source;

            try {
                const hits = await adapter.searchByName(name);

                if (hits.length === 0) {
                    continue;
                }

                // Hide what the catalog holds before any fetch (FOOD-SERVICE-6): a held item is never fetched, never
                // offered, and never merged over its holder's row.
                const partition = partitionHeldHits(
                    hits,
                    await this.catalog.owners.standingOfKeys(
                        source,
                        hits.map((hit) => ({ externalKey: hit.externalKey, lineageKey: hit.lineageKey })),
                    ),
                    foodId,
                );

                for (const holder of partition.holders) {
                    holders.set(`${holder.kind}:${holder.id}`, holder);
                }

                if (partition.offered.length === 0) {
                    continue;
                }

                candidates.push(
                    ...(await this.fetchCandidates(
                        adapter,
                        partition.offered.map((hit) => hit.externalKey),
                    )),
                );
            } catch (error) {
                if (isSourceBackpressure(error)) {
                    // The source is busy or blocked for every task, or our own accounting failed (ADR-0053 §4): a
                    // refusal before the source was asked, or a 429/502/503/504 whose block the transport has
                    // written. Defer the WHOLE row — the candidates collected so far are DISCARDED rather than
                    // merged: a partial set is what `MergeAndPersistService`'s survivor count reads as a confident
                    // single answer. Not a per-food failure → no attempts++ (DSN-5). A source's own answer waits the
                    // longer pause. (Schema drift is mapped to 422, so a 502 here is only a real 502.)
                    const answered = isSourceApiError(error);

                    await this.queue.deferLease(foodId, answered ? DEFER_429_SECONDS : DEFER_PAUSE_SECONDS, fence);
                    this.logger.warn(answered ? 'defer-backpressure' : 'defer-source-refused', {
                        foodId,
                        source,
                        reason: backpressureReasonOf(error),
                    });

                    return { kind: 'deferred' };
                }

                if (isSourceApiError(error)) {
                    if (error.statusCode === 0) {
                        // Client timeout / transport failure. Defer ONLY THIS food — one item timing out is weak
                        // evidence of source-wide distress, so it writes no block. This is self-inflicted latency
                        // under our own concurrency, not a per-food defect → no attempts++ (so a transient timeout
                        // can't burn the failure budget / tombstone a good food).
                        await this.queue.deferLease(foodId, DEFER_TIMEOUT_SECONDS, fence);
                        this.logger.warn('defer-timeout', { foodId, source });

                        return { kind: 'deferred' };
                    }

                    if (error.statusCode >= 500 || error.statusCode === 422) {
                        // Genuine per-source failure — a 500/501/… server error, or 422 schema drift (a
                        // persistently malformed item). Consume the retry budget (FR-016/DSN-5).
                        failedSources += 1;
                        this.logger.warn('source-error', { foodId, source, statusCode: error.statusCode });

                        continue;
                    }

                    // 404 / other 4xx: the source simply doesn't have the item — no contribution, no failure.
                    continue;
                }

                if (isAdapterValidationError(error)) {
                    // reject-not-store at the search level — drop, the food may still resolve elsewhere.
                    this.logger.warn('search-rejected', { foodId, source });

                    continue;
                }

                throw error; // unknown → bubble to processNext (a genuine processing failure).
            }
        }

        return { kind: 'collected', candidates, holders: [...holders.values()], failedSources };
    }

    /**
     * Fetch the resolved keys for a source, preferring the adapter's ≤20-key BATCH (T-155, 1 admitted
     * call) and falling back to per-key {@link FoodSourceAdapter.fetchByKey} when the adapter exposes no
     * batch method. A candidate failing adapter validation is dropped (reject-not-store, FR-ADP-2).
     *
     * Every request here is admitted by the transport, one admission per request (PR #91 review); a refusal
     * propagates to {@link fanOut}, which defers the row.
     *
     * @param adapter - The source adapter.
     * @param keys - The opaque keys to fetch.
     * @returns The validated canonical candidates.
     * @sideEffect Performs source fetches via the adapter, each admitted against the window.
     */
    private async fetchCandidates(adapter: FoodSourceAdapter, keys: readonly string[]): Promise<CanonicalCandidate[]> {
        const batch = adapter.fetchByKeys?.bind(adapter);

        if (batch) {
            return this.batchFetch(adapter, batch, keys);
        }

        const collected: CanonicalCandidate[] = [];

        for (const key of keys) {
            try {
                collected.push(await adapter.fetchByKey(key));
            } catch (error) {
                if (isAdapterValidationError(error)) {
                    this.logger.warn('candidate-rejected', { source: adapter.source, externalKey: key });

                    continue;
                }

                throw error;
            }
        }

        return collected;
    }

    /**
     * Pull keys via the adapter's batch endpoint in ≤{@link FETCH_BATCH_MAX} chunks. If a chunk fails
     * adapter validation as a whole, recover the valid items in it per key so one bad item does not
     * sink the rest (reject-not-store). A `SourceApiError` or a refusal propagates to {@link fanOut}.
     *
     * A chunk is one request (FR-023's "≤20 keys counts as exactly 1 call") and each recovery key is one more, and
     * the transport admits each. The failed chunk itself is not refunded; it was a request.
     *
     * @param adapter - The source adapter (for the per-key recovery fallback).
     * @param batch - The bound batch fetch.
     * @param keys - The opaque keys to fetch.
     * @returns The validated canonical candidates.
     * @sideEffect Performs batched source fetches via the adapter, each admitted against the window.
     */
    private async batchFetch(
        adapter: FoodSourceAdapter,
        batch: (externalKeys: readonly string[]) => Promise<CanonicalCandidate[]>,
        keys: readonly string[],
    ): Promise<CanonicalCandidate[]> {
        const collected: CanonicalCandidate[] = [];

        for (let offset = 0; offset < keys.length; offset += FETCH_BATCH_MAX) {
            const chunk = keys.slice(offset, offset + FETCH_BATCH_MAX);

            try {
                collected.push(...(await batch(chunk)));
            } catch (error) {
                if (isAdapterValidationError(error)) {
                    for (const key of chunk) {
                        try {
                            collected.push(await adapter.fetchByKey(key));
                        } catch (inner) {
                            if (isAdapterValidationError(inner)) {
                                continue;
                            }

                            throw inner;
                        }
                    }

                    continue;
                }

                throw error;
            }
        }

        return collected;
    }

    /**
     * Give up a claim another loop has taken (R16) — log it, count it, and return without writing.
     *
     * ⚠️ This is the ONE place a lost fence becomes visible. It is not an error to swallow quietly: a
     * sustained `FoodLeaseLost` rate means claims are outliving the window `leaseWindow.ts` derives, so
     * the derivation has stopped matching the work. It is also not an error to fail the drain over — the
     * row is untouched and whoever holds it now will settle it, so the correct action is to stop.
     *
     * @param foodId - The food whose claim was lost.
     * @param operation - The settle that was refused (which stage noticed).
     * @returns The `lease_lost` disposition.
     * @sideEffect Emits a log line and one EMF metric.
     */
    private abandonLostClaim(foodId: string, operation: string): ProcessDisposition {
        // ⛔ THE SHUTDOWN PATH IS NOT A DEFECT, and the metric must not say it is. `WorkerRuntime.stop`
        // waits only a BOUNDED grace for the in-flight drain before releasing this worker's leases — it
        // has to, because one claim may legitimately run for the whole derived lease window, far longer
        // than the grace ECS gives a task between SIGTERM and SIGKILL. So an ordinary deploy of a busy
        // worker produces lost leases by design. Counting them alongside a derivation failure would make
        // the one signal that proves the fence is firing page on every release, and a signal that cries
        // wolf is retired rather than fixed.
        //
        // `halted` is exactly "this process is stopping", which is the fact that tells the two apart.
        if (this.halted) {
            this.logger.info('lease-released-at-shutdown', { foodId, operation });

            return 'lease_lost';
        }

        this.logger.warn('lease-lost', { foodId, operation });
        this.metrics?.recordLeaseLost();

        return 'lease_lost';
    }

    /**
     * Tombstone a food `FAILED` after the retry budget is exhausted (FR-027): set the lifecycle, mark
     * the queue row a tombstone, and emit BOTH `FoodFetchCompleted` and `FetchFailed` (the alarm fires
     * on FAILED only, DSN-9).
     *
     * ⛔ It settles OUT OF BAND, and the reason is structural rather than an exemption: both callers
     * reach it only AFTER `recordFailure`, which has already reverted the row to `pending` and cleared
     * `leased_at` — there is no claim left to fence against. What keeps another loop off the row for the
     * milliseconds until the tombstone lands is `recordFailure`'s backoff gate, which with an exhausted
     * budget holds `last_requested` 2^5 seconds out. Passing the spent fence here would refuse every
     * tombstone instead, leaving a food that has failed five times cycling forever.
     *
     * @param foodId - The food id.
     * @param attempts - The exhausted real-failure count.
     * @param lastError - A sanitized terminal error detail.
     * @returns The `failed` disposition.
     * @sideEffect Updates `food`/`fetch_queue`; emits two events.
     */
    private async tombstoneFailed(foodId: string, attempts: number, lastError: string): Promise<ProcessDisposition> {
        await this.foodDao.setStatus({ id: foodId, status: 'FAILED' });
        await this.queue.tombstone(foodId, lastError, 'out-of-band');
        await this.events.publishFoodFetchCompleted({ id: foodId, status: 'FAILED' });
        await this.events.publishFetchFailed({ id: foodId, attempts, lastError });
        // ⛔ A SEPARATE signal from the tombstone count, deliberately. DSN-9 silences the `NOT_FOUND`
        // tombstone because "no wired source has this food" is a normal outcome — but exhausting five real
        // failures is not: it means a source has been erroring for the whole backoff curve, and without its
        // own metric that blackholed food is invisible among the NOT_FOUNDs it does not resemble.
        this.metrics?.recordRetryBudgetExhausted();
        this.logger.error('tombstone-failed', { foodId, attempts });

        return 'failed';
    }

    /**
     * Mark a food `AWAITING_RETRY` after a real failure that did NOT exhaust the budget (U9).
     *
     * Best-effort by design: the queue row already carries the authoritative retry state (`attempts` and the
     * backoff gate), so this is the WIRE-VISIBLE half. A failure to write it must not turn a retryable food
     * into a processing error and consume a second attempt — the food would then burn its budget on the
     * status write rather than on fetches.
     *
     * @param foodId - The food that failed.
     * @sideEffect Updates `food.status`; logs and swallows its own failure.
     */
    private async markAwaitingRetry(foodId: string): Promise<void> {
        try {
            await this.foodDao.setStatus({ id: foodId, status: 'AWAITING_RETRY' });
        } catch (error) {
            this.logger.warn('awaiting-retry-mark-failed', {
                foodId,
                error: error instanceof Error ? error.message : 'unknown',
            });
        }
    }
}
