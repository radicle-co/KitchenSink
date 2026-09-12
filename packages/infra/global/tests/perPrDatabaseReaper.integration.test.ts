/**
 * The per-PR database reaper (ADR-0031) against REAL PostgreSQL.
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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { applyRoleModel, readRoleCensus, type DatabaseRoles } from '@kitchensink/db-schema-guard';

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

describe.skipIf(!DATABASE_URL)('per-PR database reaper against real PostgreSQL (ADR-0031)', () => {
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

    /**
     * Step 0 of the database role split (`docs/plans/2026-09-11-database-role-split.md`): the census the reaper
     * reports so the LIVE graph can be measured before anything is built on assumptions about it. What matters is
     * that it SEES a nested path to `rds_iam` — the shape AWS says forces IAM auth on the master — and reports none
     * when there is none; a census that could not see the path would certify every lock-out as safe.
     */
    describe('role census (role-split Step 0)', () => {
        const APP = 'ks_census_app';
        const OWNER = 'ks_census_owner';

        it('reports the connecting role, its attributes, and the owner of every kitchensink database', async () => {
            const census = await readRoleCensus(pool);
            const me = (await pool.query<{ u: string }>('SELECT current_user AS u')).rows[0]?.u;

            expect(census.currentUser).toBe(me);
            expect(census.serverVersion).toMatch(/^\d+/u);
            expect(typeof census.attributes.createdb).toBe('boolean');
            expect(census.databaseOwners).toEqual(
                expect.arrayContaining([{ datname: 'kitchensink_food_pr_1', owner: me }]),
            );
        });

        it('reports whether the connecting role holds ADMIN on each role the split must grant — measured, not assumed', async () => {
            // Step 0 found the sandbox master holds NO pg_auth_members edge to food_app/recipe_app — not even the
            // ADMIN-only one PostgreSQL 16+ records for a role a CREATEROLE user creates. Whether it can still
            // GRANT them (e.g. via rds_superuser) is not in that catalog, so it is asked of `pg_has_role`, from a
            // NON-superuser CREATEROLE role: ADMIN on a role it created, none on a role it did not.
            const MASTER = 'ks_census_master';
            const MINE = 'ks_census_mine';
            const THEIRS = 'ks_census_theirs';
            const base = DATABASE_URL?.replace(/\/\/[^@]*@/u, `//${MASTER}:pw@`) ?? '';
            let master: pg.Pool | undefined;

            try {
                await pool.query(`CREATE ROLE ${MASTER} LOGIN PASSWORD 'pw' NOSUPERUSER CREATEROLE CREATEDB`);
                await pool.query(`CREATE ROLE ${THEIRS} NOLOGIN`);
                master = new pg.Pool({ connectionString: base, max: 1 });
                await master.query(`CREATE ROLE ${MINE} NOLOGIN`);

                const census = await readRoleCensus(master, { adminProbe: [MINE, THEIRS, 'ks_census_absent'] });

                expect(census.currentUser).toBe(MASTER);
                expect(census.adminOn).toEqual({ [MINE]: true, [THEIRS]: false, ks_census_absent: null });
            } finally {
                await master?.end();
                await pool.query(`DROP ROLE IF EXISTS ${MINE}`);
                await pool.query(`DROP ROLE IF EXISTS ${THEIRS}`);
                await pool.query(`DROP ROLE IF EXISTS ${MASTER}`);
            }
        });

        it('⛔ SEES a nested path from the connecting role to rds_iam, and reports none without one', async () => {
            const createdIam = (await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'rds_iam'")).rowCount === 0;
            const me = (await pool.query<{ u: string }>('SELECT current_user AS u')).rows[0]?.u ?? '';

            try {
                if (createdIam) {
                    await pool.query('CREATE ROLE rds_iam NOLOGIN');
                }

                await pool.query(`CREATE ROLE ${APP} NOLOGIN`);
                await pool.query(`CREATE ROLE ${OWNER} NOLOGIN`);
                await pool.query(`GRANT rds_iam TO ${APP}`);
                // A membership in a role that does NOT reach rds_iam — the shape the design gives the master.
                await pool.query(`GRANT ${OWNER} TO "${me}"`);

                expect((await readRoleCensus(pool)).currentUserPathsToRdsIam).toEqual([]);

                // The trap: the master joins a role that holds rds_iam.
                await pool.query(`GRANT ${APP} TO "${me}"`);

                expect((await readRoleCensus(pool)).currentUserPathsToRdsIam).toEqual([[me, APP, 'rds_iam']]);
            } finally {
                await pool.query(`DROP ROLE IF EXISTS ${APP}`);
                await pool.query(`DROP ROLE IF EXISTS ${OWNER}`);

                if (createdIam) {
                    await pool.query('DROP ROLE IF EXISTS rds_iam');
                }
            }
        });
    });
});

