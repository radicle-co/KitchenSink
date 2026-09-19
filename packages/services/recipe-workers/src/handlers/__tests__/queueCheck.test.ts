/**
 * U12 — the recipe backstop (R29/R30/R32/R34/R36).
 *
 * ⛔ "SLOW IS NOT LOST" is what these cases are really about, and it is the judgement a human gets wrong
 * under pressure: a backlog of owed lines looks identical whether the queue is draining steadily behind it
 * or nothing is carrying the work at all. The difference is entirely in the TRANSPORT, and escalating a
 * healthy backlog trains its reader to ignore the signal — which is worse than not having one.
 */
import { describe, expect, it, vi } from 'vitest';

import { runRecipeQueueCheck, type CheckedQueue, type RecipeOwedCounts, type TransportDepth } from '../queueCheck.js';

const NOTHING_OWED: RecipeOwedCounts = {
    owedPastDeadline: 0,
    neverReceived: 0,
    atAllowance: 0,
    claimedTooLong: 0,
    oldestOwedSeconds: 0,
};

const EMPTY: TransportDepth = { visible: 0, inFlight: 0, deadLettered: 0 };

/** Mid-morning in New York — outside the nightly window. */
const AWAKE = new Date('2026-07-15T15:00:00Z');

/** 01:00 in New York — inside ADR-0007's nightly stop. */
const ASLEEP = new Date('2026-07-15T05:00:00Z');

function queue(name: string, counts: Partial<RecipeOwedCounts>, depth: Partial<TransportDepth> = {}): CheckedQueue {
    return {
        queueName: name,
        counts: vi.fn().mockResolvedValue({ ...NOTHING_OWED, ...counts }),
        depth: vi.fn().mockResolvedValue({ ...EMPTY, ...depth }),
    };
}

function run(queues: readonly CheckedQueue[], stage = 'sandbox', now = AWAKE) {
    const escalate = vi.fn();
    const checkIn = vi.fn();

    return {
        escalate,
        checkIn,
        result: runRecipeQueueCheck({ stage, service: 'recipe-workers', queues, escalate, checkIn, now: () => now }),
    };
}

describe('the recipe queue check', () => {
    it('says nothing about quiet queues', async () => {
        const { result, escalate } = run([queue('parse', {}), queue('verification', {})]);

        expect(await result).toEqual([]);
        expect(escalate).not.toHaveBeenCalled();
    });

    it('⛔ owed rows behind a NON-EMPTY queue are a DELAYED warning, not a LOST escalation', async () => {
        const { result } = run([queue('parse', { owedPastDeadline: 40, neverReceived: 40 }, { visible: 40 })]);

        expect((await result)[0]?.condition).toBe('delayed');
    });

    it('⛔ an owed row never received with an EMPTY queue produces ONE lost escalation', async () => {
        const { result, escalate } = run([
            queue('parse', { owedPastDeadline: 1, neverReceived: 1, oldestOwedSeconds: 3_600 }),
        ]);

        const raised = await result;
        expect(raised).toHaveLength(1);
        expect(raised[0]?.condition).toBe('lost');
        expect(escalate).toHaveBeenCalledTimes(1);
    });

    /**
     * ⚠️ EVERY class is read even when an earlier one escalates. A check that stopped at the first finding
     * would report the loudest problem and hide the others — and the others are exactly what tells an
     * operator whether one consumer is stuck or the whole stage is.
     */
    it('⛔ reads EVERY work class, even after one has escalated', async () => {
        const parse = queue('parse', { owedPastDeadline: 5, neverReceived: 5 });
        const verification = queue('verification', { owedPastDeadline: 2, neverReceived: 2 });
        const { result } = run([parse, verification]);

        expect(await result).toHaveLength(2);
        expect(verification.counts).toHaveBeenCalledTimes(1);
    });

    it('a DLQ above zero outranks everything for that class', async () => {
        const { result } = run([queue('verification', { owedPastDeadline: 9 }, { deadLettered: 1, visible: 9 })]);

        expect((await result)[0]?.condition).toBe('dead-lettered');
    });

    it('exhausted attempts are reported regardless of a busy transport', async () => {
        const { result } = run([queue('parse', { atAllowance: 3 }, { visible: 500 })]);

        expect((await result)[0]?.condition).toBe('exhausted');
    });

    /**
     * ⛔ THE NIGHTLY WINDOW, and the assertion that matters is that it reads NOTHING — no database call, no
     * SQS call. ADR-0007 stops the non-prod tier's RDS from 00:00 to 09:00.
     */
    it('⛔ during the nightly window it makes NO call and raises nothing', async () => {
        const parse = queue('parse', { owedPastDeadline: 99, neverReceived: 99 });
        const { result, escalate } = run([parse], 'sandbox', new Date('2026-07-15T05:00:00Z'));

        expect(await result).toEqual([]);
        expect(parse.counts).not.toHaveBeenCalled();
        expect(parse.depth).not.toHaveBeenCalled();
        expect(escalate).not.toHaveBeenCalled();
    });

    it('⛔ PROD checks during those same hours — it is never stopped', async () => {
        const parse = queue('parse', { owedPastDeadline: 1, neverReceived: 1 });
        const { result } = run([parse], 'prod', new Date('2026-07-15T05:00:00Z'));

        expect(await result).toHaveLength(1);
        expect(parse.counts).toHaveBeenCalledTimes(1);
    });

    /**
     * ⛔ THE PAYLOAD CARRIES NO TEXT. This check reads rows a cook wrote — recipe lines, ingredient phrases —
     * and a Sentry event is outside every erasure path. The type has nowhere to put any; this asserts the
     * built value agrees.
     */
    it('⛔ an escalation built from a row carries counts and identifiers only', async () => {
        const { result } = run([queue('parse', { owedPastDeadline: 2, neverReceived: 2, oldestOwedSeconds: 61 })]);
        const payload = (await result)[0];

        for (const value of Object.values(payload ?? {})) {
            expect(['string', 'number']).toContain(typeof value);
        }

        expect(payload?.queueName).toBe('parse');
        expect(payload?.service).toBe('recipe-workers');
    });

    /** ⛔ Two runs of the same condition must group as ONE Sentry issue — see `escalationFingerprint`. */
    it('⛔ produces the same payload identity across runs of the same condition', async () => {
        const first = (await run([queue('parse', { owedPastDeadline: 1, neverReceived: 1 })]).result)[0];
        const second = (await run([queue('parse', { owedPastDeadline: 90, neverReceived: 90 })]).result)[0];

        expect([first?.service, first?.stage, first?.queueName, first?.condition]).toEqual([
            second?.service,
            second?.stage,
            second?.queueName,
            second?.condition,
        ]);
    });
});

