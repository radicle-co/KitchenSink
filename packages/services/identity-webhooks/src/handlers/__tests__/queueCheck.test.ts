/**
 * U12 — the identity backstop (R29/R30/R32/R34/R36).
 *
 * ⛔ WHAT MAKES THESE CASES POSSIBLE AT ALL. Before U9 and U10 the two questions this check asks could not be
 * asked: a failed handle-sync publish left nothing behind, and an account `tombstoned` here but still active
 * at Clerk looked exactly like one that was fine. The marker and the version pair turned both into readable
 * facts — this is what reads them.
 */
import { describe, expect, it, vi } from 'vitest';

import { runIdentityQueueCheck, type DeletionQueueDepth, type IdentityOwedCounts } from '../queueCheck.js';

const NOTHING_OWED: IdentityOwedCounts = {
    unappliedStatusChanges: 0,
    owedHandleSyncs: 0,
    failedHandleSyncs: 0,
    oldestConvergenceSeconds: 0,
    oldestHandleSyncSeconds: 0,
};

const EMPTY: DeletionQueueDepth = { visible: 0, inFlight: 0, deadLettered: 0 };
const AWAKE = new Date('2026-07-15T15:00:00Z');

/** 01:00 in New York — inside ADR-0007's nightly stop. */
const ASLEEP = new Date('2026-07-15T05:00:00Z');

function run(
    counts: Partial<IdentityOwedCounts>,
    depth: Partial<DeletionQueueDepth> = {},
    stage = 'sandbox',
    now = AWAKE,
) {
    const escalate = vi.fn();
    const checkIn = vi.fn();
    const readCounts = vi.fn().mockResolvedValue({ ...NOTHING_OWED, ...counts });
    const readDepth = vi.fn().mockResolvedValue({ ...EMPTY, ...depth });

    return {
        escalate,
        checkIn,
        readCounts,
        readDepth,
        result: runIdentityQueueCheck({
            stage,
            counts: readCounts,
            depth: readDepth,
            escalate,
            checkIn,
            now: () => now,
        }),
    };
}

describe('the identity queue check', () => {
    it('says nothing when everything has converged', async () => {
        const { result, escalate } = run({});

        expect(await result).toEqual([]);
        expect(escalate).not.toHaveBeenCalled();
    });

    /**
     * ⛔ THE DIVERGENCE U10 EXISTS TO END: the database says one thing and the provider another, with an
     * EMPTY queue between them — so nothing is carrying the change and no amount of waiting fixes it.
     */
    it('⛔ an unapplied status change with an EMPTY deletion queue is LOST', async () => {
        const { result } = run({
            unappliedStatusChanges: 2,
            oldestConvergenceSeconds: 1,
            oldestHandleSyncSeconds: 1_800,
        });
        const raised = await result;

        expect(raised[0]?.queueName).toBe('identity-provider-convergence');
        expect(raised[0]?.condition).toBe('lost');
    });

    /**
     * ⛔ The SAME count behind a moving queue is merely late. Getting this wrong means telling an operator an
     * account is stranded when it is thirty seconds from converging — which is how a signal earns a mute.
     */
    it('⛔ the same count behind a MOVING queue is DELAYED, not lost', async () => {
        const { result } = run({ unappliedStatusChanges: 2 }, { visible: 2 });

        expect((await result)[0]?.condition).toBe('delayed');
    });

    it('a dead-lettered deletion message outranks everything', async () => {
        const { result } = run({ unappliedStatusChanges: 2 }, { deadLettered: 1, visible: 2 });

        expect((await result)[0]?.condition).toBe('dead-lettered');
    });

    /**
     * ⛔ An owed sync with NO failure code was never attempted — nothing is carrying it. One WITH a code was
     * attempted and refused, which an operator acts on differently, so it is reported differently.
     */
    it('⛔ an unattempted handle sync is LOST; an attempted-and-refused one is EXHAUSTED', async () => {
        const unattempted = await run({ owedHandleSyncs: 1 }).result;
        const refused = await run({ owedHandleSyncs: 1, failedHandleSyncs: 1 }).result;

        expect(unattempted.find((p) => p.queueName === 'identity-handle-sync')?.condition).toBe('lost');
        expect(refused.find((p) => p.queueName === 'identity-handle-sync')?.condition).toBe('exhausted');
    });

    it('reports BOTH classes when both are owed — one hides the other otherwise', async () => {
        const { result, escalate } = run({ unappliedStatusChanges: 1, owedHandleSyncs: 1 });

        expect((await result).map((p) => p.queueName).sort()).toEqual([
            'identity-handle-sync',
            'identity-provider-convergence',
        ]);
        expect(escalate).toHaveBeenCalledTimes(2);
    });

    it('⛔ during the nightly window it makes NO call and raises nothing', async () => {
        const { result, readCounts, readDepth, escalate } = run(
            { unappliedStatusChanges: 99 },
            {},
            'sandbox',
            new Date('2026-07-15T05:00:00Z'),
        );

        expect(await result).toEqual([]);
        expect(readCounts).not.toHaveBeenCalled();
        expect(readDepth).not.toHaveBeenCalled();
        expect(escalate).not.toHaveBeenCalled();
    });

    it('⛔ PROD checks during those same hours', async () => {
        const { result } = run({ unappliedStatusChanges: 1 }, {}, 'prod', new Date('2026-07-15T05:00:00Z'));

        expect(await result).toHaveLength(1);
    });

    /** ⛔ No display name, no email, no identity id — counts and identifiers only. */
    it('⛔ an escalation carries no text', async () => {
        const payload = (
            await run({ owedHandleSyncs: 1, oldestConvergenceSeconds: 60, oldestHandleSyncSeconds: 60 }).result
        )[0];

        for (const value of Object.values(payload ?? {})) {
            expect(['string', 'number']).toContain(typeof value);
        }

        expect(payload?.service).toBe('identity-webhooks');
    });
});

