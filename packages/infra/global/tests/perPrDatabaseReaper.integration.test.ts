/**
 * The per-PR database reaper (ADR-0030) against REAL PostgreSQL.
 *
 * ## What a fake pool structurally cannot prove
 *
 * `perPrDatabaseReaper.test.ts` proves the reaper issues the statements it means to. It cannot prove any of
 * the things that make a `DROP DATABASE` capability correct in the world, and every one of them has a way of
 * being wrong that a call-log assertion reads straight past:
 *
 *  - **that the drop actually removes the database**, rather than erroring in a way nobody reads — the
 *    teardown script's own history is a lesson in this (`aws lambda invoke` exits 0 when the function threw);
 *  - **that `WITH (FORCE)` defeats a live session.** A torn-down preview leaves sessions behind, and without
 *    FORCE PostgreSQL answers `55006 object_in_use` and the database survives every future sweep. This is the
 *    single most load-bearing clause in the statement and only a real server can answer it;
 *  - **that the BASE database and the NEIGHBOURING PR survive** a reap. The scope predicate is asserted
 *    exhaustively in isolation; this asserts the whole path end to end, against the catalogue itself;
 *  - **that the `LIKE … ESCAPE` narrowing finds the per-PR databases and not `kitchensink_identity`** —
 *    `_` is a single-character wildcard in `LIKE`, so the obvious pattern matches names it has no business
 *    claiming, and the escaping is only observable against a real catalogue;
 *  - **that dropping an ABSENT database is a no-op**, so a teardown that runs twice (a re-run, then the daily
 *    reaper) is idempotent rather than an error that reads as a failed reclamation.
 *
 * ## How to run it
 *
 * `DATABASE_URL` must point at the MAINTENANCE database of a throwaway PostgreSQL as a superuser — the
 * reaper connects to `postgres` because `DROP DATABASE` cannot run from inside the database being dropped.
 * CI supplies one as a service container; locally:
 *
 *     docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres --name reaper-it-pg postgres:18
 *     DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:integration \
 *         --workspace=@kitchensink/infra-global
 *
 * ⛔ It CREATES and DROPS databases, so it must never be pointed at anything that matters. The names it
 * creates are the real ADR-0006 shapes on purpose — a fixture with invented names would not exercise the
 * predicate — which is exactly why the target must be disposable.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { executeReap, readPerPrCatalog } from '../src/db-reaper/handler.js';
import { planReap } from '../src/db-reaper/reapPlan.js';

const DATABASE_URL = process.env['DATABASE_URL'];

/** The PR under test, and a NEIGHBOUR whose survival is the point of the delimiter rule. */
const TARGET = 'pr-1';
const NEIGHBOUR = 'pr-15';

/**
 * Every database this suite creates. The `kitchensink_food` base stands in for the shared, persistent one
 * the reaper must never touch; `kitchensink_recipes_dev` for a per-stage database that belongs to no PR.
 */
const FIXTURE_DATABASES = [
    'kitchensink_food',
    'kitchensink_food_pr_1',
    'kitchensink_recipes_pr_1',
    'kitchensink_food_pr_15',
    'kitchensink_recipes_dev',
    // ⛔ The name that ONLY an unescaped `LIKE` pattern reaches. In `LIKE`, `_` is a single-character
    // wildcard, so the obvious `` `${base}_%` `` reads `kitchensink_food_%` as "kitchensink, any character,
    // food, any character, anything" — which matches this. `perPrLikePattern` escapes it; nothing else in
    // this repository would notice if it stopped.
    'kitchensinkxfoodx_pr_1',
] as const;

