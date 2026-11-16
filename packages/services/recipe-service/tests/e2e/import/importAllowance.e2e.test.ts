/**
 * The ONE import allowance (ADR-0072 §8, 004 FR-067) against a REAL database (LOCAL e2e, `docs/CODING_STANDARDS.md` §7.1a).
 *
 * `ImportAllowanceDal.admit` is driven directly as the SERVICE role (`recipe_app`), because the bulk route is not built
 * yet and the allowance is the part of it that only a real database can prove. What each case is there to catch:
 *
 * ⚠️ REWRITTEN for the owner ruling of 2026-11-15 ("one pipeline, one allowance"). It used to pin "paste and bulk never
 * borrow from each other", with a limit per channel. That is now the defect: every channel's rows count against one
 * limit (200 Free, 1,000 paid), the `channel` column is attribution only, and a test principal has no limit. The rewritten
 * cases are the ones named "one allowance" below; the rest keep their meaning with the one limit.
 *
 *  - a full bulk allowance refuses a paste, pastes count against bulk, and a paste's `resetsAt` can come from a bulk row
 *    (kills: a limit or a window edge per channel);
 *  - a file larger than the room left admits what fits and writes ONLY that (kills: all-or-nothing, or writing the
 *    request instead of the admitted units);
 *  - a 2,000-recipe file at an empty ledger admits exactly 1,000 on a paid plan (kills: a per-file cap, Free's 200 for
 *    everyone), and the Free plan's 200th recipe is admitted and its 201st refused (kills: one limit for every plan);
 *  - `resetsAt` is read back from the table: the oldest counted unit plus 24 h, and `now + 24 h` when the units
 *    just admitted are the oldest (kills: ignoring the admitted units, or reading another channel's rows);
 *  - the lock is real, deterministically: while another session holds the user's key a bulk admit WAITS and writes
 *    nothing, then completes when it is released (kills: removing the lock, every time and not by timing luck);
 *  - TWO CONCURRENT admits of 600 at zero spend exactly 1,000 in total: 600 and 400 (kills: removing the per-user lock,
 *    which lets both read an empty ledger and write 1,200);
 *  - pruning uses ONE edge: an expired row is deleted whatever its channel, and a fresh row survives it;
 *  - a refusal writes no row.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { ADVISORY_LOCK_CLASSES } from '@kitchensink/db-schema-guard';

import { ImportAllowanceDal, type AdmitOutcome } from '../../../src/common/dal/importAllowance.dal.js';
import {
    IMPORT_ALLOWANCE_RULE,
    importAllowanceLimitOf,
    type ImportAllowanceScope,
} from '../../../src/common/importAllowancePolicy.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { recipeDb } from '../../support/roleDb.js';

const USER = '01JIMPORTALLOWANCEE2E00001';
const OTHER = '01JIMPORTALLOWANCEE2E00002';
const roleDb = recipeDb();
const PAID_BULK_LIMIT = importAllowanceLimitOf({ channel: 'bulk', isPremium: true, principalKind: 'real' });
const FREE_BULK_LIMIT = importAllowanceLimitOf({ channel: 'bulk', isPremium: false, principalKind: 'real' });

describe('the one import allowance (LOCAL e2e)', () => {
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

    /** The scope a case runs under: the paid plan, whose limit most cases were written for, unless it names Free. */
    function scopeOf(channel: 'paste' | 'bulk', isPremium = true): ImportAllowanceScope {
        return { channel, isPremium, principalKind: 'real' };
    }

    /** One admission in its own transaction, the way a service call makes it. */
    function admit(
        channel: 'paste' | 'bulk',
        units: number,
        userId: string = USER,
        isPremium = true,
    ): Promise<AdmitOutcome> {
        return db.transaction((tx) => dal.admit(tx, userId, { ...scopeOf(channel, isPremium), units }));
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

    it('⛔ one allowance: a full bulk allowance refuses a paste, and pastes count against bulk', async () => {
        await seed('bulk', PAID_BULK_LIMIT - 3, 1);
        await seed('paste', 2, 1);

        expect((await admit('paste', 2)).kind).toBe('partial');
        expect(await spent('paste')).toBe(3);
        expect((await admit('paste', 1)).kind).toBe('refused');
        expect((await admit('bulk', 1)).kind).toBe('refused');
        expect((await spent('bulk')) + (await spent('paste'))).toBe(PAID_BULK_LIMIT);
    });

    it('⛔ one allowance: 150 Free pastes leave 50 bulk recipes, and the 51st is refused', async () => {
        await seed('paste', 150, 1);

        expect(await admit('bulk', 80, USER, false)).toEqual(expect.objectContaining({ kind: 'partial', units: 50 }));
        expect((await admit('bulk', 1, USER, false)).kind).toBe('refused');
    });

    it('⛔ one allowance: a paste refusal reads resetsAt from a BULK row when that is the oldest counted unit', async () => {
        await seed('bulk', FREE_BULK_LIMIT - 1, 20);
        await seed('paste', 1, 2);

        const outcome = await admit('paste', 1, USER, false);
        const oldest = await pool.query(
            'SELECT min(created_at) AS at FROM import_allowance_events WHERE user_id = $1',
            [USER],
        );

        expect(outcome.kind).toBe('refused');
        expect(outcome.kind === 'refused' && outcome.resetsAt.getTime()).toBe(
            (oldest.rows[0] as { at: Date }).at.getTime() + IMPORT_ALLOWANCE_RULE.windowMs,
        );
    });

    it('⛔ a test principal’s paste is never refused, however full the ledger', async () => {
        await seed('bulk', FREE_BULK_LIMIT * 5, 1);

        const outcome = await db.transaction((tx) =>
            dal.admit(tx, USER, { channel: 'paste', isPremium: false, principalKind: 'test', units: 1 }),
        );

        expect(outcome).toEqual({ kind: 'admitted', units: 1 });
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
            (written.rows[0] as { created_at: Date }).created_at.getTime() + IMPORT_ALLOWANCE_RULE.windowMs,
        );
    });

    it('⛔ admits only the room that is left, counting a paste row too, with resetsAt from the OLDEST counted unit', async () => {
        await seed('bulk', 300, 20);
        await seed('bulk', 499, 2);
        // The oldest counted unit is a PASTE row: one allowance, so it holds a unit and names the reset instant.
        await seed('paste', 1, 23);

        const outcome = await admit('bulk', 500);
        const oldest = await pool.query(
            `SELECT min(created_at) AS at FROM import_allowance_events WHERE user_id = $1 AND channel = 'paste'`,
            [USER],
        );

        expect(outcome).toMatchObject({ kind: 'partial', units: 200 });
        expect((await spent('bulk')) + (await spent('paste'))).toBe(1000);

        if (outcome.kind !== 'partial') {
            throw new Error('expected a partial admission');
        }

        expect(outcome.resetsAt.getTime()).toBe(
            (oldest.rows[0] as { at: Date }).at.getTime() + IMPORT_ALLOWANCE_RULE.windowMs,
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

    it('⛔ two concurrent admits across the two channels share the one limit: the ledger holds 1,000, never 1,001', async () => {
        const outcomes = await Promise.all([admit('bulk', 1000), admit('paste', 1)]);

        // Either order is legal (bulk first refuses the paste; paste first admits only 999 of the bulk file). Both admitting
        // in full is the defect: it needs a limit per channel, or no lock between them.
        expect(outcomes.map((outcome) => outcome.kind)).not.toEqual(['admitted', 'admitted']);
        expect((await spent('bulk')) + (await spent('paste'))).toBe(1000);
    });

    it('prunes expired rows on EVERY channel by the one edge and leaves a fresh row alone', async () => {
        await seed('bulk', 5, 25);
        await seed('paste', 2, 25);
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

    it('⛔ a free cook admits the 200th bulk recipe and is refused the 201st; the view reads Free’s 200', async () => {
        await seed('bulk', FREE_BULK_LIMIT - 1, 1);

        expect(await admit('bulk', 1, USER, false)).toEqual({ kind: 'admitted', units: 1 });
        expect((await admit('bulk', 1, USER, false)).kind).toBe('refused');
        expect(await spent('bulk')).toBe(FREE_BULK_LIMIT);
        expect(await dal.stateOf(db, USER, scopeOf('bulk', false))).toMatchObject({ limit: 200, used: 200 });
        // The same ledger is 800 short of a paid cook's day.
        expect(await admit('bulk', 1)).toEqual({ kind: 'admitted', units: 1 });
    });

    // Owner ruling 2026-11-15: a test principal has no limit. The ledger still records the unit, so the one pipeline runs.
    it('⛔ a test principal is admitted past a limit that refuses a real cook, and the unit is still written', async () => {
        await seed('bulk', FREE_BULK_LIMIT, 1);

        expect((await admit('bulk', 1, USER, false)).kind).toBe('refused');

        const outcome = await db.transaction((tx) =>
            dal.admit(tx, USER, { channel: 'bulk', isPremium: false, principalKind: 'test', units: 50 }),
        );

        expect(outcome).toEqual({ kind: 'admitted', units: 50 });
        expect(await spent('bulk')).toBe(FREE_BULK_LIMIT + 50);
    });

    it("counts each caller's allowance separately", async () => {
        await seed('bulk', PAID_BULK_LIMIT, 1, OTHER);

        expect(await admit('bulk', 10)).toEqual({ kind: 'admitted', units: 10 });
    });

    it('a refusal writes no ledger row', async () => {
        await seed('bulk', PAID_BULK_LIMIT, 1);
        const before = await spent('bulk');

        expect((await admit('bulk', 10)).kind).toBe('refused');
        expect(await spent('bulk')).toBe(before);
    });

    describe('stateOf — what the import view shows (ADR-0072 §8 as amended: advance answers 200, not 429)', () => {
        it('reads the units spent in the window, on every channel, and when the oldest leaves, from the database’s own clock', async () => {
            await seed('bulk', 30, 5);
            await seed('bulk', 12, 1);
            await seed('paste', 8, 1);
            await seed('bulk', 500, 30); // outside the window

            const state = await dal.stateOf(db, USER, scopeOf('bulk'));

            expect(state).toMatchObject({ limit: PAID_BULK_LIMIT, used: 50 });

            const oldest = await pool.query<{ at: Date }>(
                `SELECT min(created_at) AS at FROM import_allowance_events
                  WHERE user_id = $1 AND created_at > now() - interval '24 hours'`,
                [USER],
            );
            const first = oldest.rows[0]?.at;

            expect(state.resetsAt).toBe(
                first === undefined ? undefined : new Date(first.getTime() + 24 * 3_600_000).toISOString(),
            );
        });

        it('says nothing is spent for a caller with no ledger rows, and writes nothing', async () => {
            expect(await dal.stateOf(db, OTHER, scopeOf('bulk'))).toEqual({
                limit: PAID_BULK_LIMIT,
                used: 0,
                resetsAt: null,
            });
            expect(await spent('bulk', OTHER)).toBe(0);
        });

        it('agrees with the next admission: a full day reads used = limit, and the admission is refused at the same resetsAt', async () => {
            await seed('bulk', PAID_BULK_LIMIT, 2);

            const state = await dal.stateOf(db, USER, scopeOf('bulk'));
            const refusal = await admit('bulk', 1);

            expect(state.used).toBe(state.limit);
            expect(refusal.kind).toBe('refused');
            expect(refusal.kind === 'refused' && refusal.resetsAt.toISOString()).toBe(state.resetsAt);
        });
    });
});
