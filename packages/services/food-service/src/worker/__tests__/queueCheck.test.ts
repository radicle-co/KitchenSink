/**
 * U13 — the food backstop (R29/R30/R38).
 *
 * ⛔ "SLOW IS NOT LOST" is what these cases are really about. A backlog of owed rows looks identical whether
 * the queue is draining steadily behind it or nothing is carrying the work at all, and the difference is
 * entirely in the transport. Escalating a healthy backlog trains its reader to ignore the signal, which is
 * worse than not having one.
 */
import { describe, expect, it, vi } from 'vitest';

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

/** Mid-morning in New York — outside the nightly window, so the check runs. */
const AWAKE = new Date('2026-07-15T15:00:00Z');

/** 01:00 in New York — inside ADR-0007's nightly stop. */
const ASLEEP = new Date('2026-07-15T05:00:00Z');

function subject(counts: Partial<FoodOwedCounts>, stage = 'sandbox', now = AWAKE) {
    const escalate = vi.fn();
    const checkIn = vi.fn();
    const read = vi.fn().mockResolvedValue({ ...QUIET, ...counts });

    return { escalate, checkIn, read, deps: { stage, counts: read, escalate, checkIn, now: () => now } };
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
     * ⛔ THE NIGHTLY WINDOW, and the assertion that matters is that it reads NOTHING. ADR-0007 stops the
     * non-prod tier's RDS from 00:00 to 09:00, so a check that ran would find its database unreachable and
     * escalate every night in every preview — training its reader to mute the one signal that matters.
     */
    it('⛔ during the nightly window it makes NO database call and raises nothing', async () => {
        const midnightEt = new Date('2026-07-15T05:00:00Z'); // 01:00 in New York
        const { deps, escalate, read } = subject({ pendingWithNoRow: 99 }, 'sandbox', midnightEt);

        expect(await runQueueCheck(deps)).toBeUndefined();
        expect(read).not.toHaveBeenCalled();
        expect(escalate).not.toHaveBeenCalled();
    });

    /** ⛔ PROD is never asleep — it is never stopped, and a clock must not hide a real outage. */
    it('⛔ PROD checks during those same hours', async () => {
        const midnightEt = new Date('2026-07-15T05:00:00Z');
        const { deps, read } = subject({ pendingWithNoRow: 1 }, 'prod', midnightEt);

        expect((await runQueueCheck(deps))?.condition).toBe('lost');
        expect(read).toHaveBeenCalledTimes(1);
    });

    /**
     * ⛔ The payload carries counts and identifiers, never a food name or an ingredient phrase — a backstop
     * reads rows a user wrote, and a Sentry event is outside every erasure path.
     */
    it('⛔ the escalation carries no text', async () => {
        const { deps } = subject({ pendingWithNoRow: 1 });
        const payload = await runQueueCheck(deps);

        for (const value of Object.values(payload ?? {})) {
            expect(['string', 'number']).toContain(typeof value);
        }

        expect(payload?.service).toBe('food-service');
    });
});

/**
 * ⛔ THE DEAD-MAN CHECK-IN (R37), and for food it carries more than for the other two. Food's check does not
 * have a scheduled function of its own — it rides the drainer's reaper tick — so its check-in is a statement
 * about the DRAINER, not only about the backstop. A drainer that dies takes the check with it, the check-in
 * stops, and the monitor reports the drainer's death rather than waiting for its symptoms to accumulate.
 *
 * ⚠️ It fires on every run of the check, i.e. on the reaper cadence. The monitor's expected schedule is
 * configured Sentry-side (U23), which is where a coarser cadence belongs — not in a counter here that would
 * make the drainer's dead-man signal depend on state the drainer itself keeps.
 */
describe('the dead-man check-in', () => {
    it("⛔ checks in once the run completes, which is what makes the drainer's silence audible", async () => {
        const { deps, checkIn } = subject({}, 'prod');

        await runQueueCheck(deps);

        expect(checkIn).toHaveBeenCalledTimes(1);
    });

    it('⛔ still checks in when it DID find stranded work — the finding is not the failure', async () => {
        const { deps, escalate, checkIn } = subject({ pendingWithNoRow: 2, oldestPendingSeconds: 600 }, 'prod');

        await runQueueCheck(deps);

        expect(escalate).toHaveBeenCalledTimes(1);
        expect(checkIn).toHaveBeenCalledTimes(1);
    });

    it('⛔ a preview escalates WITHOUT checking in — its monitor would outlive its stack', async () => {
        const { deps, escalate, checkIn } = subject({ pendingWithNoRow: 2, oldestPendingSeconds: 600 }, 'pr-91');

        await runQueueCheck(deps);

        expect(escalate).toHaveBeenCalledTimes(1);
        expect(checkIn).not.toHaveBeenCalled();
    });

    it('⛔ neither reads nor checks in during the nightly stop', async () => {
        const { deps, read, escalate, checkIn } = subject(
            { pendingWithNoRow: 9, oldestPendingSeconds: 9000 },
            'sandbox',
            ASLEEP,
        );

        expect(await runQueueCheck(deps)).toBeUndefined();
        expect(read).not.toHaveBeenCalled();
        expect(escalate).not.toHaveBeenCalled();
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
                now: () => AWAKE,
            }),
        ).rejects.toThrow('database unreachable');

        expect(checkIn).not.toHaveBeenCalled();
    });
});
