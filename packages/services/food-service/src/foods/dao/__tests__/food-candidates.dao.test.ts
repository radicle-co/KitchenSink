/**
 * Unit tests for {@link CandidateStore}'s configured candidate-set TTL (`FOOD_UNRESOLVED_TTL_DAYS`,
 * FR-025a).
 *
 * `FOOD_UNRESOLVED_TTL_DAYS` is a LIVE knob — `infra/lib/food-service-stack.ts` stamps it into the
 * change-refresh task definition, and `settingFromEnv` already feeds the SWEEP half
 * ({@link CandidateStore.clearExpired}, via `ChangeRefreshConsumer`). Its READ half did not follow: the
 * `getCandidates` visibility window was a module literal (`sql\`interval '30 days'\``). The two halves are
 * ONE rule (FR-025a) with two representations, so any configured value above 30 opened a real gap — a
 * candidate set aged 31–59 days under `FOOD_UNRESOLVED_TTL_DAYS=60` is still in the table (the sweep has
 * not reached it) yet invisible to `GET /api/v1/foods/{id}/candidates`, leaving the food UNRESOLVED with
 * an empty candidate list and no way for the user to disambiguate it.
 *
 * The behavioural half of this lives in `tests/food-candidates.dao.integration.test.ts` (a real 40-day-old
 * set under a 60-day TTL); this file pins the fail-loud contract and the sweep's default.
 *
 * @implements FR-025a
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvironmentSchema } from '../../../config/env.schema.js';
import type { FoodDrizzle } from '../../../database/database.module.js';
import { CandidateStore } from '../food-candidates.dao.js';

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

describe('CandidateStore — the configured UNRESOLVED candidate-set TTL (FR-025a)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('sweeps on the schema default when FOOD_UNRESOLVED_TTL_DAYS is unset and no TTL is passed', async () => {
        vi.stubEnv('FOOD_UNRESOLVED_TTL_DAYS', undefined);
        const { db, queries } = makeDb();

        await new CandidateStore(db).clearExpired();

        expect(queries[0]?.sql).toContain('make_interval(days => $');
        expect(queries[0]?.params).toContain(SCHEMA_DEFAULTS.FOOD_UNRESOLVED_TTL_DAYS);
    });

    it('sweeps on the CONFIGURED TTL when no TTL is passed', async () => {
        vi.stubEnv('FOOD_UNRESOLVED_TTL_DAYS', '60');
        const { db, queries } = makeDb();

        await new CandidateStore(db).clearExpired();

        expect(queries[0]?.params).toContain(60);
    });

    it('still honours an explicit sweep TTL (ChangeRefreshConsumer passes its own resolved value)', async () => {
        vi.stubEnv('FOOD_UNRESOLVED_TTL_DAYS', '60');
        const { db, queries } = makeDb();

        await new CandidateStore(db).clearExpired(5);

        expect(queries[0]?.params).toContain(5);
        expect(queries[0]?.params).not.toContain(60);
    });

    it('takes an options override, so a caller holding a validated Environment can pass it', async () => {
        vi.stubEnv('FOOD_UNRESOLVED_TTL_DAYS', '60');
        const { db, queries } = makeDb();

        await new CandidateStore(db, { ttlDays: 15 }).clearExpired();

        expect(queries[0]?.params).toContain(15);
    });

    it.each(['a month', '', '0', '-1', '2.5', 'NaN', 'Infinity'])(
        'fails at construction on the malformed TTL %o, naming the variable',
        (value) => {
            vi.stubEnv('FOOD_UNRESOLVED_TTL_DAYS', value);

            expect(() => new CandidateStore(makeDb().db)).toThrow(/FOOD_UNRESOLVED_TTL_DAYS/);
        },
    );
});
