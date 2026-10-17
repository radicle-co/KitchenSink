/**
 * Migration `0019_settings_recipe_view_mode` and the settings write path it widens, against a real database
 * (ADR-0059, owner ruling 2026-10-17: the recipe list's grid/list choice is an account setting).
 *
 * ⛔ WHY THIS TIER. Four claims are properties of Postgres, and a mocked database answers whatever it is told: the
 * column is nullable text with NO default (a default would record a choice nobody made); a CHECK admits only `grid`,
 * `list` and NULL (so a client bug cannot store a third word the read then has to explain); the one-statement upsert
 * writes ONLY the columns it was given, so choosing a view never resets the search-shortcut choice or the reverse;
 * and the service role still holds DML on the table without a hand-written grant (ADR-0039).
 *
 * Runs as `identity_service`, the role the deployed service holds.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import { settings, SettingsDAO, UserDAO } from '@kitchensink/identity-db';

import type { UserId } from '../../src/types/index.js';
import { identityDb } from '../support/roleDb.js';

const roleDb = identityDb();

/** Postgres' SQLSTATE for a violated CHECK constraint. */
const CHECK_VIOLATION = '23514';

describe('0019_settings_recipe_view_mode (real Postgres)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let userDao: UserDAO;
    let settingsDao: SettingsDAO;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = drizzle(pool);
        userDao = new UserDAO(db);
        settingsDao = new SettingsDAO(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await roleDb.truncate();
    });

    async function provisionUser(identityId: string): Promise<UserId> {
        const user = await userDao.upsertByIdentityId({
            identityId,
            email: `${identityId}@example.com`,
            name: 'A Cook',
        });

        return user.id;
    }

    describe('the column', () => {
        it('is nullable text with NO default', async () => {
            const { rows } = await pool.query<{ type: string; not_null: boolean; has_default: boolean }>(
                `SELECT format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null, a.atthasdef AS has_default
                   FROM pg_attribute a
                  WHERE a.attrelid = 'public.settings'::regclass AND a.attname = 'recipe_view_mode' AND NOT a.attisdropped`,
            );

            expect(rows).toEqual([{ type: 'text', not_null: false, has_default: false }]);
        });

        it('admits grid, list and NULL, and refuses any other word', async () => {
            const userId = await provisionUser('sub_check');
            await pool.query('INSERT INTO settings (user_id) VALUES ($1)', [userId]);

            for (const accepted of ['grid', 'list', null]) {
                await pool.query('UPDATE settings SET recipe_view_mode = $1 WHERE user_id = $2', [accepted, userId]);
            }

            for (const refused of ['compact', 'auto', 'GRID', '']) {
                await expect(
                    pool.query('UPDATE settings SET recipe_view_mode = $1 WHERE user_id = $2', [refused, userId]),
                ).rejects.toMatchObject({ code: CHECK_VIOLATION });
            }
        });

        it('leaves the service role with DML and no ALTER, as for the rest of the table (ADR-0039)', async () => {
            const { rows } = await pool.query<Record<string, boolean>>(
                `SELECT has_table_privilege(current_user, 'public.settings', 'SELECT') AS "select",
                        has_table_privilege(current_user, 'public.settings', 'INSERT') AS "insert",
                        has_table_privilege(current_user, 'public.settings', 'UPDATE') AS "update"`,
            );

            expect(rows).toEqual([{ select: true, insert: true, update: true }]);
            await expect(pool.query('ALTER TABLE settings DROP COLUMN recipe_view_mode')).rejects.toThrow(
                /must be owner/i,
            );
        });
    });

    describe('SettingsDAO', () => {
        it('stores the view on a first write and leaves the other setting NULL (never chosen)', async () => {
            const userId = await provisionUser('sub_first_view');

            const row = await settingsDao.upsertForActiveUser(userId, { recipeViewMode: 'list' });

            expect(row).toMatchObject({ userId, recipeViewMode: 'list', searchShortcut: null });
        });

        it('keeps the last write of the view, in one row', async () => {
            const userId = await provisionUser('sub_view_again');

            await settingsDao.upsertForActiveUser(userId, { recipeViewMode: 'list' });
            const row = await settingsDao.upsertForActiveUser(userId, { recipeViewMode: 'grid' });

            expect(row?.recipeViewMode).toBe('grid');
            expect(await db.select().from(settings).where(eq(settings.userId, userId))).toHaveLength(1);
        });

        it('writing one setting never resets the other', async () => {
            const userId = await provisionUser('sub_independent');

            await settingsDao.upsertForActiveUser(userId, { searchShortcut: false });
            const afterView = await settingsDao.upsertForActiveUser(userId, { recipeViewMode: 'list' });
            const afterShortcut = await settingsDao.upsertForActiveUser(userId, { searchShortcut: true });

            expect(afterView).toMatchObject({ searchShortcut: false, recipeViewMode: 'list' });
            expect(afterShortcut).toMatchObject({ searchShortcut: true, recipeViewMode: 'list' });
        });

        it.each(['tombstoned', 'erased', 'suspended'] as const)(
            'writes NOTHING for a %s user, so a view is never recreated after an erasure',
            async (status) => {
                const userId = await provisionUser(`sub_view_${status}`);

                await pool.query(`UPDATE users SET status = $1 WHERE id = $2`, [status, userId]);

                expect(await settingsDao.upsertForActiveUser(userId, { recipeViewMode: 'list' })).toBeUndefined();
                expect(await db.select().from(settings)).toEqual([]);
            },
        );

        it('two racing first writes of different settings leave one row holding BOTH', async () => {
            const userId = await provisionUser('sub_view_race');

            await Promise.all([
                settingsDao.upsertForActiveUser(userId, { recipeViewMode: 'list' }),
                settingsDao.upsertForActiveUser(userId, { searchShortcut: false }),
            ]);

            expect(await db.select().from(settings).where(eq(settings.userId, userId))).toMatchObject([
                { recipeViewMode: 'list', searchShortcut: false },
            ]);
        });
    });
});
