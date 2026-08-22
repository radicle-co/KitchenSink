/**
 * The reserve-then-settle adapter's BEHAVIOUR (ADR-0024 §2).
 *
 * ⛔ WHAT THIS TIER CAN AND CANNOT PROVE, stated so nobody mistakes a green run here for a proven ceiling.
 * These tests hand the adapter a fake `execute` and assert what it does with the answers it gets back: that
 * zero rows is a DENIAL rather than an error, that a database failure propagates (fail closed), that the
 * period travels from the plan into the settlement rather than being recomputed, and that nothing here
 * retries. They CANNOT prove the SQL is right, that the row lock serializes concurrent reservations, or that
 * the `reserved_micros >= 0` CHECK catches a duplicate settle — a mock answers whatever it was told to.
 * `__tests__/integration/verification/verificationSpend.integration.test.ts` proves those against a real
 * Postgres, and it is not optional.
 */
import { describe, expect, it, vi } from 'vitest';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { createSpendLedger, isSpendGated } from '../verificationSpend.js';

/** A `PricedReservation` as `planReservation` would return it. */
const PLAN = {
    kind: 'priced',
    period: '2026-08',
    modelId: 'amazon.nova-micro-v1:0',
    worstMicros: 500,
    headroomMicros: 99_999_500,
    rate: {
        inputMicrosPerMillionTokens: 35_000,
        outputMicrosPerMillionTokens: 140_000,
        cacheReadMicrosPerMillionTokens: 3_500,
        cacheWriteMicrosPerMillionTokens: 43_750,
        effectiveDate: '2026-08-20',
        priceVerified: true,
    },
} as const;

/** A database whose `execute` returns the given rows, recording every call. */
function dbReturning(...results: readonly { readonly rows: readonly unknown[] }[]): {
    readonly db: NodePgDatabase<Record<string, never>>;
    readonly execute: ReturnType<typeof vi.fn>;
} {
    const execute = vi.fn();

    for (const result of results) {
        execute.mockResolvedValueOnce(result);
    }

    execute.mockResolvedValue({ rows: [] });

    return { db: { execute } as unknown as NodePgDatabase<Record<string, never>>, execute };
}

