/**
 * The spend ceiling against a REAL PostgreSQL — the tier that proves what the unit suite structurally cannot.
 *
 * ⛔ WHAT A MOCKED LEDGER TEST CANNOT TELL YOU, and why every one of these matters:
 *
 *  1. **That the SQL is right at all.** A fake `execute` returns whatever it was told to. It cannot tell you
 *     the `ON CONFLICT` clause names the real primary key, that `RETURNING` names a column that exists, or
 *     that the conditional `WHERE` is attached to the UPDATE rather than to the INSERT.
 *  2. **That the ceiling actually holds under concurrency.** ADR-0024's central claim is that the row lock
 *     serializes callers, so reserved spend never exceeds the ceiling "under arbitrary concurrency" and the
 *     bound "does not depend on `reservedConcurrency = 1`". That is a claim about PostgreSQL's locking, and it
 *     is asserted here by firing overlapping reservations at one row.
 *  3. **That a duplicate settle is caught rather than silently absorbed.** The
 *     `verification_spend_reserved_nonnegative` CHECK is the entire mechanism turning the one forbidden
 *     operation into a loud error. A mock has no constraints.
 *  4. **That the migration ran.** A unit test cannot observe a migration that did not apply — and this table
 *     ships in the RECIPE SERVICE's migrations while the code that uses it lives here, which is precisely the
 *     cross-package seam where "the SQL was filed in the wrong package" hides.
 *
 * Runs against `DATABASE_URL`; skipped in lockstep without it, and run in CI.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSpendLedger, isSpendLedgerError } from '../../../src/common/verificationSpend.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const canRun = Boolean(DATABASE_URL);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The migration under test, read from recipe-service where it actually ships. */
const MIGRATION = path.join(
    __dirname,
    '../../../../recipe-service/src/database/migrations/0022_verification_spend.sql',
);

const CEILING_MICROS = 100_000_000;

/** A plan as `planReservation` produces one, for a period this suite owns exclusively. */
const planFor = (period: string, worstMicros: number, ceilingMicros = CEILING_MICROS) =>
    ({
        kind: 'priced',
        period,
        modelId: 'amazon.nova-micro-v1:0',
        // The ADDRESS, which for an on-demand model equals the id above. Carried because the LEDGER must be
        // provably indifferent to it: the counter row is keyed on the period alone, and nothing in either SQL
        // statement may learn which model — or which call site — the charge came from.
        invocationId: 'amazon.nova-micro-v1:0',
        worstMicros,
        headroomMicros: ceilingMicros - worstMicros,
        rate: {
            inputMicrosPerMillionTokens: 35_000,
            outputMicrosPerMillionTokens: 140_000,
            cacheReadMicrosPerMillionTokens: 3_500,
            cacheWriteMicrosPerMillionTokens: 43_750,
            effectiveDate: '2026-08-20',
            priceVerified: true,
        },
    }) as const;

