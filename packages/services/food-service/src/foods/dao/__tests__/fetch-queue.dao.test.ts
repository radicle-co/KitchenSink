/**
 * Unit tests for {@link FetchQueueDao}'s configured lease window (`FOOD_LEASE_TIMEOUT_SECONDS`, FR-018).
 *
 * `FOOD_LEASE_TIMEOUT_SECONDS` is documented in `config/env.schema.ts` as THE worker lease window — "the
 * reaper reverts `in_flight` rows whose lease lapsed" — and was validated at boot while having **no
 * consumer anywhere**. The number the reaper actually used was a module literal (`DEFAULT_LEASE_SECONDS =
 * 30`), with a THIRD copy in `FoodConsumerService` (`deps.leaseSeconds ?? 30`) that overrode the DAO's
 * default on every real call. Setting the variable did nothing, silently — the `FOOD_DEMOTE_THRESHOLD`
 * split-brain (8f6e1e7f) all over again, one layer down.
 *
 * These assert the SQL the reaper will actually run (rendered through the real `PgDialect`, params
 * included); `tests/fetch-queue.dao.integration.test.ts` proves the same knob changes what Postgres
 * reclaims.
 *
 * @implements FR-018
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvironmentSchema } from '../../../config/env.schema.js';
import type { FoodDrizzle } from '../../../database/database.module.js';
import { FetchQueueDao } from '../fetch-queue.dao.js';

const dialect = new PgDialect();

/** A fake Drizzle client recording the rendered SQL + params of every statement handed to it. */
function makeDb(): { db: FoodDrizzle; queries: { sql: string; params: unknown[] }[] } {
    const queries: { sql: string; params: unknown[] }[] = [];

    const execute = (query: SQL): Promise<{ rows: unknown[]; rowCount: number }> => {
        const { sql, params } = dialect.sqlToQuery(query);
        queries.push({ sql, params });

        return Promise.resolve({ rows: [], rowCount: 0 });
    };

    return { db: { execute } as unknown as FoodDrizzle, queries };
}

/** The defaults the boot-time schema applies — never restated here as literals. */
const SCHEMA_DEFAULTS = EnvironmentSchema.parse({
    STAGE: 'test',
    DATABASE_URL: 'postgresql://food_app:pw@localhost:5432/kitchensink_food',
    USDA_API_KEY: 'test-usda-key',
});

describe('FetchQueueDao — the configured lease window (FR-018)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('reaps on the schema default when FOOD_LEASE_TIMEOUT_SECONDS is unset', async () => {
        vi.stubEnv('FOOD_LEASE_TIMEOUT_SECONDS', undefined);
        const { db, queries } = makeDb();

        await new FetchQueueDao(db).reapExpiredLeases();

        expect(queries[0]?.sql).toContain('make_interval(secs => $');
        expect(queries[0]?.params).toContain(SCHEMA_DEFAULTS.FOOD_LEASE_TIMEOUT_SECONDS);
    });

    it('reaps on the CONFIGURED window — a tuned lease reaches the statement', async () => {
        vi.stubEnv('FOOD_LEASE_TIMEOUT_SECONDS', '120');
        const { db, queries } = makeDb();

        await new FetchQueueDao(db).reapExpiredLeases();

        expect(queries[0]?.params).toContain(120);
        expect(queries[0]?.params).not.toContain(SCHEMA_DEFAULTS.FOOD_LEASE_TIMEOUT_SECONDS);
    });

    it("applies the configured window to leaseNext's reaper-on-claim too, not just the reaper tick", async () => {
        vi.stubEnv('FOOD_LEASE_TIMEOUT_SECONDS', '90');
        const { db, queries } = makeDb();

        await new FetchQueueDao(db).leaseNext();

        // `leaseNext` reaps first (FR-018), so the lease window must reach that statement as well.
        expect(queries[0]?.sql).toContain("UPDATE fetch_queue SET status = 'pending'");
        expect(queries[0]?.params).toContain(90);
    });

    it('still honours an explicit per-call window (the caller outranks the configured default)', async () => {
        vi.stubEnv('FOOD_LEASE_TIMEOUT_SECONDS', '120');
        const { db, queries } = makeDb();

        await new FetchQueueDao(db).reapExpiredLeases(7);

        expect(queries[0]?.params).toContain(7);
        expect(queries[0]?.params).not.toContain(120);
    });

    it('takes an options override, so a caller holding a validated Environment can pass it', async () => {
        vi.stubEnv('FOOD_LEASE_TIMEOUT_SECONDS', '120');
        const { db, queries } = makeDb();

        await new FetchQueueDao(db, { leaseSeconds: 45 }).reapExpiredLeases();

        expect(queries[0]?.params).toContain(45);
    });

    it.each(['a minute', '', '0', '-1', '2.5', 'NaN', 'Infinity'])(
        'fails at construction on the malformed lease window %o, naming the variable',
        (value) => {
            vi.stubEnv('FOOD_LEASE_TIMEOUT_SECONDS', value);

            expect(() => new FetchQueueDao(makeDb().db)).toThrow(/FOOD_LEASE_TIMEOUT_SECONDS/);
        },
    );
});
