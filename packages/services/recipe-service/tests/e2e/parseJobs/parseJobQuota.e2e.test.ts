/**
 * The daily import allowance (004 FR-022) against the REAL app and a REAL database (LOCAL e2e,
 * `docs/CODING_STANDARDS.md` §7.1a; migration 0058).
 *
 * What only this tier can prove, and the mutation each test is there to kill:
 *
 *  - migration 0058 applied, and the SERVICE role (`recipe_app`, DML only, ADR-0039) can insert, read and delete the
 *    ledger with no GRANT written in the migration (the default privileges did it);
 *  - the ledger's CHECKs refuse an invented channel and a non-positive unit count;
 *  - the 201st paste in a trailing 24 h is `429 IMPORT_QUOTA_EXCEEDED`, the 200th is `202`;
 *  - a multi-line paste is ONE unit (kills: charging per line);
 *  - `resetsAt` is EXACTLY the oldest in-window unit plus 24 h, read back from the table (kills: newest event, or
 *    `now + 24 h`);
 *  - a unit older than 24 h neither counts nor survives (kills: the window edge, the prune);
 *  - a refusal leaves no job, no line and no new ledger row (kills: admission after the insert);
 *  - the per-user advisory lock is real: while another session holds the lock key, a create WAITS on it and writes
 *    nothing, then completes when it is released (kills: removing the lock — every time, not by chance);
 *  - two concurrent creates at 199 units admit exactly one (kills: a read-then-write without the lock).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { ADVISORY_LOCK_CLASSES } from '@kitchensink/db-schema-guard';
import { apiErrorSchema, parseJobResponseSchema, recipeApiErrorSchema } from '@kitchensink/schema-recipe';

import { IMPORT_ALLOWANCE_DAILY_LIMIT, IMPORT_ALLOWANCE_WINDOW_MS } from '../../../src/common/importAllowancePolicy.js';
import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { recipeDb } from '../../support/roleDb.js';

const USER = '01JIMPORTQUOTAE2EUSER0001';
const OTHER = '01JIMPORTQUOTAE2EUSER0002';
const roleDb = recipeDb();

describe('the daily import allowance (LOCAL e2e)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: USER });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 4 });
    });

    afterEach(async () => {
        await pool.query('DELETE FROM recipe_parse_jobs WHERE owner_id = ANY($1)', [[USER, OTHER]]);
        await pool.query('DELETE FROM import_allowance_events WHERE user_id = ANY($1)', [[USER, OTHER]]);
    });

    afterAll(async () => {
        await pool.end();
        await booted.close();
    });

    /** Seed `units` single-unit paste events `ageHours` old, for `userId`, as the service role. */
    async function seed(userId: string, units: number, ageHours: number): Promise<void> {
        await pool.query(
            `INSERT INTO import_allowance_events (user_id, channel, units, created_at)
             SELECT $1, 'paste', 1, clock_timestamp() - make_interval(hours => $3::int) - (g * interval '1 millisecond')
               FROM generate_series(1, $2::int) AS g`,
            [userId, units, ageHours],
        );
    }

    async function paste(text: string): Promise<Response> {
        return fetch(`${booted.baseUrl}/api/v1/recipe-parse-jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
        });
    }

    async function ledgerUnits(userId: string = USER): Promise<number> {
        const result = await pool.query(
            'SELECT COALESCE(sum(units), 0)::int AS units FROM import_allowance_events WHERE user_id = $1',
            [userId],
        );

        return (result.rows[0] as { units: number }).units;
    }

    async function jobCount(userId: string = USER): Promise<number> {
        const result = await pool.query('SELECT count(*)::int AS n FROM recipe_parse_jobs WHERE owner_id = $1', [
            userId,
        ]);

        return (result.rows[0] as { n: number }).n;
    }

    describe('the migration (0058)', () => {
        it('creates the ledger with its columns and the (user_id, created_at) index', async () => {
            const columns = await pool.query(
                `SELECT column_name FROM information_schema.columns WHERE table_name = 'import_allowance_events' ORDER BY column_name`,
            );
            const indexes = await pool.query(
                `SELECT indexdef FROM pg_indexes WHERE tablename = 'import_allowance_events'`,
            );

            expect(columns.rows.map((row: { column_name: string }) => row.column_name)).toEqual([
                'channel',
                'created_at',
                'id',
                'units',
                'user_id',
            ]);
            expect(indexes.rows.map((row: { indexdef: string }) => row.indexdef).join('\n')).toMatch(
                /\(user_id, created_at\)/u,
            );
        });

        it('lets the service role insert, read and delete (default privileges, no GRANT in the migration)', async () => {
            await pool.query(`INSERT INTO import_allowance_events (user_id, channel, units) VALUES ($1, 'paste', 1)`, [
                USER,
            ]);

            expect(await ledgerUnits()).toBe(1);
            expect((await pool.query('DELETE FROM import_allowance_events WHERE user_id = $1', [USER])).rowCount).toBe(
                1,
            );
        });

        it.each([
            ['an invented channel', `'email'`, 1],
            ['zero units', `'paste'`, 0],
            ['negative units', `'paste'`, -3],
        ])('refuses %s', async (_name, channel, units) => {
            await expect(
                pool.query(
                    `INSERT INTO import_allowance_events (user_id, channel, units) VALUES ($1, ${channel}, $2)`,
                    [USER, units],
                ),
            ).rejects.toMatchObject({ code: '23514' });
        });
    });

    describe('admission over HTTP', () => {
        it('admits the 200th unit and refuses the 201st with 429 IMPORT_QUOTA_EXCEEDED', async () => {
            await seed(USER, IMPORT_ALLOWANCE_DAILY_LIMIT - 1, 1);

            const admitted = await paste('2 cups flour');

            expect(admitted.status).toBe(202);
            parseJobResponseSchema.parse(await admitted.json());
            expect(await ledgerUnits()).toBe(IMPORT_ALLOWANCE_DAILY_LIMIT);

            const refused = await paste('1 tsp salt');

            expect(refused.status).toBe(429);

            const raw: unknown = await refused.json();

            expect(apiErrorSchema.parse(raw).code).toBe('IMPORT_QUOTA_EXCEEDED');
            expect(recipeApiErrorSchema.parse(raw)).toMatchObject({ code: 'IMPORT_QUOTA_EXCEEDED' });
        });

        it('⛔ charges ONE unit for a many-line paste', async () => {
            const response = await paste('2 cups flour\n1 tsp salt\n3 large eggs\n1 cup milk\n1 tbsp oil');

            expect(response.status).toBe(202);
            expect(await ledgerUnits()).toBe(1);
        });

        it('⛔ names resetsAt as the OLDEST in-window unit plus 24 h, exactly', async () => {
            // 150 units 1 h ago, 49 units 10 h ago, 1 unit 20 h ago: the allowance is full and the 20 h-old unit
            // is the first to leave. `now + 24 h` and the newest event both give a different instant.
            await seed(USER, 150, 1);
            await seed(USER, 49, 10);
            await seed(USER, 1, 20);

            const response = await paste('2 cups flour');

            expect(response.status).toBe(429);

            const body = recipeApiErrorSchema.parse(await response.json());

            if (body.code !== 'IMPORT_QUOTA_EXCEEDED') {
                throw new Error(`expected IMPORT_QUOTA_EXCEEDED, got ${body.code}`);
            }

            const oldest = await pool.query(
                'SELECT min(created_at) AS oldest FROM import_allowance_events WHERE user_id = $1',
                [USER],
            );
            const expected = new Date(
                (oldest.rows[0] as { oldest: Date }).oldest.getTime() + IMPORT_ALLOWANCE_WINDOW_MS,
            );

            expect(body.details.resetsAt).toBe(expected.toISOString());
        });

        it('⛔ a refusal leaves no job, no line and no new ledger row', async () => {
            await seed(USER, IMPORT_ALLOWANCE_DAILY_LIMIT, 1);
            const before = await ledgerUnits();

            const response = await paste('2 cups flour\n1 tsp salt');

            expect(response.status).toBe(429);
            expect(await jobCount()).toBe(0);
            expect(await ledgerUnits()).toBe(before);

            const lines = await pool.query(
                `SELECT count(*)::int AS n FROM recipe_parse_job_lines l JOIN recipe_parse_jobs j ON j.id = l.job_id WHERE j.owner_id = $1`,
                [USER],
            );

            expect((lines.rows[0] as { n: number }).n).toBe(0);
        });

        it('⛔ a unit older than 24 h neither counts nor survives', async () => {
            // 199 fresh units and 5 expired ones: the expired five must not push the caller over the limit.
            await seed(USER, IMPORT_ALLOWANCE_DAILY_LIMIT - 1, 1);
            await seed(USER, 5, 25);

            const response = await paste('2 cups flour');

            expect(response.status).toBe(202);

            const old = await pool.query(
                `SELECT count(*)::int AS n FROM import_allowance_events WHERE user_id = $1 AND created_at < clock_timestamp() - interval '24 hours'`,
                [USER],
            );

            expect((old.rows[0] as { n: number }).n).toBe(0);
            expect(await ledgerUnits()).toBe(IMPORT_ALLOWANCE_DAILY_LIMIT);
        });

        it("counts each caller's allowance separately", async () => {
            await seed(OTHER, IMPORT_ALLOWANCE_DAILY_LIMIT, 1);

            const response = await paste('2 cups flour');

            expect(response.status).toBe(202);
            expect(await ledgerUnits(OTHER)).toBe(IMPORT_ALLOWANCE_DAILY_LIMIT);
        });
    });

    describe('the per-user advisory lock', () => {
        it('⛔ makes a create WAIT while another session holds the lock key, and write nothing until it is released', async () => {
            const holder = new pg.Client({ connectionString: roleDb.appUrl });

            await holder.connect();

            try {
                // The key is (class, hashtext(user_id)): the registry's class, never an integer invented here.
                await holder.query('SELECT pg_advisory_lock($1::int4, hashtext($2::text))', [
                    ADVISORY_LOCK_CLASSES.recipeImportAllowance,
                    USER,
                ]);

                const inFlight = paste('2 cups flour');

                // Deterministic, not a sleep-and-hope: wait until the database REPORTS a session waiting on that key.
                await expect
                    .poll(
                        async () => {
                            const waiting = await pool.query(
                                `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND classid = $1::oid`,
                                [ADVISORY_LOCK_CLASSES.recipeImportAllowance],
                            );

                            return (waiting.rows[0] as { n: number }).n;
                        },
                        { timeout: 10_000, interval: 50 },
                    )
                    .toBe(1);

                expect(await jobCount()).toBe(0);
                expect(await ledgerUnits()).toBe(0);

                await holder.query('SELECT pg_advisory_unlock($1::int4, hashtext($2::text))', [
                    ADVISORY_LOCK_CLASSES.recipeImportAllowance,
                    USER,
                ]);

                const response = await inFlight;

                expect(response.status).toBe(202);
                expect(await ledgerUnits()).toBe(1);
            } finally {
                await holder.end();
            }
        });

        it('⛔ admits exactly one of two concurrent creates at 199 units', async () => {
            await seed(USER, IMPORT_ALLOWANCE_DAILY_LIMIT - 1, 1);

            const statuses = (await Promise.all([paste('2 cups flour'), paste('1 tsp salt')])).map(
                (response) => response.status,
            );

            expect([...statuses].sort()).toEqual([202, 429]);
            expect(await ledgerUnits()).toBe(IMPORT_ALLOWANCE_DAILY_LIMIT);
            expect(await jobCount()).toBe(1);
        });
    });
});
