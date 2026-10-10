/**
 * Unit tests for {@link FoodDao}: its configured tombstone TTL (`FOOD_NOT_FOUND_TTL_DAYS`, FR-025/FR-028a), and
 * the single-statement reader-facts read behind the reference resolver (`readRefFacts`, curated U8).
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

/**
 * The add-by-name reactivation check: the read of the live catalog row of the name, which decides whether a stale
 * tombstone is reactivated (the advisory lock is issued first). Since 0018 add-by-name reads before it writes, so a
 * seeded name is never updated by the service (curated catalog plan KTD-12).
 */
function upsert(queries: { sql: string; params: unknown[] }[]): { sql: string; params: unknown[] } | undefined {
    return queries.find((query) => query.sql.includes('reactivatable'));
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

    it('decides reactivation in ONE comparison, and the reactivating write states no TTL of its own', async () => {
        vi.stubEnv('FOOD_NOT_FOUND_TTL_DAYS', '7');
        const { db, queries } = makeDb();

        await new FoodDao(db).createByName({ normalizedName: 'broccoli' });

        const statement = upsert(queries);
        // One comparison decides; a second TTL anywhere else could disagree with it about the same row.
        expect(statement?.sql.match(/make_interval\(days => \$/g)).toHaveLength(1);
        expect(queries.filter((query) => query.sql.includes('make_interval'))).toHaveLength(1);
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

/**
 * `readRefFacts` — the ONE statement behind `POST /api/v1/foods/refs/resolve` (curated U8) and the authorship
 * gate on `GET /{id}/candidates`. What a real Postgres returns for it is proven in
 * `tests/e2e/foodRefsResolve.e2e.test.ts`; this pins what the DAO asks for and how it maps the answer.
 */
describe('FoodDao.readRefFacts', () => {
    /** A fake Drizzle client answering `select(...).from(...).where(...)` with `rows`, recording each call. */
    function makeSelectDb(rows: readonly Record<string, unknown>[]): {
        db: FoodDrizzle;
        statements: { fields: string[]; sql: string; params: unknown[] }[];
    } {
        const statements: { fields: string[]; sql: string; params: unknown[] }[] = [];

        const select = (fields: Record<string, unknown>): unknown => ({
            from: () => ({
                where: (condition: SQL): Promise<readonly Record<string, unknown>[]> => {
                    const { sql, params } = dialect.sqlToQuery(condition);
                    statements.push({ fields: Object.keys(fields).sort(), sql, params });

                    return Promise.resolve(rows);
                },
            }),
        });

        return { db: { select } as unknown as FoodDrizzle, statements };
    }

    const ROW = {
        id: 'food-a',
        name: 'Broccoli, raw',
        status: 'RESOLVED',
        userId: null,
        visibility: 'public',
        retiredAt: null,
    };

    it('issues ONE statement for the whole list, binding the ids as a single array parameter', async () => {
        const { db, statements } = makeSelectDb([ROW]);

        await new FoodDao(db).readRefFacts(['food-a', 'food-b', 'food-c']);

        expect(statements).toHaveLength(1);
        expect(statements[0]?.sql).toMatch(/= ANY\(\$1\)/u);
        expect(statements[0]?.params).toStrictEqual([['food-a', 'food-b', 'food-c']]);
        // Everything the resolver and the authorship policy decide over — and nothing heavier.
        // Curated U8 S4: `retiredAt` too, so a reader can tell a forwarded root from a live one (ADR-0050 §4).
        expect(statements[0]?.fields).toStrictEqual(['id', 'name', 'retiredAt', 'status', 'userId', 'visibility']);
    });

    it('returns each row with its visibility narrowed, its stored status (DELETING included) intact, and `retired` read off `retired_at`', async () => {
        const deleting = { ...ROW, id: 'food-b', status: 'DELETING', userId: 'u1', visibility: 'private' };
        const retired = { ...ROW, id: 'food-c', retiredAt: new Date('2026-09-30T00:00:00.000Z') };
        const { db } = makeSelectDb([ROW, deleting, retired]);

        await expect(new FoodDao(db).readRefFacts(['food-a', 'food-b', 'food-c'])).resolves.toStrictEqual([
            {
                id: 'food-a',
                name: 'Broccoli, raw',
                status: 'RESOLVED',
                userId: null,
                visibility: 'public',
                retired: false,
            },
            {
                id: 'food-b',
                name: 'Broccoli, raw',
                status: 'DELETING',
                userId: 'u1',
                visibility: 'private',
                retired: false,
            },
            {
                id: 'food-c',
                name: 'Broccoli, raw',
                status: 'RESOLVED',
                userId: null,
                visibility: 'public',
                retired: true,
            },
        ]);
    });

    it('throws on a visibility the 0013 CHECK cannot produce, rather than guessing at authorship', async () => {
        const { db } = makeSelectDb([{ ...ROW, visibility: 'shared' }]);

        await expect(new FoodDao(db).readRefFacts(['food-a'])).rejects.toThrow(/unknown food visibility 'shared'/u);
    });

    it('issues NO statement for an empty list', async () => {
        const { db, statements } = makeSelectDb([]);

        await expect(new FoodDao(db).readRefFacts([])).resolves.toStrictEqual([]);
        expect(statements).toHaveLength(0);
    });
});