/**
 * ⛔ THE DEAD-MAN CHECK-IN (R37). Identity's convergence backstop is the one that notices an account left
 * half-closed, and its own death would look exactly like a stage where every account converged. The cron
 * monitor is what makes the difference audible — see `@kitchensink/queue-check`'s `cronMonitor.ts`.
 */
describe('the dead-man check-in', () => {
    it('⛔ checks in once the run completes', async () => {
        const { result, checkIn } = run({}, {}, 'prod');

        await result;

        expect(checkIn).toHaveBeenCalledTimes(1);
    });

    it('⛔ still checks in when it DID find owed work — the finding is not the failure', async () => {
        const { result, escalate, checkIn } = run(
            { unappliedStatusChanges: 3, oldestConvergenceSeconds: 900, oldestHandleSyncSeconds: 900 },
            {},
            'prod',
        );

        await result;

        expect(escalate).toHaveBeenCalledTimes(1);
        expect(checkIn).toHaveBeenCalledTimes(1);
    });

    it('⛔ a preview escalates WITHOUT checking in — its monitor would outlive its stack', async () => {
        const { result, escalate, checkIn } = run(
            { unappliedStatusChanges: 3, oldestConvergenceSeconds: 900, oldestHandleSyncSeconds: 900 },
            {},
            'pr-91',
        );

        await result;

        expect(escalate).toHaveBeenCalledTimes(1);
        expect(checkIn).not.toHaveBeenCalled();
    });

    it('⛔ neither reads nor checks in during the nightly stop', async () => {
        const { result, readCounts, escalate, checkIn } = run(
            { unappliedStatusChanges: 9, oldestConvergenceSeconds: 9000, oldestHandleSyncSeconds: 9000 },
            {},
            'sandbox',
            ASLEEP,
        );

        expect(await result).toEqual([]);
        expect(readCounts).not.toHaveBeenCalled();
        expect(escalate).not.toHaveBeenCalled();
        expect(checkIn).not.toHaveBeenCalled();
    });

    it('⛔ does not check in when a read fails — the rejection IS the signal', async () => {
        const checkIn = vi.fn();

        await expect(
            runIdentityQueueCheck({
                stage: 'prod',
                counts: vi.fn().mockRejectedValue(new Error('database unreachable')),
                depth: vi.fn().mockResolvedValue(EMPTY),
                escalate: vi.fn(),
                checkIn,
                now: () => AWAKE,
            }),
        ).rejects.toThrow('database unreachable');

        expect(checkIn).not.toHaveBeenCalled();
    });
});
