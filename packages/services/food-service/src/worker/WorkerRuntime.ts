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
import { DEFAULT_REAP_INTERVAL_MS } from './reapInterval.js';
import { RoutedWorkerLogger } from './RoutedWorkerLogger.js';
import { type WorkerLogger } from './workerLogger.js';
import { acquireWorkerLock, releaseWorkerLock, type LockSession } from './workerLock.js';
import type { FoodConsumerService } from './foodConsumer.service.js';

/** The Postgres `LISTEN/NOTIFY` channel the enqueue path notifies (FR-017). */
export const FETCH_QUEUED_CHANNEL = 'fetch_queued';

/**
 * How long `stop` waits for the in-flight drain to wind down before releasing leases anyway.
 *
 * ⚠️ BOUNDED on purpose. A claim may legitimately run for the whole derived lease window
 * (`leaseWindow.ts`), which is far longer than the grace period ECS gives a task between `SIGTERM` and
 * `SIGKILL` — so waiting for the drain unconditionally would just be killed mid-wait, releasing nothing
 * and leaving the leases to the reaper. Waiting briefly catches the common case (a drain between foods)
 * and then gets on with the release; whatever is still running has its settle refused by its fence, which
 * is the outcome that is safe rather than the one that is tidy.
 */
const SHUTDOWN_DRAIN_GRACE_MS = 5_000;

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
    /**
     * The queue BACKSTOP (plan U13), run on the reaper's own tick.
     *
     * ⛔ It rides this timer rather than getting its own scheduled function, and that buys something a
     * separate function could not have: **its silence is the drainer's dead-man signal.** If the drainer
     * stops, the check stops with it, so a monitor expecting a check-in reports the drainer's death rather
     * than only its symptoms. A separate function would keep reporting cheerfully about a queue nobody was
     * draining.
     *
     * Optional so every existing composition root and the whole test suite keep working unchanged.
     */
    readonly runQueueCheck?: () => Promise<void>;
}

export class WorkerRuntime {
    private readonly lockSession: LockSession;
    private readonly listenSession: ListenSession;
    private readonly consumer: FoodConsumerService;
    private readonly queue: FetchQueueDao;
    private readonly logger: WorkerLogger;
    private readonly emitMetricsSnapshot: (() => Promise<void>) | undefined;
    private readonly reapIntervalMs: number;
    private readonly queueCheck: (() => Promise<void>) | undefined;

    private holdsLock = false;

    /**
     * Whether this instance currently holds the drainer lock.
     *
     * Exposed because "am I the drainer?" is an observable fact about the process, not an implementation
     * detail: a standby that took over and a standby that is still waiting look identical from outside
     * otherwise, which is precisely the state FR-022's takeover has to be able to prove.
     */
    public get isDraining(): boolean {
        return this.holdsLock;
    }
    private draining = false;
    private redrainRequested = false;

    /** Set once `stop` begins: no new drain may start, and `stop` awaits the one already running. */
    private stopping = false;

    /** The drain currently running, so `stop` can wait for it rather than releasing leases underneath it. */
    private activeDrain: Promise<void> | undefined;
    private reapTimer: NodeJS.Timeout | undefined;

