/**
 * U13 — the food backstop (R29/R30/R38).
 *
 * ⛔ "SLOW IS NOT LOST" is what these cases are really about. A backlog of owed rows looks identical whether
 * the queue is draining steadily behind it or nothing is carrying the work at all, and the difference is
 * entirely in the transport. Escalating a healthy backlog trains its reader to ignore the signal, which is
 * worse than not having one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runQueueCheck, type FoodOwedCounts } from '../queueCheck.js';

/** A quiet queue: nothing owed, nothing stranded. Each case perturbs one dimension. */
const QUIET: FoodOwedCounts = {
    staleLeases: 0,
    pendingWithNoRow: 0,
    claimablePending: 0,
    inFlight: 0,
    failedTombstones: 0,
    oldestPendingSeconds: 0,
};

/** 01:00 in New York — the hours a non-prod stage used to be silent in, before its clock was deleted. */
const SMALL_HOURS = new Date('2026-07-15T05:00:00Z');

function subject(counts: Partial<FoodOwedCounts>, stage = 'sandbox') {
    const escalate = vi.fn();
    const checkIn = vi.fn();
    const read = vi.fn().mockResolvedValue({ ...QUIET, ...counts });

    return { escalate, checkIn, read, deps: { stage, counts: read, escalate, checkIn } };
}

describe('the food queue check', () => {
    it('says nothing about a quiet queue', async () => {
        const { deps, escalate } = subject({});

        expect(await runQueueCheck(deps)).toBeUndefined();
        expect(escalate).not.toHaveBeenCalled();
    });

    /**
     * ⛔ A `PENDING` food with NO queue row is the lost case exactly: the row that would carry it does not
     * exist, so nothing is coming for it and no amount of waiting changes that. This is the condition the
     * whole backstop exists for.
     */
    it('⛔ a PENDING food with no queue row escalates as LOST', async () => {
        const { deps, escalate } = subject({ pendingWithNoRow: 3, oldestPendingSeconds: 900 });

        const payload = await runQueueCheck(deps);

        expect(payload?.condition).toBe('lost');
        expect(payload?.owedCount).toBe(3);
        expect(escalate).toHaveBeenCalledTimes(1);
    });

    it('⛔ the same owed rows behind a MOVING queue are DELAYED, not lost', async () => {
        const { deps } = subject({ pendingWithNoRow: 3, claimablePending: 40, oldestPendingSeconds: 900 });

        expect((await runQueueCheck(deps))?.condition).toBe('delayed');
    });

    it('a queue row within its lease produces no escalation', async () => {
        const { deps, escalate } = subject({ inFlight: 1, claimablePending: 2 });

        expect(await runQueueCheck(deps)).toBeUndefined();
        expect(escalate).not.toHaveBeenCalled();
    });

    it('a lease the reaper should have reclaimed escalates as STUCK', async () => {
        expect((await runQueueCheck(subject({ staleLeases: 2 }).deps))?.condition).toBe('stuck');
    });

    it('FAILED tombstones are the dead-letter analog and outrank everything', async () => {
        const { deps } = subject({ failedTombstones: 1, staleLeases: 5, pendingWithNoRow: 5 });

        expect((await runQueueCheck(deps))?.condition).toBe('dead-lettered');
    });

    /**
     * ⛔ THE CLOCK IS GONE (owner ruling 2026-10-12: queue checks "should only be enabled when the sandbox is up
     * for that PR"). The check used to return before any database call between 00:00 and 09:00 ET on a non-prod
     * stage. Now an invoked check reads and reports at any hour on any stage; whether it is invoked is a matter of
     * whether its worker is running, which is a matter of whether the sandbox is up. Run at 01:00 ET so a clock
     * gate re-added anywhere in the path turns the sandbox and preview cases red.
     */
    describe.each(['sandbox', 'pr-91', 'prod'])('at 01:00 New York on %s', (stage) => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it('⛔ reads the database and raises what it finds', async () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(SMALL_HOURS);
            const { deps, escalate, read } = subject({ pendingWithNoRow: 1 }, stage);

            expect((await runQueueCheck(deps))?.condition).toBe('lost');
            expect(read).toHaveBeenCalledTimes(1);
            expect(escalate).toHaveBeenCalledTimes(1);
        });
    });

    it('⛔ a preview escalates WITHOUT checking in — its monitor would outlive its stack', async () => {
        const { deps, escalate, checkIn } = subject({ pendingWithNoRow: 2, oldestPendingSeconds: 600 }, 'pr-91');

        await runQueueCheck(deps);

        expect(escalate).toHaveBeenCalledTimes(1);
        expect(checkIn).not.toHaveBeenCalled();
    });

    it('⛔ does not check in when the read fails — the rejection IS the signal', async () => {
        const checkIn = vi.fn();

        await expect(
            runQueueCheck({
                stage: 'prod',
                counts: vi.fn().mockRejectedValue(new Error('database unreachable')),
                escalate: vi.fn(),
                checkIn,
            }),
        ).rejects.toThrow('database unreachable');

        expect(checkIn).not.toHaveBeenCalled();
    });
});
