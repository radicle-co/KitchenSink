/**
 * Unit tests for {@link FoodDao}'s configured tombstone TTL (`FOOD_NOT_FOUND_TTL_DAYS`, FR-025/FR-028a).
 *
 * `FOOD_NOT_FOUND_TTL_DAYS` is documented in `config/env.schema.ts` as "NOT_FOUND tombstone TTL
 * (FR-025): an add after this many days may re-attempt the fan-out" and was validated at boot while having
 * **no consumer anywhere**. The number `createByName` actually reactivated on was a module literal
 * (`sql\`interval '30 days'\``). An operator lowering the TTL to get a failed batch re-attempted sooner
 * would have seen precisely nothing happen, with no error — the `FOOD_DEMOTE_THRESHOLD` split-brain
 * (8f6e1e7f) one table over.
 *
 * These assert the statement `createByName` will actually run (rendered through the real `PgDialect`);
 * `tests/food.dao.integration.test.ts` proves the same knob changes which tombstones Postgres reactivates.
 *
 * @implements FR-025 FR-028a
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvironmentSchema } from '../../../config/env.schema.js';
import type { FoodDrizzle } from '../../../database/database.module.js';
import { FoodDao } from '../food.dao.js';

const dialect = new PgDialect();

/** A fake Drizzle client recording every statement run inside `createByName`'s transaction. */
function makeDb(): { db: FoodDrizzle; queries: { sql: string; params: unknown[] }[] } {
    const queries: { sql: string; params: unknown[] }[] = [];

    const execute = (query: SQL): Promise<{ rows: unknown[]; rowCount: number }> => {
        const { sql, params } = dialect.sqlToQuery(query);
        queries.push({ sql, params });

        return Promise.resolve({ rows: [{ id: 'x', inserted: true, reactivated: false }], rowCount: 1 });
    };

    const tx = { execute };

    return {
        db: {
            execute,
            transaction: <T>(callback: (handle: typeof tx) => Promise<T>): Promise<T> => callback(tx),
        } as unknown as FoodDrizzle,
        queries,
    };
}

/** The defaults the boot-time schema applies — never restated here as literals. */
const SCHEMA_DEFAULTS = EnvironmentSchema.parse({
    STAGE: 'test',
    DATABASE_URL: 'postgresql://food_app:pw@localhost:5432/kitchensink_food',
    USDA_API_KEY: 'test-usda-key',
});

/** The add-by-name statement (the advisory lock is issued first). */
function upsert(queries: { sql: string; params: unknown[] }[]): { sql: string; params: unknown[] } | undefined {
    return queries.find((query) => query.sql.includes('INSERT INTO food'));
}

describe('FoodDao — the configured NOT_FOUND tombstone TTL (FR-025)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('reactivates on the schema default when FOOD_NOT_FOUND_TTL_DAYS is unset', async () => {
        vi.stubEnv('FOOD_NOT_FOUND_TTL_DAYS', undefined);
        const { db, queries } = makeDb();

        await new FoodDao(db).createByName({ normalizedName: 'broccoli' });

        expect(upsert(queries)?.sql).toContain('make_interval(days => $');
        expect(upsert(queries)?.params).toContain(SCHEMA_DEFAULTS.FOOD_NOT_FOUND_TTL_DAYS);
    });

    it('reactivates on the CONFIGURED TTL — a tuned value reaches the statement', async () => {
        vi.stubEnv('FOOD_NOT_FOUND_TTL_DAYS', '7');
        const { db, queries } = makeDb();

        await new FoodDao(db).createByName({ normalizedName: 'broccoli' });

        expect(upsert(queries)?.params).toContain(7);
        // The literal interval is gone: an `interval '30 days'` left anywhere in the statement would mean
        // one of the four TTL comparisons still ignores the configured value.
        expect(upsert(queries)?.sql).not.toContain("interval '30 days'");
    });

    it('applies the TTL to EVERY comparison in the upsert, not just the first', async () => {
        vi.stubEnv('FOOD_NOT_FOUND_TTL_DAYS', '7');
        const { db, queries } = makeDb();

        await new FoodDao(db).createByName({ normalizedName: 'broccoli' });

        const statement = upsert(queries);
        // The status/tombstoned_at/updated_at CASE arms plus the `reactivated` projection: four in all.
        // A missed arm would leave the row reactivated but still stamped, or reported wrongly to the caller.
        expect(statement?.sql.match(/make_interval\(days => \$/g)).toHaveLength(4);
        expect(statement?.params.filter((param) => param === 7)).toHaveLength(4);
    });

    it('takes an options override, so a caller holding a validated Environment can pass it', async () => {
        vi.stubEnv('FOOD_NOT_FOUND_TTL_DAYS', '7');
        const { db, queries } = makeDb();

        await new FoodDao(db, { notFoundTtlDays: 90 }).createByName({ normalizedName: 'broccoli' });

        expect(upsert(queries)?.params).toContain(90);
    });

    it.each(['a month', '', '0', '-1', '2.5', 'NaN', 'Infinity'])(
        'fails at construction on the malformed TTL %o, naming the variable',
        (value) => {
            vi.stubEnv('FOOD_NOT_FOUND_TTL_DAYS', value);

            expect(() => new FoodDao(makeDb().db)).toThrow(/FOOD_NOT_FOUND_TTL_DAYS/);
        },
    );
});
