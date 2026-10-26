/**
 * The PER-CHANNEL import allowance (ADR-0072 §8) against a REAL database (LOCAL e2e, `docs/CODING_STANDARDS.md` §7.1a).
 *
 * `ImportAllowanceDal.admit` is driven directly as the SERVICE role (`recipe_app`), because the bulk route is not built
 * yet and the allowance is the part of it that only a real database can prove. What each case is there to catch:
 *
 *  - paste and bulk never borrow from each other (kills: summing every channel against one limit);
 *  - a file larger than the room left admits what fits and writes ONLY that (kills: all-or-nothing, or writing the
 *    request instead of the admitted units);
 *  - a 2,000-recipe file at an empty ledger admits exactly 1,000 (kills: a per-file cap, a limit of 200 on bulk);
 *  - `resetsAt` is read back from the table: the oldest counted bulk unit plus 24 h, and `now + 24 h` when the units
 *    just admitted are the oldest (kills: ignoring the admitted units, or reading another channel's rows);
 *  - the lock is real, deterministically: while another session holds the user's key a bulk admit WAITS and writes
 *    nothing, then completes when it is released (kills: removing the lock, every time and not by timing luck);
 *  - TWO CONCURRENT admits of 600 at zero spend exactly 1,000 in total: 600 and 400 (kills: removing the per-user lock,
 *    which lets both read an empty ledger and write 1,200);
 *  - each channel is pruned by its own rows: an expired bulk unit is deleted, a fresh paste unit survives it;
 *  - a refusal writes no row.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { ADVISORY_LOCK_CLASSES } from '@kitchensink/db-schema-guard';

import { ImportAllowanceDal, type AdmitOutcome } from '../../../src/common/dal/importAllowance.dal.js';
import { IMPORT_ALLOWANCE_LIMITS, IMPORT_ALLOWANCE_WINDOW_MS } from '../../../src/common/importAllowancePolicy.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { recipeDb } from '../../support/roleDb.js';

const USER = '01JIMPORTALLOWANCEE2E00001';
const OTHER = '01JIMPORTALLOWANCEE2E00002';
const FREE = { isPremium: false } as const;
const roleDb = recipeDb();

describe('the per-channel import allowance (LOCAL e2e)', () => {
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    const dal = new ImportAllowanceDal();

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 6 });
        db = createRecipeDrizzle(pool);
    });

    afterEach(async () => {
        await pool.query('DELETE FROM import_allowance_events WHERE user_id = ANY($1)', [[USER, OTHER]]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** One admission in its own transaction, the way a service call makes it. */
    function admit(channel: 'paste' | 'bulk', units: number, userId: string = USER): Promise<AdmitOutcome> {
        return db.transaction((tx) => dal.admit(tx, userId, { channel, units, tier: FREE }));
    }

    /** One ledger row of `units` on `channel`, `ageHours` old. */
    async function seed(channel: 'paste' | 'bulk', units: number, ageHours: number, userId: string = USER) {
        await pool.query(
            `INSERT INTO import_allowance_events (user_id, channel, units, created_at)
             VALUES ($1, $2, $3, clock_timestamp() - make_interval(hours => $4::int))`,
            [userId, channel, units, ageHours],
        );
    }

    async function spent(channel: 'paste' | 'bulk', userId: string = USER): Promise<number> {
        const result = await pool.query(
            'SELECT COALESCE(sum(units), 0)::int AS units FROM import_allowance_events WHERE user_id = $1 AND channel = $2',
            [userId, channel],
        );

        return (result.rows[0] as { units: number }).units;
    }

    it('⛔ a full paste allowance does not touch bulk, and a full bulk allowance does not touch paste', async () => {
        await seed('paste', IMPORT_ALLOWANCE_LIMITS.paste, 1);

        expect(await admit('bulk', 3)).toEqual({ kind: 'admitted', units: 3 });
        expect((await admit('paste', 1)).kind).toBe('refused');

        await seed('bulk', IMPORT_ALLOWANCE_LIMITS.bulk - 3, 1);

        expect((await admit('bulk', 1)).kind).toBe('refused');
        expect(await spent('paste')).toBe(IMPORT_ALLOWANCE_LIMITS.paste);
        expect(await spent('bulk')).toBe(IMPORT_ALLOWANCE_LIMITS.bulk);
    });

    it('⛔ a 2,000-recipe file at an empty ledger admits exactly 1,000 and names a day from now', async () => {
        const outcome = await admit('bulk', 2000);

        expect(outcome).toMatchObject({ kind: 'partial', units: 1000 });
        expect(await spent('bulk')).toBe(1000);

        const written = await pool.query(
            `SELECT created_at FROM import_allowance_events WHERE user_id = $1 AND channel = 'bulk'`,
            [USER],
        );

        if (outcome.kind !== 'partial') {
            throw new Error('expected a partial admission');
        }

        // The units admitted now are the only ones counted, so the next room opens a day after they were written.
        expect(outcome.resetsAt.getTime()).toBe(
            (written.rows[0] as { created_at: Date }).created_at.getTime() + IMPORT_ALLOWANCE_WINDOW_MS,
        );
    });

    it('⛔ admits only the room that is left and writes only that, with resetsAt from the OLDEST counted bulk unit', async () => {
        await seed('bulk', 300, 20);
        await seed('bulk', 500, 2);
        // A much older PASTE row must not become the reset instant of a bulk answer.
        await seed('paste', 1, 23);

        const outcome = await admit('bulk', 500);
        const oldest = await pool.query(
            `SELECT min(created_at) AS at FROM import_allowance_events WHERE user_id = $1 AND channel = 'bulk' AND units = 300`,
            [USER],
        );

        expect(outcome).toMatchObject({ kind: 'partial', units: 200 });
        expect(await spent('bulk')).toBe(1000);

        if (outcome.kind !== 'partial') {
            throw new Error('expected a partial admission');
        }

        expect(outcome.resetsAt.getTime()).toBe(
            (oldest.rows[0] as { at: Date }).at.getTime() + IMPORT_ALLOWANCE_WINDOW_MS,
        );
    });

    it('⛔ TWO CONCURRENT bulk admits of 600 at zero spend exactly 1,000: 600 and 400', async () => {
        const outcomes = await Promise.all([admit('bulk', 600), admit('bulk', 600)]);
        const units = outcomes.map((outcome) => (outcome.kind === 'refused' ? 0 : outcome.units)).sort();

        expect(units).toEqual([400, 600]);
        expect(await spent('bulk')).toBe(1000);
    });

    it('⛔ a bulk admit WAITS while another session holds the user lock, and writes nothing until it is released', async () => {
        const holder = new pg.Client({ connectionString: roleDb.appUrl });

        await holder.connect();

        try {
            await holder.query('SELECT pg_advisory_lock($1::int4, hashtext($2::text))', [
                ADVISORY_LOCK_CLASSES.recipeImportAllowance,
                USER,
            ]);

            const inFlight = admit('bulk', 5);

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

            expect(await spent('bulk')).toBe(0);

            await holder.query('SELECT pg_advisory_unlock($1::int4, hashtext($2::text))', [
                ADVISORY_LOCK_CLASSES.recipeImportAllowance,
                USER,
            ]);

            expect(await inFlight).toEqual({ kind: 'admitted', units: 5 });
            expect(await spent('bulk')).toBe(5);
        } finally {
            await holder.end();
        }
    });

    it('⛔ two concurrent admits across the two channels do not wait on each other for room', async () => {
        const outcomes = await Promise.all([admit('bulk', 1000), admit('paste', 1)]);

        expect(outcomes.map((outcome) => outcome.kind)).toEqual(['admitted', 'admitted']);
        expect(await spent('bulk')).toBe(1000);
        expect(await spent('paste')).toBe(1);
    });

    it('prunes an expired bulk unit under the lock and leaves a fresh paste unit alone', async () => {
        await seed('bulk', 5, 25);
        await seed('paste', 1, 1);

        expect(await admit('bulk', 1)).toEqual({ kind: 'admitted', units: 1 });

        const left = await pool.query(
            'SELECT channel, units FROM import_allowance_events WHERE user_id = $1 ORDER BY channel, units',
            [USER],
        );

        expect(left.rows).toEqual([
            { channel: 'bulk', units: 1 },
            { channel: 'paste', units: 1 },
        ]);
    });

    it("counts each caller's allowance separately", async () => {
        await seed('bulk', IMPORT_ALLOWANCE_LIMITS.bulk, 1, OTHER);

        expect(await admit('bulk', 10)).toEqual({ kind: 'admitted', units: 10 });
    });

    it('a refusal writes no ledger row', async () => {
        await seed('bulk', IMPORT_ALLOWANCE_LIMITS.bulk, 1);
        const before = await spent('bulk');

        expect((await admit('bulk', 10)).kind).toBe('refused');
        expect(await spent('bulk')).toBe(before);
    });
});
