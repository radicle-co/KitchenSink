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

import { DRAIN_HEADROOM_FRACTION, DRAIN_MAX_BATCH, drainRevokedBands, type BandDrainDeps } from '../bandDrain.js';

const SETTINGS = { ceilingMicros: 100_000_000, modelId: 'amazon.nova-micro-v1:0' };

const SKIP = (id: string) => ({
    id,
    band: { rung: 'head', marginBand: '0.15+', queryShape: 'single-token', rankerVersion: 'v1' },
    epoch: 1,
    message: { sourceLine: `line ${id}` },
});

function deps(overrides: Partial<BandDrainDeps> = {}): BandDrainDeps & {
    readonly spies: {
        undrained: ReturnType<typeof vi.fn>;
        markDrained: ReturnType<typeof vi.fn>;
        send: ReturnType<typeof vi.fn>;
        reserved: ReturnType<typeof vi.fn>;
    };
} {
    const spies = {
        undrained: vi.fn().mockResolvedValue([SKIP('a'), SKIP('b')]),
        markDrained: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue(undefined),
        reserved: vi.fn().mockResolvedValue(0),
    };

    return {
        spies,
        stage: 'prod',
        settings: { resolve: vi.fn().mockResolvedValue(SETTINGS) },
        store: { undrainedRevokedSkips: spies.undrained, markDrained: spies.markDrained },
        reservedForPeriod: spies.reserved,
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
        // Nova worst case is 116 micros/call. Leave headroom for exactly 8 worst-case calls; the drain may
        // claim only its fraction of that.
        d.spies.reserved.mockResolvedValue(SETTINGS.ceilingMicros - 8 * 116);

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
        expect(d.spies.send).toHaveBeenCalledWith({ sourceLine: 'line a' });
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
});