describe('reserve', () => {
    it('charges the worst case and reports the new total', async () => {
        const { db } = dbReturning({ rows: [{ reserved_micros: '1500' }] });
        const outcome = await createSpendLedger(db).reserve(PLAN);

        expect(outcome).toEqual({ kind: 'reserved', reservedMicros: 1_500 });
    });

    it('parses the bigint the driver returns as a STRING', async () => {
        // `node-postgres` returns int8 as a string to avoid silent precision loss. Reading it as a number
        // without parsing yields `NaN` in arithmetic and `'1500' + 1 === '15001'` in concatenation — either
        // way the metric the alarm watches becomes nonsense while the gate keeps working.
        const { db } = dbReturning({ rows: [{ reserved_micros: '90000000' }] });
        const outcome = await createSpendLedger(db).reserve(PLAN);

        expect(outcome.kind === 'reserved' && outcome.reservedMicros).toBe(90_000_000);
    });

    it('reads ZERO ROWS as the budget denial, not as an error', async () => {
        // ⛔ ADR-0024 §2: "Zero rows returned IS the budget denial — the row exists and the WHERE failed."
        // There is no second statement and no prior read; the conditional write IS the check.
        const { db, execute } = dbReturning({ rows: [] });
        const outcome = await createSpendLedger(db).reserve(PLAN);

        expect(outcome).toEqual({ kind: 'denied', period: '2026-08' });
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('takes exactly ONE round trip — no read before the write', async () => {
        // A read-then-write would reintroduce the race the row lock exists to remove, and would double the
        // latency of the only thing standing between a runaway and the invoice.
        const { db, execute } = dbReturning({ rows: [{ reserved_micros: '500' }] });
        await createSpendLedger(db).reserve(PLAN);

        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('PROPAGATES a database failure — the counter fails CLOSED', async () => {
        // ⛔ An unreadable counter must never let the call through. ADR-0024: "An unreadable counter fails
        // CLOSED — the call is never made." The handler turns this into a message that returns to the queue,
        // NOT into a line resolved as unresolved.
        const execute = vi.fn().mockRejectedValue(new Error('connection terminated unexpectedly'));
        const db = { execute } as unknown as NodePgDatabase<Record<string, never>>;

        await expect(createSpendLedger(db).reserve(PLAN)).rejects.toThrow(/counter/iu);
    });

    it('does not retry a failed reserve', async () => {
        const execute = vi.fn().mockRejectedValue(new Error('deadlock detected'));
        const db = { execute } as unknown as NodePgDatabase<Record<string, never>>;

        await createSpendLedger(db)
            .reserve(PLAN)
            .catch(() => undefined);

        // Retrying a reserve in-process would take a SECOND worst-case charge for one call if the first
        // actually committed and the failure was in the reply. The queue retries; this does not.
        expect(execute).toHaveBeenCalledTimes(1);
    });
});

describe('settle', () => {
    it('refunds the difference and records the call', async () => {
        const { db } = dbReturning({ rows: [] });
        const ledger = createSpendLedger(db);

        await expect(ledger.settle({ plan: PLAN, actualMicros: 36 })).resolves.toBeUndefined();
    });

    it('is a single statement and is NEVER retried', async () => {
        // ⛔ THE ONE OPERATION THAT MUST NOT BE RETRIED. `reserved_micros + $delta` is not idempotent with a
        // negative delta, so a settle that runs twice refunds most of the reservation twice — reintroducing
        // exactly the silent under-count reserve-then-settle exists to prevent.
        const { db, execute } = dbReturning({ rows: [] });
        await createSpendLedger(db).settle({ plan: PLAN, actualMicros: 36 });

        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('does not retry when the statement FAILS, either', async () => {
        const execute = vi.fn().mockRejectedValue(new Error('connection terminated unexpectedly'));
        const db = { execute } as unknown as NodePgDatabase<Record<string, never>>;

        await createSpendLedger(db)
            .settle({ plan: PLAN, actualMicros: 36 })
            .catch(() => undefined);

        // ⛔ A retried settle after an ambiguous failure is the double-refund. The reservation standing is the
        // SAFE outcome (it over-counts), so a failed settle is reported and abandoned.
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('surfaces a settlement failure so an unrefunded reservation is observable', async () => {
        const execute = vi.fn().mockRejectedValue(new Error('new row violates check constraint'));
        const db = { execute } as unknown as NodePgDatabase<Record<string, never>>;

        // ADR-0024: "emit a metric when settle fails so unrefunded reservations are observable rather than
        // silent". The adapter's contribution is to fail loudly; the handler meters it and carries on.
        await expect(createSpendLedger(db).settle({ plan: PLAN, actualMicros: 36 })).rejects.toThrow(/settle/iu);
    });
});

describe('isSpendGated', () => {
    it('enforces the ceiling in prod', () => {
        expect(isSpendGated('prod')).toBe(true);
    });

    it.each([['sandbox'], ['pr-73'], ['pr-1'], ['dev'], ['test'], ['local']])(
        'leaves %s ungated — owner ruling, 2026-08-21',
        (stage) => {
            // ⛔ ADR-0006 gives each PR its own LOGICAL database on the shared sandbox instance, and Postgres
            // cannot read across logical databases — so a shared counter would need either a second connection
            // to the base database or a store outside both VPCs. Neither is worth the machinery for non-prod.
            // "Ungated" is not "unlimited": layers 0–2 still bound the rate at `reservedConcurrency = 1` and
            // ~1s per call, i.e. ~86,400 calls/day ~ $2.90/day ~ $88/month/stage on Nova Micro.
            expect(isSpendGated(stage)).toBe(false);
        },
    );

    it('leaves an UNRECOGNISED stage ungated rather than guessing', () => {
        // ⚠️ The asymmetry is deliberate and worth stating. Gating an unknown stage would deny every call in a
        // stage whose counter table may not even carry a row, turning a naming mistake into a total outage of
        // verification. Leaving it ungated bounds the damage at layers 0–2's ~$88/month — the same exposure
        // every non-prod stage already carries by ruling. Exact equality on the one stage that matters.
        expect(isSpendGated('production')).toBe(false);
        expect(isSpendGated('PROD')).toBe(false);
        expect(isSpendGated('')).toBe(false);
    });
});