    /** Set only while this instance is a STANDBY, retrying the lock on the reaper interval (FR-022). */
    private standbyTimer: NodeJS.Timeout | undefined;
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
        this.logger = deps.logger ?? new RoutedWorkerLogger();
        this.emitMetricsSnapshot = deps.emitMetricsSnapshot;
        this.reapIntervalMs = deps.reapIntervalMs ?? DEFAULT_REAP_INTERVAL_MS;
        this.queueCheck = deps.runQueueCheck;
    }

    /**
     * Best-effort operational-metrics snapshot (T-181). A snapshot failure is logged and swallowed so a
     * metrics/DB hiccup never stalls the single drainer.
     *
     * @sideEffect Emits EMF metric lines via the injected snapshot callback.
     */
    /**
     * Run the queue backstop, best-effort (plan U13).
     *
     * ⛔ SWALLOWED, exactly as the metrics snapshot is. A backstop is the LEAST important thing this process
     * does — it reports on work rather than doing any — so a failure inside it must never stall the drainer
     * it is watching. That would be the observability equivalent of a smoke alarm starting the fire.
     *
     * @sideEffect Reads the database; may emit one Sentry event.
     */
    private async runCheck(): Promise<void> {
        if (!this.queueCheck) {
            return;
        }

        try {
            await this.queueCheck();
        } catch (error) {
            this.logger.warn('queue-check-failed', { error: String(error) });
        }
    }

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
            // ⛔ A STANDBY RETRIES. FR-022 says the other instances "stand by", and standing by means being
            // ready to take over — this returned false and never asked again, so the lock holder dying left
            // the queue with no drainer at all until something restarted the task. The retry runs on the
            // reaper interval, which is already the cadence at which this worker is willing to touch the
            // database, and `pg_try_advisory_lock` is a cheap non-blocking call.
            this.logger.info('standby', { reason: 'worker-lock-held-elsewhere' });
            this.standbyTimer = setInterval(() => {
                void this.start()
                    .then((acquired) => {
                        if (acquired && this.standbyTimer !== undefined) {
                            clearInterval(this.standbyTimer);
                            this.standbyTimer = undefined;
                        }
                    })
                    .catch((error: unknown) => this.logger.error('standby-retry-failed', { error: String(error) }));
            }, this.reapIntervalMs);
            this.standbyTimer.unref();

            return false;
        }

        if (this.standbyTimer !== undefined) {
            clearInterval(this.standbyTimer);
            this.standbyTimer = undefined;
        }

        this.logger.info('lock-acquired');
        this.listenSession.on('notification', this.onNotification);
        await this.listenSession.query(`LISTEN ${FETCH_QUEUED_CHANNEL}`);

        // Reaper at start (FR-018) + an initial drain to catch rows enqueued before this worker came up.
        await this.consumer.reapStaleLeases();
        await this.wake();
        await this.snapshotMetrics();
        await this.runCheck();

        this.reapTimer = setInterval(() => {
            void this.consumer
                .reapStaleLeases()
                .then(() => this.wake())
                .then(() => this.snapshotMetrics())
                .then(() => this.runCheck())
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
        this.stopping = true;
        // Stop claiming BEFORE anything else: every tick from here on is work that will be thrown away.
        this.consumer.halt();

        if (this.reapTimer) {
            clearInterval(this.reapTimer);
            this.reapTimer = undefined;
        }

        // A standby has no leases and no lock, but it does have a retry timer, and SIGTERM must stop it
        // reaching for a lock the task is about to stop being able to hold.
        if (this.standbyTimer) {
            clearInterval(this.standbyTimer);
            this.standbyTimer = undefined;
        }

        this.listenSession.removeListener('notification', this.onNotification);

        try {
            await this.listenSession.query(`UNLISTEN ${FETCH_QUEUED_CHANNEL}`);
        } catch (error) {
            this.logger.warn('unlisten-failed', { error: String(error) });
        }

        // Let the in-flight drain finish before pulling its leases out from under it. Since U5 a release
        // invalidates a live claim's fence, so releasing first would refuse the settle of every food this
        // worker was mid-way through — throwing away completed USDA fetches on every ordinary deploy.
        if (this.activeDrain) {
            const graceful = await Promise.race([
                this.activeDrain.then(() => true),
                new Promise<boolean>((resolve) => {
                    setTimeout(() => resolve(false), SHUTDOWN_DRAIN_GRACE_MS).unref();
                }),
            ]);

            if (!graceful) {
                this.logger.warn('drain-still-running-at-shutdown', { graceMs: SHUTDOWN_DRAIN_GRACE_MS });
            }
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

        if (this.stopping) {
            // A wake in flight when SIGTERM arrived must not start work the shutdown is about to abandon.
            return;
        }

        this.draining = true;
        this.activeDrain = this.runDrain();

        try {
            await this.activeDrain;
        } finally {
            this.activeDrain = undefined;
            this.draining = false;
        }
    }

    /**
     * The drain loop itself, re-running while a wake arrived mid-pass.
     *
     * Split out of {@link wake} so the promise can be HELD (`activeDrain`) — `stop` waits on it before
     * releasing leases, and a promise you only `await` inline is one nothing else can wait for.
     *
     * @sideEffect Drains the queue via the consumer.
     */
    private async runDrain(): Promise<void> {
        try {
            do {
                this.redrainRequested = false;
                await this.consumer.drain();
            } while (this.redrainRequested && !this.stopping);
        } catch (error) {
            this.logger.error('drain-failed', { error: error instanceof Error ? error.message : 'unknown' });
        }
    }
}
