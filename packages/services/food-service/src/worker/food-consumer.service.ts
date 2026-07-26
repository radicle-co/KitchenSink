/**
 * `FoodConsumerService` (MOD-004, ARCH-004 — T-151..T-155) — the per-row fan-out/merge logic of the
 * single Fargate consumer. It does NOT own the advisory lock or the LISTEN/NOTIFY loop (that is
 * {@link WorkerRuntime}); it is the testable core driven once per leased `fetch_queue` row:
 *
 *   lease (highest-demand, demotion-aware — `FetchQueueDao.leaseNext`)
 *     → fan out by `normalized_name` across every wired adapter (`SourceAdapterRegistry.adapters()`),
 *       per-source rolling-window-gated (`RollingWindowLimiter`: pause at 90% → defer; window full → defer)
 *     → `searchByName` then a ≤20-key BATCH `fetchByKeys` (1 windowed call, T-155) — falling back to
 *       per-key `fetchByKey` — collecting `CanonicalCandidate[]`
 *     → merge + persist (`MergeAndPersistService.resolveAndPersist`) under the survivor-count boundary
 *     → on RESOLVED/UNRESOLVED: delete the queue row + prune requesters (`resolve`); emit FoodFetchCompleted
 *     → 0 hits, 0 source errors: NOT_FOUND tombstone (emit FoodFetchCompleted; NO FetchFailed, DSN-9)
 *     → all sources errored: recordFailure (attempts++ + backoff); at the budget → FAILED tombstone +
 *       FoodFetchCompleted + FetchFailed (DSN-9)
 *
 * `attempts` is incremented ONLY on a real source failure (5xx/timeout) — never on a 90%-pause/window-full
 * defer or a 429 back-off (those `deferLease`, DSN-5). An already-`RESOLVED` row on the queue is a
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
import type { FetchQueueRow, FoodSourceRow } from '../db/schema/index.js';
import type { FoodEventPublisher } from '../events/food-event-emitter.js';
import { FetchQueueDao } from '../foods/dao/fetch-queue.dao.js';
import { FoodDao } from '../foods/dao/food.dao.js';
import { FoodSourcesDao } from '../foods/dao/food-sources.dao.js';
import { MergeAndPersistService } from '../foods/merge/merge-and-persist.service.js';
import {
    isAdapterValidationError,
    isSourceApiError,
    SourceAdapterRegistry,
    type CanonicalCandidate,
    type FoodSourceAdapter,
} from '../sources/food-source-adapter.js';
import { RollingWindowLimiter } from '../sources/rolling-window-limiter.js';
import { FoodMetrics } from '../observability/emf-metrics.js';
import { isRetryBudgetExhausted } from './backoff.js';
import { hasValidProvenance } from './provenance.js';
import { ConsoleWorkerLogger, type WorkerLogger } from './worker-logger.js';

/** Max keys pulled in one batch source call (USDA's `POST /v1/foods` cap; counts as 1 windowed call). */
const FETCH_BATCH_MAX = 20;

/** Dispositions that resolved a row to a terminal state — the ones that count toward resolution latency. */
const TERMINAL_DISPOSITIONS: ReadonlySet<ProcessDisposition> = new Set([
    'resolved',
    'unresolved',
    'not_found',
    'failed',
    'refreshed',
]);

/** Seconds a row is deferred on a 90%-pause / window-full back-pressure (DSN-5 — no `attempts++`). */
const DEFER_PAUSE_SECONDS = 30;

/** Seconds a row is deferred on source backpressure — a `429` or a gateway 502/503/504 (no `attempts++`). */
const DEFER_429_SECONDS = 60;

/** Seconds a single food is deferred after a client timeout / transport failure (statusCode 0). Per-food
 *  (no source-wide pause), so shorter than the authoritative-backpressure back-off. No `attempts++`. */
const DEFER_TIMEOUT_SECONDS = 30;

/** The outcome of a per-source fan-out pass over the wired adapters. */
type FanOutResult =
    | { readonly kind: 'deferred' }
    | { readonly kind: 'collected'; readonly candidates: CanonicalCandidate[]; readonly failedSources: number };

