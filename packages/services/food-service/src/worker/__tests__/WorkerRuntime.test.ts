/**
 * {@link WorkerRuntime} with the database replaced by doubles: what `start` arms, and in what order.
 *
 * The real-database half (lock, LISTEN, takeover, lease release) is `tests/e2e/WorkerRuntime.e2e.test.ts`. This
 * file pins what that tier cannot see cheaply: whether the reaper tick is ARMED while the first drain is still
 * running. The queue check rides that tick and its silence is the drainer's dead-man signal, so a worker that
 * starts against a backlog must keep checking in for the whole of the first drain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FetchQueueDao } from '../../foods/dao/fetchQueue.dao.js';
import type { FoodConsumerService } from '../foodConsumer.service.js';
import { SilentWorkerLogger } from '../SilentWorkerLogger.js';
import { WorkerRuntime, type ListenSession } from '../WorkerRuntime.js';
import type { LockSession } from '../workerLock.js';

const REAP_INTERVAL_MS = 1_000;

/** A drain the test releases by hand, so "the first drain is still running" is a state the test can hold. */
function heldDrain(): { readonly drain: ReturnType<typeof vi.fn>; readonly finish: () => void } {
    let finish: () => void = () => undefined;
    const first = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const drain = vi.fn<() => Promise<void>>().mockImplementationOnce(async () => first);

    drain.mockResolvedValue(undefined);

    return { drain, finish };
}

function subject() {
    const { drain, finish } = heldDrain();
    const lockSession = {
        query: vi.fn(async (text: string) => ({
            rows: [text.includes('pg_try_advisory_lock') ? { locked: true } : { released: true }],
        })),
    } as unknown as LockSession;
    const listenSession = {
        query: vi.fn(async () => ({ rows: [] })),
        on: vi.fn(),
        removeListener: vi.fn(),
    } as unknown as ListenSession;
    const consumer = { reapStaleLeases: vi.fn(async () => 0), drain, halt: vi.fn() };
    const queue = { releaseInFlight: vi.fn(async () => 0) };
    const runQueueCheck = vi.fn(async () => undefined);
    const emitMetricsSnapshot = vi.fn(async () => undefined);
    const runtime = new WorkerRuntime({
        lockSession,
        listenSession,
        consumer: consumer as unknown as FoodConsumerService,
        queue: queue as unknown as FetchQueueDao,
        logger: new SilentWorkerLogger(),
        reapIntervalMs: REAP_INTERVAL_MS,
        runQueueCheck,
        emitMetricsSnapshot,
    });

    return { runtime, finish, runQueueCheck, emitMetricsSnapshot };
}

describe('WorkerRuntime.start — the tick is armed before the first drain ends', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('⛔ checks in at start and on every tick while the initial drain is still running', async () => {
        const { runtime, finish, runQueueCheck, emitMetricsSnapshot } = subject();

        const started = runtime.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(runQueueCheck).toHaveBeenCalledTimes(1);
        expect(emitMetricsSnapshot).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(REAP_INTERVAL_MS * 2);

        expect(runQueueCheck).toHaveBeenCalledTimes(3);
        expect(emitMetricsSnapshot).toHaveBeenCalledTimes(3);

        finish();
        await expect(started).resolves.toBe(true);
        await runtime.stop();
    });
});
