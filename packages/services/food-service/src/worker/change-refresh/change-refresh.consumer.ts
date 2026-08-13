/**
 * `ChangeRefreshConsumer` (T-170 / T-172, MOD-020 / ARCH-018) — the change-driven refresh task. It is the
 * **producer + idle-drainer** of refresh work, NOT a second re-pull engine: the selective per-item re-pull
 * + manual-pick preservation lives in exactly one place, the worker's refresh branch
 * (`FoodConsumerService.refreshResolvedFood`, DSN-4). This task:
 *
 *   1. **Expires stale UNRESOLVED candidate sets** (T-172 / FR-025a): drops every `food_candidates` set
 *      older than `FOOD_UNRESOLVED_TTL_DAYS` (default 30). The owning food STAYS `UNRESOLVED` — it is
 *      never swept to `NOT_FOUND`; the next add-by-name re-fans-out against the normal budget.
 *   2. **Scans RESOLVED foods' backing items** (T-170 / FR-031/FR-032): for each `food_sources` item of a
 *      `RESOLVED` food (NOT_FOUND/FAILED tombstones are excluded by the status filter), re-fetches by
 *      `external_key` (per-source rolling-window-gated so it can never breach a source budget and yields
 *      to live demand by pausing at the 90% mark) and compares `item_version`. A food with an upstream
 *      change is re-enqueued via the **ordinary** `EnqueueEmitter.publishFoodRequested` path as a
 *      low-demand `svc_change_refresh` row (deduped via `ON CONFLICT`) — there is no separate
 *      low-priority tier. The worker then drains it through its refresh branch.
 *
 * Runs as a **Fargate scheduled task** triggered by the EventBridge `IngestionScheduled` schedule; the
 * EventBridge-schedule → ECS `RunTask` target + IAM roles + task definition are provisioned by the infra
 * slice (T-001c) and are **out of scope here** — this module exposes the runnable `runOnce` entry.
 * Idle-drain, budget-bounded; cadence is not a fixed promise.
 *
 * @implements FR-025a FR-031 FR-032
 */
import { settingFromEnv } from '../../config/env.schema.js';
import { CandidateStore } from '../../foods/dao/food-candidates.dao.js';
import { FoodSourcesDao } from '../../foods/dao/food-sources.dao.js';
import { EnqueueEmitter } from '../../foods/enqueue.emitter.js';
import {
    isAdapterValidationError,
    isSourceApiError,
    SourceAdapterRegistry,
} from '../../sources/food-source-adapter.js';
import { RollingWindowLimiter } from '../../sources/rolling-window-limiter.js';
import { ConsoleWorkerLogger, type WorkerLogger } from '../worker-logger.js';

/** The named service principal recorded as the refresh requester (FR-048 — never a `'system'` shortcut). */
export const SVC_CHANGE_REFRESH = 'svc_change_refresh';

/** Default per-run scan budget — max backing items re-fetched in one scheduled pass (budget-bounded). */
const DEFAULT_SCAN_LIMIT = 1000;

/** The outcome of one scheduled change-refresh pass. */
export interface ChangeRefreshResult {
    /** Distinct `RESOLVED` foods re-enqueued because a backing item changed upstream. */
    readonly enqueued: number;
    /** `food_candidates` rows cleared by the UNRESOLVED-TTL sweep. */
    readonly expiredCandidateRows: number;
    /** Backing items scanned before the budget / window pause stopped the pass. */
    readonly scanned: number;
}

/** Constructor dependencies for {@link ChangeRefreshConsumer}. */
export interface ChangeRefreshConsumerDeps {
    /** Crosswalk DAO — the source of the RESOLVED-foods backing-item scan. */
    readonly sources: FoodSourcesDao;
    /** Candidate store — the UNRESOLVED-TTL sweep target (T-172). */
    readonly candidates: CandidateStore;
    /** Wired source adapters (the re-fetch-by-key compare). */
    readonly registry: SourceAdapterRegistry;
    /** Per-source rolling-window limiter (the scan is budget-bounded + yields to live demand). */
    readonly limiter: RollingWindowLimiter;
    /** Ordinary enqueue path (low-demand `svc_change_refresh` row + `pg_notify`). */
    readonly enqueue: EnqueueEmitter;
    /** Optional structured logger (defaults to a JSON console logger). */
    readonly logger?: WorkerLogger;
    /**
     * UNRESOLVED candidate-set TTL in days. Defaults to the CONFIGURED `FOOD_UNRESOLVED_TTL_DAYS` (30 when
     * unset) resolved inside the constructor, not at the composition root: this task has no `ConfigModule`
     * and nothing validates its environment at boot, so a root that forgot to pass the value would sweep on
     * a built-in default and silently ignore the operator. The override exists for tests.
     */
    readonly unresolvedTtlDays?: number;
    /** Per-run scan budget (default {@link DEFAULT_SCAN_LIMIT}). */
    readonly scanLimit?: number;
}

