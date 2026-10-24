/**
 * `SettingsDAO.deleteByUserId`, against a real database (ADR-0059: DELETE restores "never chosen").
 *
 * ⛔ WHY THIS TIER. Three claims are properties of Postgres and its grants, and a mocked database answers whatever it
 * is told: the service role HOLDS `DELETE` on `settings` (it arrives from ADR-0039's default-privilege hook, not a
 * hand-written grant), the `WHERE user_id = $1` removes ONLY the caller's row, and a read afterwards sees no row, so
 * the service answers the defaults again.
 *
 * Runs as `identity_service`, the role the deployed service holds.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

import { settings, SettingsDAO, UserDAO } from '@kitchensink/identity-db';

import { resolveSettings } from '../../src/settings/domain/resolveSettings.js';
import { SETTINGS_DEFAULTS } from '../../src/settings/settings.schema.js';
import type { UserId } from '../../src/types/index.js';
import { identityDb } from '../support/roleDb.js';

const roleDb = identityDb();

describe('SettingsDAO.deleteByUserId (real Postgres)', () => {
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

    it('lets the service role DELETE from settings', async () => {
        const { rows } = await pool.query<{ del: boolean }>(
            `SELECT has_table_privilege(current_user, 'public.settings', 'DELETE') AS del`,
        );

        expect(rows).toEqual([{ del: true }]);
    });

    it('removes the row, so the next read is "never chosen" and resolves to the defaults', async () => {
        const userId = await provisionUser('sub_reset');

        await settingsDao.upsertForActiveUser(userId, { recipeViewMode: 'grid', searchShortcut: false });
        await settingsDao.deleteByUserId(userId);

        const after = await settingsDao.findByUserId(userId);

        expect(after).toBeUndefined();
        expect(resolveSettings(after)).toEqual(SETTINGS_DEFAULTS);
    });

    it("removes ONLY the caller's row: another user's choices survive", async () => {
        const mine = await provisionUser('sub_mine');
        const theirs = await provisionUser('sub_theirs');

        await settingsDao.upsertForActiveUser(mine, { recipeViewMode: 'grid' });
        await settingsDao.upsertForActiveUser(theirs, { recipeViewMode: 'list', searchShortcut: false });
        await settingsDao.deleteByUserId(mine);

        expect(await settingsDao.findByUserId(mine)).toBeUndefined();
        expect(await settingsDao.findByUserId(theirs)).toMatchObject({
            userId: theirs,
            recipeViewMode: 'list',
            searchShortcut: false,
        });
        expect(await db.select().from(settings)).toHaveLength(1);
    });

    it('is idempotent: deleting when no row exists is not an error and changes nothing', async () => {
        const withRow = await provisionUser('sub_keeps');
        const withoutRow = await provisionUser('sub_never_chose');

        await settingsDao.upsertForActiveUser(withRow, { recipeViewMode: 'grid' });

        await expect(settingsDao.deleteByUserId(withoutRow)).resolves.toBeUndefined();
        await expect(settingsDao.deleteByUserId(withoutRow)).resolves.toBeUndefined();

        expect(await settingsDao.findByUserId(withRow)).toMatchObject({ recipeViewMode: 'grid' });
    });

    it('a choice made AFTER a reset starts from "never chosen" again (the other setting is not resurrected)', async () => {
        const userId = await provisionUser('sub_after');

        await settingsDao.upsertForActiveUser(userId, { searchShortcut: false });
        await settingsDao.deleteByUserId(userId);
        const row = await settingsDao.upsertForActiveUser(userId, { recipeViewMode: 'list' });

        expect(row).toMatchObject({ recipeViewMode: 'list', searchShortcut: null });
    });
});
