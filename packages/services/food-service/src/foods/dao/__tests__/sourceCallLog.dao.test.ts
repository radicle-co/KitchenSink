/**
 * Unit tests for {@link SourceCallLogDao}'s trailing-window configuration (`FOOD_SOURCE_WINDOW_SECONDS`,
 * FR-019/FR-020).
 *
 * The window length is the denominator of the whole per-source rate limit: every `checkAndRecord`,
 * `countInWindow`, and `pruneAged` predicate is `called_at > now() - make_interval(secs => window)`. The DAO
 * used to resolve it at MODULE-LOAD time with a hand-rolled `Number(process.env[...] ?? 3600)` plus its own
 * integer check — which restated the default `EnvironmentSchema` already owns (two literals that could
 * drift) and made the value untestable and unobservable. It now comes from the ONE validated reader,
 * resolved per instance, so a malformed value fails at construction with the variable named.
 *
 * These assert the SQL the DAO will actually run (rendered through the real `PgDialect`, params included),
 * which is the observable consequence at this layer; `tests/sourceCallLog.dao.integration.test.ts` proves
 * the same knob changes what Postgres counts.
 *
 * @implements FR-019 FR-020
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvironmentSchema } from '../../../config/env.schema.js';
import type { FoodDrizzle } from '../../../database/database.module.js';
import { SourceCallLogDao } from '../sourceCallLog.dao.js';

const dialect = new PgDialect();

/** A fake Drizzle client that records the rendered SQL + params of every query it is handed. */
function makeDb(): { db: FoodDrizzle; queries: { sql: string; params: unknown[] }[] } {
    const queries: { sql: string; params: unknown[] }[] = [];

    const execute = (query: SQL): Promise<{ rows: { n: number }[] }> => {
        const { sql, params } = dialect.sqlToQuery(query);
        queries.push({ sql, params });

        return Promise.resolve({ rows: [{ n: 0 }] });
    };

    return { db: { execute } as unknown as FoodDrizzle, queries };
}

/** The `FOOD_SOURCE_WINDOW_SECONDS` default the boot-time schema applies — never restated as a literal. */
const SCHEMA_DEFAULT_WINDOW = EnvironmentSchema.parse({
    STAGE: 'test',
    DATABASE_URL: 'postgresql://food_app:pw@localhost:5432/kitchensink_food',
    USDA_API_KEY: 'test-usda-key',
}).FOOD_SOURCE_WINDOW_SECONDS;

describe('SourceCallLogDao — the configured trailing window', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('windows its count on the schema default when FOOD_SOURCE_WINDOW_SECONDS is unset', async () => {
        vi.stubEnv('FOOD_SOURCE_WINDOW_SECONDS', undefined);
        const { db, queries } = makeDb();

        await new SourceCallLogDao(db).countInWindow('usda');

        expect(queries[0]?.sql).toContain('make_interval(secs => $');
        expect(queries[0]?.params).toContain(SCHEMA_DEFAULT_WINDOW);
    });

    it('windows its count on the CONFIGURED value — a lowered window reaches the query', async () => {
        vi.stubEnv('FOOD_SOURCE_WINDOW_SECONDS', '60');
        const { db, queries } = makeDb();

        await new SourceCallLogDao(db).countInWindow('usda');

        expect(queries[0]?.params).toContain(60);
        expect(queries[0]?.params).not.toContain(SCHEMA_DEFAULT_WINDOW);
    });

    it('applies the configured window to the prune predicate too, not just the count', async () => {
        vi.stubEnv('FOOD_SOURCE_WINDOW_SECONDS', '120');
        const { db, queries } = makeDb();

        await new SourceCallLogDao(db).pruneAged('usda');

        expect(queries[0]?.sql).toContain('DELETE FROM source_call_log');
        expect(queries[0]?.params).toContain(120);
    });

    it.each(['an hour', '', '0', '-1', '2.5', 'NaN', 'Infinity'])(
        'fails at construction on the malformed window %o, naming the variable',
        (value) => {
            vi.stubEnv('FOOD_SOURCE_WINDOW_SECONDS', value);
            const { db } = makeDb();

            expect(() => new SourceCallLogDao(db)).toThrow(/FOOD_SOURCE_WINDOW_SECONDS/);
        },
    );

    it('rejects exactly what the boot-time schema rejects (one rule, not two)', () => {
        for (const value of ['an hour', '', '0', '-1', '2.5', 'NaN', 'Infinity']) {
            vi.stubEnv('FOOD_SOURCE_WINDOW_SECONDS', value);

            expect(
                EnvironmentSchema.safeParse({
                    STAGE: 'test',
                    DATABASE_URL: 'postgresql://food_app:pw@localhost:5432/kitchensink_food',
                    USDA_API_KEY: 'test-usda-key',
                    FOOD_SOURCE_WINDOW_SECONDS: value,
                }).success,
            ).toBe(false);
            expect(() => new SourceCallLogDao(makeDb().db)).toThrow();
        }
    });
});