/**
 * The reaper under the role split (ADR-0039), connected as a NOSUPERUSER stand-in for the RDS master — the shape
 * it has on sandbox. Everything above runs as `postgres`, a SUPERUSER, which may drop any database whoever owns it:
 * that suite could not have failed on the defect that made the role split necessary (`must be owner of database`,
 * 14 per-PR databases leaked on sandbox).
 *
 * The shape: per-PR databases are created by the MIGRATOR, `OWNER <svc>_owner`, exactly as the runners create them;
 * the master reaches the owner through the INHERIT membership `applyRoleModel` grants it outside prod, and holds
 * `pg_signal_backend` (RDS confers it through `rds_superuser`). The superuser only builds fixtures and reads the
 * catalogue. Roles are prefixed `ksr_` so this never collides with a harness provisioning the real names.
 */
describe.skipIf(!DATABASE_URL)('per-PR database reaper as a NOSUPERUSER master, under the role split', () => {
    const MASTER = 'ksr_master';
    const PASSWORD = 'ksr-pw';
    const FOOD: DatabaseRoles = { owner: 'ksr_food_owner', migrator: 'ksr_food_migrator', app: 'ksr_food_app' };
    const RECIPE: DatabaseRoles = {
        owner: 'ksr_recipe_owner',
        migrator: 'ksr_recipe_migrator',
        app: 'ksr_recipe_app',
    };
    const OWNED = ['kitchensink_food_pr_3', 'kitchensink_recipes_pr_3'] as const;
    const APP_OWNED = 'kitchensink_food_pr_4';

    const admin = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
    let master: pg.Pool;

    const urlFor = (role: string, database: string): string => {
        const url = new URL(DATABASE_URL ?? 'postgres://localhost/postgres');

        url.username = role;
        url.password = PASSWORD;
        url.pathname = `/${database}`;

        return url.toString();
    };

    async function exists(name: string): Promise<boolean> {
        const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);

        return (found.rowCount ?? 0) > 0;
    }

    async function ownerOf(name: string): Promise<string | undefined> {
        const found = await admin.query<{ owner: string }>(
            'SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1',
            [name],
        );

        return found.rows[0]?.owner;
    }

    /** Create `database` as `roles.migrator`, `OWNER roles.owner` — the runners' per-PR shape. */
    async function createAsMigrator(roles: DatabaseRoles, database: string): Promise<void> {
        const migrator = new pg.Client({ connectionString: urlFor(roles.migrator, 'postgres') });

        await migrator.connect();

        try {
            await migrator.query(`CREATE DATABASE "${database}" OWNER "${roles.owner}"`);
        } finally {
            await migrator.end();
        }
    }

    async function cleanUp(): Promise<void> {
        for (const database of [...OWNED, APP_OWNED]) {
            await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        }

        for (const role of [...Object.values(FOOD), ...Object.values(RECIPE), MASTER]) {
            await admin.query(`DROP ROLE IF EXISTS "${role}"`);
        }
    }

    beforeAll(async () => {
        await cleanUp();
        await admin.query(
            "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rds_iam') THEN CREATE ROLE rds_iam NOLOGIN; END IF; END $$",
        );
        await admin.query(`CREATE ROLE ${MASTER} LOGIN NOSUPERUSER CREATEROLE CREATEDB PASSWORD '${PASSWORD}'`);
        await admin.query(`GRANT rds_iam TO ${MASTER} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
        await admin.query(`GRANT pg_signal_backend TO ${MASTER}`);

        master = new pg.Pool({ connectionString: urlFor(MASTER, 'postgres'), max: 2 });

        // The REAL role model, applied by the stand-in master. `inherit-or-set`: vanilla PostgreSQL records the
        // stand-in's ADMIN as rows RDS holds without one (see dbBootstrap.integration.test.ts).
        for (const roles of [FOOD, RECIPE]) {
            await applyRoleModel(master, {
                roles,
                context: { master: MASTER, isProd: false, lockOutEdges: 'inherit-or-set' },
            });
            await admin.query(`ALTER ROLE "${roles.migrator}" PASSWORD '${PASSWORD}'`);
            await admin.query(`ALTER ROLE "${roles.app}" PASSWORD '${PASSWORD}'`);
        }
    });

    beforeEach(async () => {
        for (const database of [...OWNED, APP_OWNED]) {
            await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        }

        await createAsMigrator(FOOD, 'kitchensink_food_pr_3');
        await createAsMigrator(RECIPE, 'kitchensink_recipes_pr_3');
    });

    afterAll(async () => {
        await master?.end();
        await cleanUp();
        await admin.end();
    });

    it('drops the per-PR databases a MIGRATOR created OWNER <svc>_owner — through the master INHERITing the owner', async () => {
        expect(await ownerOf('kitchensink_food_pr_3')).toBe(FOOD.owner);
        expect(await ownerOf('kitchensink_recipes_pr_3')).toBe(RECIPE.owner);

        const request = { action: 'drop', pr: 'pr-3' } as const;
        const outcome = await executeReap(master, planReap(await readPerPrCatalog(master), request), request);

        expect(outcome.dropped).toEqual([...OWNED]);

        for (const database of OWNED) {
            expect(await exists(database), database).toBe(false);
        }
    });

    it("⛔ FORCES the service role's open session — the master may terminate it through pg_signal_backend", async () => {
        // A fresh database still grants CONNECT to PUBLIC; the runner closes it on its first migration.
        const squatter = new pg.Pool({ connectionString: urlFor(FOOD.app, 'kitchensink_food_pr_3'), max: 1 });

        squatter.on('error', () => undefined);

        try {
            await squatter.query('SELECT 1');

            const request = { action: 'drop', pr: 'pr-3' } as const;

            await executeReap(master, planReap(await readPerPrCatalog(master), request), request);

            expect(await exists('kitchensink_food_pr_3')).toBe(false);
        } finally {
            await squatter.end();
        }
    });

    it('⛔ NEGATIVE CONTROL: refuses an APP-owned database with 42501 and leaves it standing', async () => {
        // The pre-split shape: the service role owned its per-PR database. The master is not a member of the app
        // role (it must never be — the app holds rds_iam), so PostgreSQL refuses the drop. This is the failure the
        // superuser suite above cannot produce, and the reason the owner role exists.
        await admin.query(`CREATE DATABASE "${APP_OWNED}" OWNER "${FOOD.app}"`);

        const request = { action: 'drop', pr: 'pr-4' } as const;
        const plan = planReap(await readPerPrCatalog(master), request);

        expect(plan.drop).toEqual([APP_OWNED]);
        await expect(executeReap(master, plan, request)).rejects.toMatchObject({ code: '42501' });
        expect(await exists(APP_OWNED)).toBe(true);
    });
});