describe.skipIf(!DATABASE_URL)('per-PR database reaper against real PostgreSQL (ADR-0030)', () => {
    const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

    /** Whether a database exists, asked of the catalogue rather than inferred from a return value. */
    async function exists(name: string): Promise<boolean> {
        const found = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);

        return (found.rowCount ?? 0) > 0;
    }

    async function dropIfPresent(name: string): Promise<void> {
        await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }

    beforeEach(async () => {
        for (const name of FIXTURE_DATABASES) {
            await dropIfPresent(name);
            await pool.query(`CREATE DATABASE "${name}"`);
        }
    });

    afterEach(async () => {
        for (const name of FIXTURE_DATABASES) {
            await dropIfPresent(name);
        }
    });

    afterAll(async () => {
        await pool.end();
    });

    it('reads the per-PR databases out of the catalogue, and not the base or the system ones', async () => {
        const names = (await readPerPrCatalog(pool)).map((row) => row.datname).sort();

        // ⛔ `kitchensink_food` must be ABSENT. `LIKE 'kitchensink_food_%'` without the escape reads `_` as a
        // wildcard, and the base is what a mis-escaped pattern reaches first.
        expect(names).toContain('kitchensink_food_pr_1');
        expect(names).toContain('kitchensink_food_pr_15');
        expect(names).not.toContain('kitchensink_food');
        expect(names).not.toContain('postgres');
        expect(names).not.toContain('template1');
        // The escaping, asserted rather than assumed — see the fixture list.
        expect(names).not.toContain('kitchensinkxfoodx_pr_1');
    });

    it("drops exactly the target PR's databases, and NOTHING else on the instance", async () => {
        const request = { action: 'drop', pr: TARGET } as const;
        const outcome = await executeReap(pool, planReap(await readPerPrCatalog(pool), request), request);

        expect(outcome.dropped).toEqual(['kitchensink_food_pr_1', 'kitchensink_recipes_pr_1']);

        expect(await exists('kitchensink_food_pr_1')).toBe(false);
        expect(await exists('kitchensink_recipes_pr_1')).toBe(false);

        // ⛔ The three survivors, each for a different reason: the shared base, the NEIGHBOURING PR that a
        // prefix rule would have claimed, and a per-stage database belonging to no PR at all.
        expect(await exists('kitchensink_food')).toBe(true);
        expect(await exists('kitchensink_food_pr_15')).toBe(true);
        expect(await exists('kitchensink_recipes_dev')).toBe(true);
    });

    it('⛔ FORCES a database that still has an open session — the clause the whole drop hangs on', async () => {
        // A torn-down preview leaves sessions behind. Without `WITH (FORCE)` PostgreSQL answers
        // `55006 object_in_use`, the drop fails, and the database survives every subsequent sweep.
        const squatter = new pg.Pool({
            connectionString: `${DATABASE_URL?.replace(/\/[^/]*$/, '')}/kitchensink_food_pr_1`,
            max: 1,
        });

        // FORCE terminates this connection server-side, which `pg` surfaces as a `57P01` error event on the
        // now-idle client. That is the SUCCESS path here, so it is absorbed — left unhandled it becomes an
        // uncaught exception that reds the whole run and hides any real failure behind it.
        squatter.on('error', () => undefined);

        try {
            await squatter.query('SELECT 1');

            const request = { action: 'drop', pr: TARGET } as const;

            await executeReap(pool, planReap(await readPerPrCatalog(pool), request), request);

            expect(await exists('kitchensink_food_pr_1')).toBe(false);
        } finally {
            await squatter.end();
        }
    });

    it('is idempotent — a second reap of the same PR reports absence rather than failing', async () => {
        const request = { action: 'drop', pr: TARGET } as const;

        await executeReap(pool, planReap(await readPerPrCatalog(pool), request), request);

        const second = planReap(await readPerPrCatalog(pool), request);
        const outcome = await executeReap(pool, second, request);

        expect(outcome.dropped).toEqual([]);
        expect(outcome.absent).toEqual(['kitchensink_food_pr_1', 'kitchensink_recipes_pr_1']);
    });

    it('reaps a PR that owns only SOME of its databases', async () => {
        // pr-15 has a food database and no recipe one — a food-only preview, or a recipe deploy that failed
        // before its migration trigger ran. The reaper needs no stack, so it reclaims what is there.
        const request = { action: 'drop', pr: NEIGHBOUR } as const;
        const outcome = await executeReap(pool, planReap(await readPerPrCatalog(pool), request), request);

        expect(outcome.dropped).toEqual(['kitchensink_food_pr_15']);
        expect(outcome.absent).toEqual(['kitchensink_recipes_pr_15']);
        expect(await exists('kitchensink_food_pr_15')).toBe(false);
    });

    it('⛔ COUNTS without dropping — every fixture database survives a census', async () => {
        const plan = planReap(await readPerPrCatalog(pool), { action: 'count' });
        const outcome = await executeReap(pool, plan, { action: 'count' });

        expect(outcome.dropped).toEqual([]);
        expect(plan.census.total).toBe(3);
        expect(plan.census.byToken).toEqual({
            'pr-1': ['kitchensink_food_pr_1', 'kitchensink_recipes_pr_1'],
            'pr-15': ['kitchensink_food_pr_15'],
        });
        expect(plan.census.unrecognized).toEqual(['kitchensink_recipes_dev']);

        for (const name of FIXTURE_DATABASES) {
            expect(await exists(name), name).toBe(true);
        }
    });
});
