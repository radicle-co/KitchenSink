/**
 * The revocation drain (plan U3, R14) — the rate-limited backlog that re-verifies what a revoked band
 * skipped, WITHOUT flooding ADR-0024's shared pool.
 *
 * ⛔ The design under test: revocation only flips state; the skips table IS the backlog. This scheduled
 * drain sends stored producer-built messages oldest-first, in batches sized against the pool's REMAINING
 * headroom — so ceiling exhaustion PAUSES the drain (zero budget, try again next tick) instead of
 * enqueueing thousands of messages that would each burn a reservation attempt and land in the DLQ.
 */
import { describe, expect, it, vi } from 'vitest';

import { rateFor, worstCaseMicros } from '@kitchensink/recipe-core/spend/spend-arithmetic';
import { UNWARRANTED_MODEL_ID, UNWARRANTED_REGISTRY } from '../../parsing/__tests__/unwarrantedModel.js';
import {
    VERIFICATION_INPUT_TOKEN_CEILING,
    VERIFICATION_MAX_OUTPUT_TOKENS,
} from '@kitchensink/recipe-core/resolution/verification-prompt';

import {
    DRAIN_HEADROOM_FRACTION,
    DRAIN_MAX_BATCH,
    drainRevokedBands,
    publishParseStallGauge,
    type BandDrainDeps,
} from '../bandDrain.js';
import type { ExpiryQueryable } from '../../parsing/parseJobExpiry.js';

const SETTINGS = { ceilingMicros: 100_000_000, modelId: 'amazon.nova-micro-v1:0' };

/**
 * What one worst-case verification call costs, DERIVED from the same arithmetic the drain uses.
 *
 * ⛔ Never a literal. Both budget tests read `8 * 116` — the Nova figure of the day — so when
 * `worstCaseMicros` grew its per-class rounding allowance they went red reporting an arithmetic change as a
 * drain regression. The drain's contract is "a fraction of the headroom, in whole calls"; what a call costs
 * is not this suite's fact to restate.
 */
const WORST_MICROS = worstCaseMicros(
    rateFor(SETTINGS.modelId)!,
    VERIFICATION_INPUT_TOKEN_CEILING,
    VERIFICATION_MAX_OUTPUT_TOKENS,
);

/**
 * A stored message that satisfies the CONSUMER's contract.
 *
 * ⚠️ It used to be `{ sourceLine: 'line 1' }` — a stand-in the verification consumer would refuse. That was
 * invisible while the drain re-sent whatever the row held; now that it validates before sending (GR-018
 * §18-b at the producer), a fixture the consumer would reject is a fixture that proves nothing about the
 * happy path.
 */
const VALID_MESSAGE = (id: string) => ({
    recipeId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    sourceLine: `2 cups flour ${id}`,
    foodId: '01JFOOD000000000000000000',
    candidateFoodName: 'Flour, wheat, all-purpose',
    quantityLow: 2,
    quantityHigh: null,
    unit: 'cup',
    evidenceKind: 'ranked' as const,
    shortlist: [{ foodId: '01JFOOD000000000000000000', score: 0.9 }],
    requestedAt: '2026-08-21T10:00:00.000Z',
});

const SKIP = (id: string) => ({
    id,
    band: { rung: 'head', marginBand: '0.15+', queryShape: 'single-token', rankerVersion: 'v1' },
    epoch: 1,
    message: VALID_MESSAGE(id),
});

function deps(overrides: Partial<BandDrainDeps> = {}): BandDrainDeps & {
    readonly spies: {
        undrained: ReturnType<typeof vi.fn>;
        markDrained: ReturnType<typeof vi.fn>;
        agedRedrives: ReturnType<typeof vi.fn>;
        markRedriven: ReturnType<typeof vi.fn>;
        send: ReturnType<typeof vi.fn>;
        reserved: ReturnType<typeof vi.fn>;
    };
} {
    const spies = {
        undrained: vi.fn().mockResolvedValue([SKIP('a'), SKIP('b')]),
        markDrained: vi.fn().mockResolvedValue(undefined),
        agedRedrives: vi.fn().mockResolvedValue([]),
        markRedriven: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue(undefined),
        reserved: vi.fn().mockResolvedValue(0),
    };

    return {
        spies,
        stage: 'prod',
        deployRegion: 'us-east-1',
        settings: { resolve: vi.fn().mockResolvedValue(SETTINGS) },
        store: { undrainedRevokedSkips: spies.undrained, markDrained: spies.markDrained },
        reservedForPeriod: spies.reserved,
        agedRedrives: spies.agedRedrives,
        markRedriven: spies.markRedriven,
        send: spies.send,
        now: () => new Date('2026-08-31T10:00:00.000Z'),
        ...overrides,
    } as BandDrainDeps & { spies: typeof spies };
}