export class ChangeRefreshConsumer {
    private readonly sources: FoodSourcesDao;
    private readonly candidates: CandidateStore;
    private readonly registry: SourceAdapterRegistry;
    private readonly limiter: RollingWindowLimiter;
    private readonly enqueue: EnqueueEmitter;
    private readonly logger: WorkerLogger;
    private readonly unresolvedTtlDays: number;
    private readonly scanLimit: number;

    /** @param deps - The injected DAOs, registry, limiter, enqueue seam, and config. */
    public constructor(deps: ChangeRefreshConsumerDeps) {
        this.sources = deps.sources;
        this.candidates = deps.candidates;
        this.registry = deps.registry;
        this.limiter = deps.limiter;
        this.enqueue = deps.enqueue;
        this.logger = deps.logger ?? new ConsoleWorkerLogger();
        this.unresolvedTtlDays = deps.unresolvedTtlDays ?? settingFromEnv('FOOD_UNRESOLVED_TTL_DAYS');
        this.scanLimit = deps.scanLimit ?? DEFAULT_SCAN_LIMIT;
    }

    /**
     * Run one scheduled change-refresh pass: sweep expired UNRESOLVED candidate sets (T-172), then scan
     * RESOLVED foods' backing items and re-enqueue the ones that changed upstream (T-170).
     *
     * @returns The pass outcome (enqueued foods, expired candidate rows, items scanned).
     * @sideEffect Deletes expired `food_candidates`, charges the rolling window, calls sources, and
     *   enqueues low-demand `fetch_queue` rows (with `pg_notify`).
     */
    public async runOnce(): Promise<ChangeRefreshResult> {
        const expiredCandidateRows = await this.candidates.clearExpired(this.unresolvedTtlDays);

        if (expiredCandidateRows > 0) {
            this.logger.info('unresolved-ttl-swept', { expiredCandidateRows, ttlDays: this.unresolvedTtlDays });
        }

        const items = await this.sources.listResolvedBackingItems(this.scanLimit);
        const enqueued = new Set<string>();
        let scanned = 0;

        for (const item of items) {
            const source = item.source;

            // Yield to live demand: pause the scan once the window nears its ceiling (budget-bounded).
            if (await this.limiter.isPaused(source)) {
                this.logger.info('change-refresh-yield', { source, scanned });

                break;
            }

            const window = await this.limiter.tryRecord(source);

            if (!window.allowed) {
                break;
            }

            scanned += 1;

            const adapter = this.registry.adapterFor(source);
            let currentVersion: string | null;

            try {
                currentVersion = (await adapter.fetchByKey(item.externalKey)).itemVersion;
            } catch (error) {
                if (isSourceApiError(error) || isAdapterValidationError(error)) {
                    // Skip this item this cycle — retry on the next scheduled run (no enqueue, no overwrite).
                    this.logger.warn('change-refresh-compare-skipped', { foodId: item.foodId, source });

                    continue;
                }

                throw error;
            }

            if (currentVersion !== item.itemVersion && !enqueued.has(item.foodId)) {
                // Re-enqueue via the ORDINARY low-demand path (ON CONFLICT dedup); the worker's refresh
                // branch re-derives the changed set authoritatively at drain time (DSN-4).
                await this.enqueue.publishFoodRequested({
                    id: item.foodId,
                    requestedBy: SVC_CHANGE_REFRESH,
                    reactivate: true,
                });
                enqueued.add(item.foodId);
                this.logger.info('change-refresh-enqueued', { foodId: item.foodId, source });
            }
        }

        return { enqueued: enqueued.size, expiredCandidateRows, scanned };
    }
}