/**
 * ⛔ THE CHECK-IN IS THE ONLY THING THAT DETECTS THE CHECK'S OWN DEATH (R37). Every assertion above is about
 * what the check FOUND; a check that stops running finds nothing, says nothing, and reads exactly like a
 * healthy stage. The cron monitor inverts that — a missed check-in is the alert — which is why the promise is
 * made after the work rather than before it, and never made at all where it cannot be kept.
 */
describe('the dead-man check-in', () => {
    it('⛔ checks in after reading every class, so a check that dies stops promising', async () => {
        const { result, checkIn } = run([queue('parse', {}), queue('verification', {})], 'prod');

        await result;

        expect(checkIn).toHaveBeenCalledTimes(1);
    });

    /**
     * ⛔ A check-in means THE CHECK RAN, not THE SYSTEM IS HEALTHY. Withholding it when work is stuck would
     * conflate two unrelated failures — "the backstop is dead" and "the backstop found something" — and the
     * escalation already carries the second.
     */
    it('⛔ still checks in when it DID find stuck work — the finding is not the failure', async () => {
        const { result, escalate, checkIn } = run([queue('parse', { neverReceived: 4, owedPastDeadline: 4 })], 'prod');

        await result;

        expect(escalate).toHaveBeenCalledTimes(1);
        expect(checkIn).toHaveBeenCalledTimes(1);
    });

    /**
     * ⛔ A `pr-{N}` stage is torn down when its PR closes (ADR-0005). A monitor it created would be missing a
     * check-in forever after — one permanently-firing alert per PR, until the live monitors were unreadable
     * among the dead ones. The preview still ESCALATES; it just promises nothing.
     */
    it('⛔ a preview escalates WITHOUT checking in', async () => {
        const { result, escalate, checkIn } = run([queue('parse', { neverReceived: 2, owedPastDeadline: 2 })], 'pr-91');

        await result;

        expect(escalate).toHaveBeenCalledTimes(1);
        expect(checkIn).not.toHaveBeenCalled();
    });

    /**
     * ⛔ Silence inside ADR-0007's nightly stop must be SILENCE, check-in included. A check-in during the
     * window would report the job as having run when it deliberately did not — and the monitor's whole value
     * is that its silence is trustworthy.
     */
    it('⛔ neither reads nor checks in during the nightly stop', async () => {
        const parse = queue('parse', { neverReceived: 9, owedPastDeadline: 9 });
        const { result, escalate, checkIn } = run([parse], 'sandbox', ASLEEP);

        expect(await result).toEqual([]);
        expect(parse.counts).not.toHaveBeenCalled();
        expect(escalate).not.toHaveBeenCalled();
        expect(checkIn).not.toHaveBeenCalled();
    });

    /**
     * ⛔ A read that throws must NOT check in. The rejection is the signal that the check did not complete,
     * and a check-in issued anyway would tell the monitor the opposite of what happened.
     */
    it('⛔ does not check in when a read fails', async () => {
        const checkIn = vi.fn();
        const broken: CheckedQueue = {
            queueName: 'parse',
            counts: vi.fn().mockRejectedValue(new Error('database unreachable')),
            depth: vi.fn().mockResolvedValue(EMPTY),
        };

        await expect(
            runRecipeQueueCheck({
                stage: 'prod',
                service: 'recipe-workers',
                queues: [broken],
                escalate: vi.fn(),
                checkIn,
                now: () => AWAKE,
            }),
        ).rejects.toThrow('database unreachable');

        expect(checkIn).not.toHaveBeenCalled();
    });
});