describe('budget sizing', () => {
    it('⛔ PAUSES — sends nothing — when the period has no headroom left', async () => {
        const d = deps();
        d.spies.reserved.mockResolvedValue(SETTINGS.ceilingMicros);

        const result = await drainRevokedBands(d);

        expect(result.sent).toBe(0);
        expect(d.spies.send).not.toHaveBeenCalled();
        expect(d.spies.undrained).not.toHaveBeenCalled();
    });

    it('sizes the batch from the REMAINING headroom, never the whole ceiling', async () => {
        const d = deps();
        // Leave headroom for exactly 8 worst-case calls; the drain may claim only its fraction of that.
        d.spies.reserved.mockResolvedValue(SETTINGS.ceilingMicros - 8 * WORST_MICROS);

        await drainRevokedBands(d);

        const limit = d.spies.undrained.mock.calls[0]?.[0] as number;
        expect(limit).toBe(Math.floor(8 * DRAIN_HEADROOM_FRACTION));
        expect(limit).toBeLessThan(8);
    });

    it('an ungated stage drains up to the flat cap — there is no counter to consult', async () => {
        const d = deps({ stage: 'sandbox' });

        await drainRevokedBands(d);

        expect(d.spies.reserved).not.toHaveBeenCalled();
        expect(d.spies.undrained).toHaveBeenCalledWith(DRAIN_MAX_BATCH);
    });
});

describe('the send loop', () => {
    it('sends each stored message VERBATIM and marks it drained only after the send', async () => {
        const d = deps({ stage: 'sandbox' });

        const result = await drainRevokedBands(d);

        expect(result.sent).toBe(2);
        expect(d.spies.send).toHaveBeenCalledWith(VALID_MESSAGE('a'));
        expect(d.spies.markDrained).toHaveBeenCalledWith(['a']);
        expect(d.spies.markDrained.mock.invocationCallOrder[0]!).toBeGreaterThan(
            d.spies.send.mock.invocationCallOrder[0]!,
        );
    });

    it('⚠️ a failed send leaves its skip undrained and does not strand the rest of the batch', async () => {
        const d = deps({ stage: 'sandbox' });
        d.spies.send.mockRejectedValueOnce(new Error('sqs throttled'));

        const result = await drainRevokedBands(d);

        expect(result.sent).toBe(1);
        expect(d.spies.markDrained).toHaveBeenCalledTimes(1);
        expect(d.spies.markDrained).toHaveBeenCalledWith(['b']);
    });
});

describe('degenerate settings', () => {
    it('an unpriced model drains nothing — with no worst case the batch cannot be sized', async () => {
        const d = deps();
        d.settings.resolve = vi.fn().mockResolvedValue({ ...SETTINGS, modelId: 'not-a-real-model' });

        const result = await drainRevokedBands(d);

        expect(result.sent).toBe(0);
        expect(d.spies.send).not.toHaveBeenCalled();
    });

    /**
     * ⛔ RESIDENCY (ADR-0024 §4b) — the drain must PAUSE, exactly as it does for an unpriced model, and for a
     * strictly stronger reason.
     *
     * The unpriced branch pauses because the batch cannot be SIZED. This one pauses because the gate would
     * refuse every message the tick sent: `verifyLine` now returns without a verdict for a residency-refused
     * model, so a drain that sent anyway would silently DISCARD the backlog revocation exists to re-verify —
     * worse than the DLQ depth the unpriced branch's comment warns about, because nothing would be visible at
     * all. Undrained rows are re-read every tick, so pausing loses nothing.
     */
    it('a residency-unapproved model drains nothing — the gate would refuse every message it sent', async () => {
        const d = deps();
        d.settings.resolve = vi.fn().mockResolvedValue({ ...SETTINGS, modelId: UNWARRANTED_MODEL_ID });
        (d as { registry?: unknown }).registry = UNWARRANTED_REGISTRY;

        const result = await drainRevokedBands(d);

        expect(result).toEqual({ sent: 0, budget: 0 });
        expect(d.spies.send).not.toHaveBeenCalled();
        expect(d.spies.markDrained).not.toHaveBeenCalled();
    });
});

describe('a stored message that no longer matches the contract', () => {
    it('⛔ is refused BEFORE the queue and marked, so it cannot loop every tick', async () => {
        // The row was written by an earlier release. Re-sending it would spend 20 receives and a DLQ slot to
        // discover what `safeParse` answers here for free, and leaving it undrained would re-send it every
        // fifteen minutes forever — the sustained retry GR-018 §18-b refuses.
        const stale = { id: 'stale', band: SKIP('x').band, epoch: 1, message: { sourceLine: 'line only' } };
        const d = deps({ stage: 'sandbox' });
        d.spies.undrained.mockResolvedValue([stale]);

        const result = await drainRevokedBands(d);

        expect(d.spies.send).not.toHaveBeenCalled();
        expect(d.spies.markDrained).toHaveBeenCalledWith(['stale']);
        expect(result.sent).toBe(0);
    });
});

