/**
 * `WorkerRuntime` (T-150) — the long-running shell around {@link FoodConsumerService}: single-instance
 * gating via the Postgres advisory lock (FR-022), the `LISTEN fetch_queued` wake (drains within
 * ≤100ms of a NOTIFY), the periodic + at-start lease reaper (FR-018), and graceful `SIGTERM` handling
 * that releases this worker's in-flight leases so a replacement can re-claim them at once.
 *
 * Drains are serialized through a single in-flight guard so a NOTIFY burst can never run two
 * overlapping drain loops on the one drainer.
 *
 * @implements FR-017 FR-018 FR-022
 */
import type { Notification, PoolClient } from 'pg';

import type { FetchQueueDao } from '../foods/dao/fetchQueue.dao.js';
import { ConsoleWorkerLogger, type WorkerLogger } from './workerLogger.js';
import { acquireWorkerLock, releaseWorkerLock, type LockSession } from './workerLock.js';
import type { FoodConsumerService } from './foodConsumer.service.js';

/** The Postgres `LISTEN/NOTIFY` channel the enqueue path notifies (FR-017). */
export const FETCH_QUEUED_CHANNEL = 'fetch_queued';

/** Default reaper cadence (ms) — the reaper also runs once at start (FR-018). */
const DEFAULT_REAP_INTERVAL_MS = 60_000;

/** A `LISTEN`-capable session: a checked-out client that emits `notification` events. */
export type ListenSession = Pick<PoolClient, 'query' | 'on' | 'removeListener'>;

/** Constructor dependencies for {@link WorkerRuntime}. */
export interface WorkerRuntimeDeps {
    /** The dedicated session that holds the single-drainer advisory lock (FR-022). */
    readonly lockSession: LockSession;
    /** The dedicated session that runs `LISTEN fetch_queued` and emits wake notifications. */
    readonly listenSession: ListenSession;
    /** The per-row fan-out/merge logic. */
    readonly consumer: FoodConsumerService;
    /** The queue DAO (used for the SIGTERM in-flight lease release). */
    readonly queue: FetchQueueDao;
    /** Optional structured logger. */
    readonly logger?: WorkerLogger;
    /**
     * Optional best-effort operational-metrics snapshot (T-181). Invoked once at start and on each
     * reaper tick; a failure is logged and swallowed (a metrics hiccup must never stall the drainer).
     */
    readonly emitMetricsSnapshot?: () => Promise<void>;
    /** Reaper cadence in ms (default 60s). */
    readonly reapIntervalMs?: number;
}

export class WorkerRuntime {
    private readonly lockSession: LockSession;
    private readonly listenSession: ListenSession;
    private readonly consumer: FoodConsumerService;
    private readonly queue: FetchQueueDao;
    private readonly logger: WorkerLogger;
    private readonly emitMetricsSnapshot: (() => Promise<void>) | undefined;
    private readonly reapIntervalMs: number;

    private holdsLock = false;
    private draining = false;
    private redrainRequested = false;
    private reapTimer: NodeJS.Timeout | undefined;
    private readonly onNotification = (message: Notification): void => {
        if (message.channel === FETCH_QUEUED_CHANNEL) {
            void this.wake();
        }
    };

    /** @param deps - The lock/listen sessions, consumer, queue DAO, and options. */
    public constructor(deps: WorkerRuntimeDeps) {
        this.lockSession = deps.lockSession;
        this.listenSession = deps.listenSession;
        this.consumer = deps.consumer;
        this.queue = deps.queue;
        this.logger = deps.logger ?? new ConsoleWorkerLogger();
        this.emitMetricsSnapshot = deps.emitMetricsSnapshot;
        this.reapIntervalMs = deps.reapIntervalMs ?? DEFAULT_REAP_INTERVAL_MS;
    }