describe.skipIf(!canRun)('verification spend ledger (real Postgres)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = drizzle(pool);

        // Apply the REAL migration file, not a hand-written CREATE TABLE. A local copy would drift from the
        // one the deploy applies, and the drift would be invisible: both would pass.
        //
        // ⚠️ Issued through the pg pool rather than drizzle's `sql.raw`, which this repo's ESLint config bans
        // outright — correctly, since it splices its argument into the statement text. The ban targets
        // untrusted values; this is a committed DDL file, applied exactly as the deploy's own migration runner
        // applies it, so `pool.query` is the honest spelling rather than an exemption.
        //
        // ⛔ DROP FIRST, and not for tidiness. This suite has no vitest `globalSetup`, so the CI job applies
        // the recipe-service migrations itself before invoking it (see `_ci.yml`'s recipe-workers job) —
        // which means `0022` has ALREADY run against this database and applying it again is
        // `42P07 relation "verification_spend" already exists`. That threw out of `beforeAll`, so all 13
        // tests below reported as SKIPPED rather than failed, and the spend ledger — the piece of U11 that
        // decides whether the $100 ceiling holds — had no executed integration coverage at all.
        // Re-creating from the committed DDL is also what keeps assertion 4 honest: the table under test is
        // the one the deploy ships, not one this file wrote.
        await pool.query('DROP TABLE IF EXISTS verification_spend');
        await pool.query(readFileSync(MIGRATION, 'utf8'));
    });

    afterEach(async () => {
        await db.execute(sql`DELETE FROM verification_spend`);
    });

    afterAll(async () => {
        await db.execute(sql`DROP TABLE IF EXISTS verification_spend`);
        await pool.end();
    });

    it('creates the row on the first reservation of a period', async () => {
        const outcome = await createSpendLedger(db).reserve(planFor('2026-08', 500));

        expect(outcome).toEqual({ kind: 'reserved', reservedMicros: 500 });
    });

    it('accumulates across reservations in the same period', async () => {
        const ledger = createSpendLedger(db);
        await ledger.reserve(planFor('2026-08', 500));
        const second = await ledger.reserve(planFor('2026-08', 300));

        expect(second).toEqual({ kind: 'reserved', reservedMicros: 800 });
    });

    it('keeps periods independent, so a month boundary resets the ceiling', async () => {
        const ledger = createSpendLedger(db);
        await ledger.reserve(planFor('2026-08', 900));
        const september = await ledger.reserve(planFor('2026-09', 100));

        expect(september).toEqual({ kind: 'reserved', reservedMicros: 100 });
    });

    it('DENIES the reservation that would breach the ceiling, and the row is unchanged', async () => {
        const ledger = createSpendLedger(db);
        // One reservation of 60% of the ceiling, then another that would take it to 120%.
        await ledger.reserve(planFor('2026-08', 60_000_000));
        const denied = await ledger.reserve(planFor('2026-08', 60_000_000));

        expect(denied).toEqual({ kind: 'denied', period: '2026-08' });

        const after = await db.execute<{ reserved_micros: string }>(
            sql`SELECT reserved_micros FROM verification_spend WHERE period = '2026-08'`,
        );

        // ⛔ A DENIED reservation must charge NOTHING. If the conditional were attached to the wrong clause,
        // the row would have been incremented and then reported as denied — spending the budget on calls that
        // never happened, and closing the gate for the rest of the month.
        expect(Number(after.rows[0]?.reserved_micros)).toBe(60_000_000);
    });

    it('admits a reservation that lands EXACTLY on the ceiling', async () => {
        const ledger = createSpendLedger(db);
        await ledger.reserve(planFor('2026-08', CEILING_MICROS - 500));
        const last = await ledger.reserve(planFor('2026-08', 500));

        // The headroom subtracts the worst case before the comparison, so the last admissible reservation
        // starts AT the headroom and lands ON the ceiling. Never above.
        expect(last).toEqual({ kind: 'reserved', reservedMicros: CEILING_MICROS });
    });

    it('denies EVERY call, including the first, when one call cannot fit under the ceiling', async () => {
        // A lowered ceiling (or a raised `maxTokens`) can make a single worst case exceed the whole budget.
        // A fresh row at 0 must still be refused — `0 <= headroom` is false when the headroom is negative.
        const denied = await createSpendLedger(db).reserve(planFor('2026-08', 500, 100));

        expect(denied.kind).toBe('denied');

        const rows = await db.execute(sql`SELECT 1 FROM verification_spend WHERE period = '2026-08'`);

        // …and it must not leave a row behind claiming budget was taken.
        expect(rows.rows).toHaveLength(0);
    });

    it('never exceeds the ceiling under CONCURRENT reservations', async () => {
        // ⛔ ADR-0024's central claim, asserted rather than described: "the row lock serializes callers and
        // `$headroom` already subtracts the worst case before the comparison … the bound does NOT depend on
        // `reservedConcurrency = 1`". Twenty overlapping reservations of 10% of the ceiling each: at most ten
        // may be admitted, and a lost update would let more through.
        const ledger = createSpendLedger(db);
        const tenth = CEILING_MICROS / 10;

        const outcomes = await Promise.all(Array.from({ length: 20 }, () => ledger.reserve(planFor('2026-08', tenth))));

        const admitted = outcomes.filter((outcome) => outcome.kind === 'reserved').length;
        const total = await db.execute<{ reserved_micros: string }>(
            sql`SELECT reserved_micros FROM verification_spend WHERE period = '2026-08'`,
        );

        expect(admitted).toBe(10);
        expect(Number(total.rows[0]?.reserved_micros)).toBeLessThanOrEqual(CEILING_MICROS);
    });

    it('settles by refunding the difference and counting the call', async () => {
        const ledger = createSpendLedger(db);
        const plan = planFor('2026-08', 500);
        await ledger.reserve(plan);
        await ledger.settle({ plan, actualMicros: 36 });

        const row = await db.execute<{ reserved_micros: string; settled_micros: string; calls: string }>(
            sql`SELECT reserved_micros, settled_micros, calls FROM verification_spend WHERE period = '2026-08'`,
        );

        expect(row.rows[0]).toEqual({ reserved_micros: '36', settled_micros: '36', calls: '1' });
    });

    it('refunds IN FULL when nothing was billed', async () => {
        // ThrottlingException, ServiceUnavailableException, a client timeout. Without this, a throttling
        // episode consumes the ceiling at ZERO actual spend and closes the gate for the rest of the month.
        const ledger = createSpendLedger(db);
        const plan = planFor('2026-08', 500);
        await ledger.reserve(plan);
        await ledger.settle({ plan, actualMicros: 0 });

        const row = await db.execute<{ reserved_micros: string; settled_micros: string }>(
            sql`SELECT reserved_micros, settled_micros FROM verification_spend WHERE period = '2026-08'`,
        );

        expect(row.rows[0]).toEqual({ reserved_micros: '0', settled_micros: '0' });
    });

    it('REFUSES a duplicate settle instead of double-refunding it', async () => {
        // ⛔ THE PROPERTY THE CHECK CONSTRAINT EXISTS FOR, and the one a mock can never show. A second settle
        // would drive `reserved_micros` to -464 — a silent under-count of the ceiling. The constraint turns it
        // into an error the worker can meter.
        const ledger = createSpendLedger(db);
        const plan = planFor('2026-08', 500);
        await ledger.reserve(plan);
        await ledger.settle({ plan, actualMicros: 36 });

        const second = await ledger.settle({ plan, actualMicros: 36 }).catch((error: unknown) => error);

        expect(isSpendLedgerError(second)).toBe(true);
        expect(isSpendLedgerError(second) && second.phase).toBe('settle');

        const row = await db.execute<{ reserved_micros: string }>(
            sql`SELECT reserved_micros FROM verification_spend WHERE period = '2026-08'`,
        );

        expect(Number(row.rows[0]?.reserved_micros)).toBe(36);
    });

    it('settles against the period captured at RESERVE, across a UTC month boundary', async () => {
        // ⛔ The bug ADR-0024 names outright: a call spanning midnight on the 1st must not reserve against
        // month M and settle against M+1, which would leave M permanently over-reserved and M+1 permanently
        // over-charged. Because `settle` takes the PLAN, the August plan settles August even while September
        // is the live period.
        const ledger = createSpendLedger(db);
        const august = planFor('2026-08', 500);
        await ledger.reserve(august);
        await ledger.reserve(planFor('2026-09', 700));

        await ledger.settle({ plan: august, actualMicros: 36 });

        const rows = await db.execute<{ period: string; reserved_micros: string; calls: string }>(
            sql`SELECT period, reserved_micros, calls FROM verification_spend ORDER BY period`,
        );

        expect(rows.rows).toEqual([
            { period: '2026-08', reserved_micros: '36', calls: '1' },
            { period: '2026-09', reserved_micros: '700', calls: '0' },
        ]);
    });

    it('leaves the reservation STANDING when the settlement never runs', async () => {
        // A crash between a successful Bedrock response and the settle. ADR-0024 accepts this consequence
        // explicitly ("Crashes over-count"), and the point is that it over-counts — it can never under-count,
        // because `worst >= actual` always holds.
        const ledger = createSpendLedger(db);
        await ledger.reserve(planFor('2026-08', 500));

        const row = await db.execute<{ reserved_micros: string; settled_micros: string; calls: string }>(
            sql`SELECT reserved_micros, settled_micros, calls FROM verification_spend WHERE period = '2026-08'`,
        );

        expect(row.rows[0]).toEqual({ reserved_micros: '500', settled_micros: '0', calls: '0' });
    });

    it('refuses a malformed period key rather than opening a second row for the month', async () => {
        // A derived, machine-written value, so a malformed one is a code defect — and its consequence is that
        // the month silently gets a second budget.
        const broken = await createSpendLedger(db)
            .reserve(planFor('2026-8', 500))
            .catch((error: unknown) => error);

        expect(isSpendLedgerError(broken)).toBe(true);
    });
});