describe("aged pending re-drives share the tick's budget (plan U4c, KTD-A)", () => {
    const REDRIVE = (key: string) => ({ verificationKey: key, message: VALID_MESSAGE(key) });

    it('drives aged verdict-less rows AFTER the revoked skips, out of the SAME budget', async () => {
        const d = deps({ stage: 'sandbox' });
        d.spies.agedRedrives.mockResolvedValue([REDRIVE('k1')]);

        const result = await drainRevokedBands(d);

        // 2 skips + 1 redrive; the redrive read was offered only the leftover budget.
        expect(result.sent).toBe(3);
        expect(d.spies.agedRedrives).toHaveBeenCalledWith(DRAIN_MAX_BATCH - 2);
        expect(d.spies.send).toHaveBeenCalledWith(VALID_MESSAGE('k1'));
        expect(d.spies.markRedriven).toHaveBeenCalledWith('k1');
    });

    it('⛔ a tick whose skips consumed the whole budget re-drives NOTHING — pause, not overrun', async () => {
        const d = deps({ stage: 'prod' });
        // Headroom for exactly 8 worst-case calls → budget floor(8 × fraction) = 2, both spent on skips.
        d.spies.reserved.mockResolvedValue(SETTINGS.ceilingMicros - 8 * WORST_MICROS);
        d.spies.agedRedrives.mockResolvedValue([REDRIVE('k1')]);

        const result = await drainRevokedBands(d);

        expect(result.sent).toBe(2);
        expect(d.spies.agedRedrives).not.toHaveBeenCalled();
    });

    it('⚠️ a failed re-send leaves the row unmarked for the next tick and does not strand the rest', async () => {
        const d = deps({ stage: 'sandbox' });
        d.spies.undrained.mockResolvedValue([]);
        d.spies.agedRedrives.mockResolvedValue([REDRIVE('k1'), REDRIVE('k2')]);
        d.spies.send.mockRejectedValueOnce(new Error('sqs throttled'));

        const result = await drainRevokedBands(d);

        expect(result.sent).toBe(1);
        expect(d.spies.markRedriven).toHaveBeenCalledTimes(1);
        expect(d.spies.markRedriven).toHaveBeenCalledWith('k2');
    });
});

/**
 * ⛔ THE STALL GAUGE — the third silence, and the one with a COOK on the other end of it.
 *
 * A parse job whose lines never land stays `running` until `expireParseJobs` discards it 24 hours later.
 * There is no error, no failed state and nothing to click: the import simply never finishes. The stall has
 * no EVENT to log, because it is the absence of one — which is exactly why it needs a gauge read on a tick
 * rather than a line written at a moment.
 *
 * It rides this drain's existing 15-minute schedule for the reason `parseJobExpiry.ts` already gives for
 * the sweep: a Lambda of its own would be a new ADR-0004 NAT consumer and a new migration-barrier entry for
 * one SELECT.
 *
 * ⛔ IT MUST PUBLISH EVERY TICK, INCLUDING 0. A gauge that only spoke when something was wrong would leave
 * the alarm unable to distinguish "nothing is stalled" from "the emitter is gone" — and the alarm's whole
 * value is that it treats a missing series as a fault.
 */
describe('the parse-job stall gauge', () => {
    /**
     * ⛔ TYPED AS THE REAL PORT, not `as never`. `as never` satisfies any parameter, so the double would
     * keep compiling after the port's shape changed — the test would go on proving a contract that no
     * longer exists. Annotating it means a change to `ExpiryQueryable` breaks here, which is the whole
     * value of having a port.
     */
    function gaugeDeps(age: number) {
        const emit = vi.fn();
        const query = vi.fn().mockResolvedValue({ rows: [{ age }] });
        const pool: ExpiryQueryable = { query };

        return { emit, pool: { query }, deps: { pool, stage: 'prod' as const, emit } };
    }

    it('publishes the oldest running job’s age under the parse namespace, dimensioned by stage', async () => {
        const { emit, deps } = gaugeDeps(7200);

        await publishParseStallGauge(deps);

        expect(emit).toHaveBeenCalledWith({
            namespace: 'Commise/RecipeParse',
            name: 'OldestRunningParseJobAgeSeconds',
            unit: 'Seconds',
            stage: 'prod',
            value: 7200,
        });
    });

    it('⛔ publishes 0 on a quiet tick — an absent series must mean a broken emitter, not an idle one', async () => {
        const { emit, deps } = gaugeDeps(0);

        await publishParseStallGauge(deps);

        expect(emit).toHaveBeenCalledWith(expect.objectContaining({ value: 0 }));
    });

    it('⛔ never lets a read failure take the drain down — the gauge is observation, not work', async () => {
        const emit = vi.fn();
        const pool: ExpiryQueryable = { query: vi.fn().mockRejectedValue(new Error('connection terminated')) };

        await expect(publishParseStallGauge({ pool, stage: 'prod', emit })).resolves.toBeUndefined();

        expect(emit).not.toHaveBeenCalled();
    });
});