    /**
     * Best-effort operational-metrics snapshot (T-181). A snapshot failure is logged and swallowed so a
     * metrics/DB hiccup never stalls the single drainer.
     *
     * @sideEffect Emits EMF metric lines via the injected snapshot callback.
     */
    private async snapshotMetrics(): Promise<void> {
        if (!this.emitMetricsSnapshot) {
            return;
        }

        try {
            await this.emitMetricsSnapshot();
        } catch (error) {
            this.logger.warn('metrics-snapshot-failed', { error: String(error) });
        }
    }

    /**
     * Acquire the single-drainer lock (FR-022). When acquired, begin `LISTEN`ing, run the at-start
     * reaper, do an initial drain, and arm the periodic reaper. When NOT acquired, another instance is
     * draining and this one stands by (returns `false`).
     *
     * @returns `true` when this instance acquired the lock and is now the drainer.
     * @sideEffect Acquires the advisory lock; subscribes to NOTIFY; starts the reaper timer.
     */
    public async start(): Promise<boolean> {
        this.holdsLock = await acquireWorkerLock(this.lockSession);

        if (!this.holdsLock) {
            this.logger.info('standby', { reason: 'worker-lock-held-elsewhere' });

            return false;
        }

        this.logger.info('lock-acquired');
        this.listenSession.on('notification', this.onNotification);
        await this.listenSession.query(`LISTEN ${FETCH_QUEUED_CHANNEL}`);

        // Reaper at start (FR-018) + an initial drain to catch rows enqueued before this worker came up.
        await this.consumer.reapStaleLeases();
        await this.wake();
        await this.snapshotMetrics();

        this.reapTimer = setInterval(() => {
            void this.consumer
                .reapStaleLeases()
                .then(() => this.wake())
                .then(() => this.snapshotMetrics())
                .catch((error: unknown) => this.logger.error('reaper-failed', { error: String(error) }));
        }, this.reapIntervalMs);
        this.reapTimer.unref();

        return true;
    }

    /**
     * Graceful shutdown (SIGTERM): stop the reaper + LISTEN, release this worker's in-flight leases so
     * a replacement re-claims them immediately (FR-017), and release the advisory lock.
     *
     * @sideEffect Releases leases + the advisory lock; unsubscribes from NOTIFY.
     */
    public async stop(): Promise<void> {
        if (this.reapTimer) {
            clearInterval(this.reapTimer);
            this.reapTimer = undefined;
        }

        this.listenSession.removeListener('notification', this.onNotification);

        try {
            await this.listenSession.query(`UNLISTEN ${FETCH_QUEUED_CHANNEL}`);
        } catch (error) {
            this.logger.warn('unlisten-failed', { error: String(error) });
        }

        // Release this worker's in-flight leases so a replacement re-claims them at once (FR-017).
        try {
            const released = await this.queue.releaseInFlight();

            if (released > 0) {
                this.logger.info('leases-released', { released });
            }
        } catch (error) {
            this.logger.error('lease-release-failed', { error: String(error) });
        }

        if (this.holdsLock) {
            try {
                await releaseWorkerLock(this.lockSession);
            } catch (error) {
                this.logger.warn('lock-release-failed', { error: String(error) });
            }

            this.holdsLock = false;
        }
    }

    /**
     * Run one full drain pass, guarded so overlapping NOTIFY wakes coalesce into a single re-drain
     * rather than running concurrent loops on the single drainer.
     *
     * @sideEffect Drains the queue via the consumer.
     */
    public async wake(): Promise<void> {
        if (this.draining) {
            // A drain is already running; coalesce this wake into a single follow-up re-drain.
            this.redrainRequested = true;

            return;
        }

        this.draining = true;

        try {
            do {
                this.redrainRequested = false;
                await this.consumer.drain();
            } while (this.redrainRequested);
        } catch (error) {
            this.logger.error('drain-failed', { error: error instanceof Error ? error.message : 'unknown' });
        } finally {
            this.draining = false;
        }
    }
}