/** The disposition applied to a leased row this pass (the worker's decision, MOD-004 §3). */
export type ProcessDisposition =
    | 'idle' // nothing eligible to lease
    | 'resolved' // confident merge → RESOLVED, row cleared
    | 'unresolved' // multi-candidate → UNRESOLVED, candidate set persisted, row cleared
    | 'not_found' // no source has it → NOT_FOUND tombstone
    | 'failed' // all sources errored after the retry budget → FAILED tombstone
    | 'record_failure' // a real source error this pass → re-queued with backoff (under budget)
    | 'deferred' // back-pressure (90% pause / window full / 429) → re-queued, no attempts change
    | 'refreshed' // a RESOLVED row reached the drainer → change-refresh selective in-place re-pull (DSN-4)
    | 'rejected_provenance'; // a leased row had no valid recorded requester → refused, no source call (FR-048)

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
    /** Per-source rolling-60-min window limiter. */
    readonly limiter: RollingWindowLimiter;
    /** Merge + persist seam (survivor-count boundary). */
    readonly merge: MergeAndPersistService;
    /** Completion/failure event publisher. */
    readonly events: FoodEventPublisher;
    /** Optional structured logger (defaults to a JSON console logger). */
    readonly logger?: WorkerLogger;
    /** Optional EMF metric recorder — when present, per-row resolution latency is emitted (T-181). */
    readonly metrics?: FoodMetrics;
    /** Lease window in seconds (default 30). */
    readonly leaseSeconds?: number;
    /**
     * How many foods to process concurrently in {@link FoodConsumerService.drain} (default 1). The fan-out
     * is ~80% USDA network I/O, so K in-flight foods overlap their waits for ~K× throughput; `leaseNext`
     * uses `FOR UPDATE SKIP LOCKED`, so concurrent claims never collide. The worker sizes this off vCPUs.
     */
    readonly concurrency?: number;
}

export class FoodConsumerService {
    private readonly foodDao: FoodDao;
    private readonly sources: FoodSourcesDao;
    private readonly queue: FetchQueueDao;
    private readonly registry: SourceAdapterRegistry;
    private readonly limiter: RollingWindowLimiter;
    private readonly merge: MergeAndPersistService;
    private readonly events: FoodEventPublisher;
    private readonly logger: WorkerLogger;
    private readonly metrics: FoodMetrics | undefined;
    private readonly leaseSeconds: number;
    private readonly concurrency: number;

