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
 * defer or a 429 back-off (those `deferLease`, DSN-5). The change-refresh branch for an already-RESOLVED
 * food (DSN-4) is out of THIS slice (Phase 8); such a row is logged + acked without a re-fan-out so a
 * stray RESOLVED row cannot burn the source budget.
 *
 * @implements FR-015 FR-016 FR-018 FR-019 FR-023 FR-024 FR-025 FR-026 FR-027 FR-MRG-1 FR-MRG-4 FR-ADP-1
 */
import type { FetchQueueRow } from '../db/schema/index.js';
import type { FoodEventPublisher } from '../events/food-event-emitter.js';
import { FetchQueueDao } from '../foods/dao/fetch-queue.dao.js';
import { FoodDao } from '../foods/dao/food.dao.js';
import { MergeAndPersistService } from '../foods/merge/merge-and-persist.service.js';
import {
    isAdapterValidationError,
    isSourceApiError,
    SourceAdapterRegistry,
    type CanonicalCandidate,
    type FoodSourceAdapter,
} from '../sources/food-source-adapter.js';
import { RollingWindowLimiter } from '../sources/rolling-window-limiter.js';
import { isRetryBudgetExhausted } from './backoff.js';
import { ConsoleWorkerLogger, type WorkerLogger } from './worker-logger.js';

/** Max keys pulled in one batch source call (USDA's `POST /v1/foods` cap; counts as 1 windowed call). */
const FETCH_BATCH_MAX = 20;

/** Seconds a row is deferred on a 90%-pause / window-full back-pressure (DSN-5 — no `attempts++`). */
const DEFER_PAUSE_SECONDS = 30;

/** Seconds a row is deferred after a source `429` (matches the limiter's 429 failsafe back-off). */
const DEFER_429_SECONDS = 60;

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
    | 'refresh_skipped'; // a RESOLVED row reached the drainer (change-refresh, out of this slice) → acked

/** Constructor dependencies for {@link FoodConsumerService}. */
export interface FoodConsumerDeps {
    /** Golden-record / lifecycle DAO. */
    readonly foodDao: FoodDao;
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
    /** Lease window in seconds (default 30). */
    readonly leaseSeconds?: number;
}

export class FoodConsumerService {
    private readonly foodDao: FoodDao;
    private readonly queue: FetchQueueDao;
    private readonly registry: SourceAdapterRegistry;
    private readonly limiter: RollingWindowLimiter;
    private readonly merge: MergeAndPersistService;
    private readonly events: FoodEventPublisher;
    private readonly logger: WorkerLogger;
    private readonly leaseSeconds: number;

    /** @param deps - The injected DAOs, registry, limiter, merge seam, and event publisher. */
    public constructor(deps: FoodConsumerDeps) {
        this.foodDao = deps.foodDao;
        this.queue = deps.queue;
        this.registry = deps.registry;
        this.limiter = deps.limiter;
        this.merge = deps.merge;
        this.events = deps.events;
        this.logger = deps.logger ?? new ConsoleWorkerLogger();
        this.leaseSeconds = deps.leaseSeconds ?? 30;
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

        try {
            return await this.processRow(row);
        } catch (error) {
            // An UNEXPECTED processing failure (e.g. a DB upsert error) — a genuine failure that
            // consumes the FR-016 retry budget with backoff (DSN-5). No upstream detail is leaked.
            const failed = await this.queue.recordFailure(row.foodId, 'processing_error');
            this.logger.error('processing-error', {
                foodId: row.foodId,
                attempts: failed.attempts,
                error: error instanceof Error ? error.message : 'unknown',
            });

            if (isRetryBudgetExhausted(failed.attempts)) {
                return this.tombstoneFailed(row.foodId, failed.attempts, 'processing_error');
            }

            return 'record_failure';
        }
    }

    /**
     * Drain the queue until nothing is eligible (T-151) — invoked on a NOTIFY wake or poll interval.
     *
     * @returns The number of rows processed before the queue drained.
     * @sideEffect Repeatedly leases + processes `fetch_queue` rows.
     */
    public async drain(): Promise<number> {
        let processed = 0;

        for (;;) {
            const disposition = await this.processNext();

            if (disposition === 'idle') {
                break;
            }

            processed += 1;
        }

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

        // Change-refresh branch (DSN-4) is OUT of this slice (Phase 8): a RESOLVED food only reaches the
        // drainer because the change-refresh scheduler re-enqueued it. Ack it without a name re-fan-out so
        // a stray RESOLVED row can never burn the scarce per-source budget here.
        if (food.status === 'RESOLVED') {
            this.logger.info('refresh-skipped', { foodId });
            await this.queue.resolve(foodId);

            return 'refresh_skipped';
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
                    if (error.statusCode === 429) {
                        // Source rate-limited despite our limiter → back off; back-pressure, not a failure.
                        this.limiter.markWindowFull(source);
                        await this.queue.deferLease(foodId, DEFER_429_SECONDS);
                        this.logger.warn('defer-429', { foodId, source });

                        return { kind: 'deferred' };
                    }

                    if (error.statusCode >= 500 || error.statusCode === 0) {
                        // 5xx / timeout = a REAL failure for this source (consumes the budget, FR-016/DSN-5).
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