    /** @param deps - The injected DAOs, registry, limiter, merge seam, and event publisher. */
    public constructor(deps: FoodConsumerDeps) {
        this.foodDao = deps.foodDao;
        this.sources = deps.sources;
        this.queue = deps.queue;
        this.registry = deps.registry;
        this.limiter = deps.limiter;
        this.merge = deps.merge;
        this.events = deps.events;
        this.logger = deps.logger ?? new ConsoleWorkerLogger();
        this.metrics = deps.metrics;
        this.leaseSeconds = deps.leaseSeconds ?? 30;
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

        try {
            disposition = await this.processRow(row);
        } catch (error) {
            // An UNEXPECTED processing failure (e.g. a DB upsert error) — a genuine failure that
            // consumes the FR-016 retry budget with backoff (DSN-5). No upstream detail is leaked.
            const failed = await this.queue.recordFailure(row.foodId, 'processing_error');
            this.logger.error('processing-error', {
                foodId: row.foodId,
                attempts: failed.attempts,
                error: error instanceof Error ? error.message : 'unknown',
            });

            disposition = isRetryBudgetExhausted(failed.attempts)
                ? await this.tombstoneFailed(row.foodId, failed.attempts, 'processing_error')
                : 'record_failure';
        }

        // T-181: a row that reached a terminal lifecycle state contributes to resolution latency
        // (lease → disposition). Defers/back-pressure are NOT terminal and are excluded.
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
     * @param row - The leased `fetch_queue` row.
     * @returns The disposition applied.
     * @sideEffect Calls sources, merges/persists, mutates the queue row, emits events.
     */
    public async processRow(row: FetchQueueRow): Promise<ProcessDisposition> {
        const foodId = row.foodId;
        const food = await this.foodDao.getById(foodId);

        if (!food) {
            // The food row vanished (cascade) — ack the orphaned queue row and move on.
            this.logger.warn('orphan-row-acked', { foodId });
            await this.queue.resolve(foodId);

            return 'idle';
        }

        // Async-producer provenance (FR-048, T-053): refuse to drain a row whose recorded requester set
        // does not name a real principal — no requester at all, or a forbidden `'system'` shortcut means
        // an unauthenticated/unauthorized producer enqueued it, so NO external source call may happen on
        // its behalf. Tombstone the row (it never should have existed) without touching the source.
        const requesterIds = await this.queue.listRequesterIds(foodId);

        if (!hasValidProvenance(requesterIds)) {
            await this.queue.tombstone(foodId, 'unauthenticated_producer');
            this.logger.warn('provenance-refused', { foodId, requesters: requesterIds.length });

            return 'rejected_provenance';
        }

        // Change-refresh branch (DSN-4/FR-031/FR-032): a RESOLVED food only reaches the drainer because the
        // change-refresh scheduler re-enqueued it (a fresh add never re-enqueues a RESOLVED food, DSN-1), so
        // a RESOLVED row on the queue is unambiguously a refresh. Take the SELECTIVE in-place re-pull —
        // never a name fan-out, never re-running disambiguation, never clobbering a manual pick.
        if (food.status === 'RESOLVED') {
            return this.refreshResolvedFood(foodId);
        }

        // Fan out on the STABLE normalized_name (DB-11) — never the golden `name` a merge may rewrite.
        const result = await this.fanOut(foodId, food.normalizedName);

        if (result.kind === 'deferred') {
            return 'deferred';
        }

        const { candidates, failedSources } = result;

        // No source has it (0 hits, 0 errors) → NOT_FOUND tombstone immediately, no retry. A NORMAL
        // outcome: completion event only, NO FetchFailed / no alarm (FR-025/DSN-9).
        if (candidates.length === 0 && failedSources === 0) {
            await this.foodDao.setStatus({ id: foodId, status: 'NOT_FOUND' });
            await this.queue.tombstone(foodId, 'no_source_has_item');
            await this.events.publishFoodFetchCompleted({ id: foodId, status: 'NOT_FOUND' });
            this.logger.info('tombstone-not-found', { foodId });

            return 'not_found';
        }

        // Every source that had a chance errored this pass → record the REAL failure (attempts++ + backoff,
        // FR-016/DSN-5) and tombstone FAILED once the budget is exhausted.
        if (candidates.length === 0 && failedSources > 0) {
            const failed = await this.queue.recordFailure(foodId, 'all_sources_errored');

            if (isRetryBudgetExhausted(failed.attempts)) {
                return this.tombstoneFailed(foodId, failed.attempts, 'all_sources_errored');
            }

            this.logger.warn('record-failure', { foodId, attempts: failed.attempts });

            return 'record_failure';
        }

        // Candidates collected → merge + persist under the survivor-count boundary (FR-MRG-5).
        const persisted = await this.merge.resolveAndPersist({ foodId, candidates });

        if (persisted.status === 'NOT_FOUND') {
            // Defensive: a non-empty candidate set normally yields RESOLVED/UNRESOLVED, never NOT_FOUND.
            await this.queue.tombstone(foodId, 'no_source_has_item');
            await this.events.publishFoodFetchCompleted({ id: foodId, status: 'NOT_FOUND' });

            return 'not_found';
        }

        await this.queue.resolve(foodId);
        await this.events.publishFoodFetchCompleted({ id: foodId, status: persisted.status });
        this.logger.info('resolved', { foodId, status: persisted.status });

        return persisted.status === 'RESOLVED' ? 'resolved' : 'unresolved';
    }

    /**
     * Change-refresh selective in-place re-pull for a `RESOLVED` food (T-171, FR-031/FR-032, DSN-4). For
     * each backing `food_sources` item: per-source rolling-window-gated (a 90% pause / full window DEFERS
     * the row — back-pressure, not a failure, DSN-5), re-fetch by `external_key`, and compare the new
     * `item_version`. Only items whose version changed upstream are re-pulled and re-merged in place
     * (their `source_id` provenance + `item_version` updated); an item whose re-fetch errors is skipped
     * (its field(s) left intact). The food STAYS `RESOLVED` — disambiguation is never re-run, so a refresh
     * can never demote it or overwrite a manual pick whose item did not change. Emits `FoodFetchCompleted`
     * like the first-time path.
     *
     * @param foodId - The RESOLVED food id.
     * @returns `deferred` when the window paused mid-scan, else `refreshed`.
     * @sideEffect Calls sources (rate-limited), may re-merge/persist, acks the queue row, emits an event.
     */
    private async refreshResolvedFood(foodId: string): Promise<ProcessDisposition> {
        const backing = await this.sources.listByFood(foodId);
        const changed: CanonicalCandidate[] = [];

        for (const item of backing) {
            const source = item.source;

            // Soft 90% pause / full window → DEFER the whole refresh row (yield headroom). Not a failure.
            if (await this.limiter.isPaused(source)) {
                await this.queue.deferLease(foodId, DEFER_PAUSE_SECONDS);
                this.logger.warn('refresh-defer-paused', { foodId, source });

                return 'deferred';
            }

            const window = await this.limiter.tryRecord(source);

            if (!window.allowed) {
                await this.queue.deferLease(foodId, DEFER_PAUSE_SECONDS);
                this.logger.warn('refresh-defer-window-full', { foodId, source });

                return 'deferred';
            }

            const current = await this.refetchItem(item);

            if (current && current.itemVersion !== item.itemVersion) {
                changed.push(current);
            }
        }

        if (changed.length > 0) {
            await this.merge.mergeChangedSources({ foodId, changed });
            this.logger.info('refresh-applied', { foodId, changed: changed.length });
        }

        await this.queue.resolve(foodId);
        await this.events.publishFoodFetchCompleted({ id: foodId, status: 'RESOLVED' });

        return 'refreshed';
    }

    /**
     * Re-fetch one backing item for the refresh compare, swallowing a source/validation error (the item
     * is skipped this cycle and its field(s) are left intact — no overwrite, MOD-020 error table).
     *
     * @param item - The backing crosswalk row.
     * @returns The re-fetched candidate, or `undefined` when the re-fetch failed validation/transport.
     * @sideEffect Performs a source fetch via the adapter.
     */
    private async refetchItem(item: FoodSourceRow): Promise<CanonicalCandidate | undefined> {
        try {
            return await this.registry.adapterFor(item.source).fetchByKey(item.externalKey);
        } catch (error) {
            if (isSourceApiError(error) || isAdapterValidationError(error)) {
                this.logger.warn('refresh-refetch-skipped', { foodId: item.foodId, source: item.source });

                return undefined;
            }

            throw error;
        }
    }

    /**
     * Revert orphaned `in_flight` leases back to `pending` (the reaper, T-153 — run at start + every
     * minute by {@link WorkerRuntime}).
     *
     * @returns The number of reclaimed rows.
     * @sideEffect Updates `fetch_queue`.
     */
    public async reapStaleLeases(): Promise<number> {
        return this.queue.reapExpiredLeases(this.leaseSeconds);
    }

    /**
     * Fan out by name across every wired adapter (T-152), per-source rolling-window-gated (T-122/T-152):
     * a 90% pause or a full window DEFERS the whole row (no `attempts++`, DSN-5); a source `429`
     * marks the window full + defers; a 5xx/timeout counts as a real failure for that source; a 404 /
     * other 4xx is "this source doesn't have it" (no contribution, no failure). Collected hits are
     * pulled via the adapter's ≤20-key BATCH (T-155) with a per-key fallback.
     *
     * @param foodId - The leased food id (for defer bookkeeping).
     * @param name - The stable fan-out query (`normalized_name`).
     * @returns Either a `deferred` signal or the collected candidates + real-failure count.
     * @sideEffect Calls sources, charges the rolling window, may defer the queue row.
     */
    private async fanOut(foodId: string, name: string): Promise<FanOutResult> {
        const candidates: CanonicalCandidate[] = [];
        let failedSources = 0;

        for (const adapter of this.registry.adapters()) {
            const source = adapter.source;

            // Soft 90% pause → defer the whole row (keep headroom for reads/resolves). Not a failure.
            if (await this.limiter.isPaused(source)) {
                await this.queue.deferLease(foodId, DEFER_PAUSE_SECONDS);
                this.logger.warn('defer-paused', { foodId, source });

                return { kind: 'deferred' };
            }

            // Atomically charge the window (the searchByName + batch fetch = ONE windowed call).
            const window = await this.limiter.tryRecord(source);

            if (!window.allowed) {
                await this.queue.deferLease(foodId, DEFER_PAUSE_SECONDS);
                this.logger.warn('defer-window-full', { foodId, source });

                return { kind: 'deferred' };
            }

            try {
                const hits = await adapter.searchByName(name);

                if (hits.length === 0) {
                    continue;
                }

                const fetched = await this.fetchCandidates(
                    adapter,
                    hits.map((hit) => hit.externalKey),
                );
                candidates.push(...fetched);
            } catch (error) {
                if (isSourceApiError(error)) {
                    if (
                        error.statusCode === 429 ||
                        error.statusCode === 502 ||
                        error.statusCode === 503 ||
                        error.statusCode === 504
                    ) {
                        // Authoritative source/gateway BACKPRESSURE — rate-limited (429), bad-gateway (502),
                        // unavailable (503), or gateway-timeout (504): the source is telling us it's
                        // overwhelmed, so pause the WHOLE source + defer. NOT a per-food failure → no
                        // attempts++ (DSN-5). (Schema drift is mapped to 422, so 502 here is only a real
                        // gateway 502.)
                        this.limiter.markWindowFull(source);
                        await this.queue.deferLease(foodId, DEFER_429_SECONDS);
                        this.logger.warn('defer-backpressure', { foodId, source, statusCode: error.statusCode });

                        return { kind: 'deferred' };
                    }

                    if (error.statusCode === 0) {
                        // Client timeout / transport failure. Defer ONLY THIS food — do NOT markWindowFull:
                        // one item timing out is weak evidence of source-wide distress, and a source-wide
                        // pause would let a single always-timing-out food stall every healthy one. This is
                        // self-inflicted latency under our own concurrency, not a per-food defect → no
                        // attempts++ (so a transient timeout can't burn the failure budget / tombstone a
                        // good food). The reduced worker concurrency + rolling window shed the actual load.
                        await this.queue.deferLease(foodId, DEFER_TIMEOUT_SECONDS);
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

        return { kind: 'collected', candidates, failedSources };
    }

    /**
     * Fetch the resolved keys for a source, preferring the adapter's ≤20-key BATCH (T-155, 1 windowed
     * call) and falling back to per-key {@link FoodSourceAdapter.fetchByKey} when the adapter exposes no
     * batch method. A candidate failing adapter validation is dropped (reject-not-store, FR-ADP-2).
     *
     * @param adapter - The source adapter.
     * @param keys - The opaque keys to fetch.
     * @returns The validated canonical candidates.
     * @sideEffect Performs source fetches via the adapter.
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
     * sink the rest (reject-not-store). A {@link SourceApiError} propagates to {@link fanOut}.
     *
     * @param adapter - The source adapter (for the per-key recovery fallback).
     * @param batch - The bound batch fetch.
     * @param keys - The opaque keys to fetch.
     * @returns The validated canonical candidates.
     * @sideEffect Performs batched source fetches via the adapter.
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
     * Tombstone a food `FAILED` after the retry budget is exhausted (FR-027): set the lifecycle, mark
     * the queue row a tombstone, and emit BOTH `FoodFetchCompleted` and `FetchFailed` (the alarm fires
     * on FAILED only, DSN-9).
     *
     * @param foodId - The food id.
     * @param attempts - The exhausted real-failure count.
     * @param lastError - A sanitized terminal error detail.
     * @returns The `failed` disposition.
     * @sideEffect Updates `food`/`fetch_queue`; emits two events.
     */
    private async tombstoneFailed(foodId: string, attempts: number, lastError: string): Promise<ProcessDisposition> {
        await this.foodDao.setStatus({ id: foodId, status: 'FAILED' });
        await this.queue.tombstone(foodId, lastError);
        await this.events.publishFoodFetchCompleted({ id: foodId, status: 'FAILED' });
        await this.events.publishFetchFailed({ id: foodId, attempts, lastError });
        this.logger.error('tombstone-failed', { foodId, attempts });

        return 'failed';
    }
}
