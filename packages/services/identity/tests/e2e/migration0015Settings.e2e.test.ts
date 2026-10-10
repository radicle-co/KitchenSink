/**
 * Migration `0015_settings` and the settings write path, against a real database (ADR-0059).
 *
 * ⛔ WHY THIS TIER. Three claims of the decision are properties of Postgres and a mocked database answers whatever it
 * is told: the table has the key and the foreign key the erasure and the one-statement upsert lean on, the service
 * role holds exactly the rights ADR-0039's default-privilege hook gives it (no migration grants them by hand), and two
 * concurrent first writes leave ONE row because the conflict target is the primary key.
 *
 * Runs as `identity_service` (ADR-0039), the role the deployed service holds. Catalog reads use `pg_catalog`, which
 * every role can read; `information_schema.constraint_column_usage` shows a non-owner nothing and would make the
 * constraint assertions pass vacuously.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import { settings, SettingsDAO, UserDAO } from '@kitchensink/identity-db';

import { ForbiddenException } from '@nestjs/common';

import { noopHandleSyncPublisher } from '../../src/users/handleSync.publisher.js';
import { SettingsService } from '../../src/settings/settings.service.js';
import { UsersService } from '../../src/users/users.service.js';
import { identityDb } from '../support/roleDb.js';
import type { UserId } from '../../src/types/index.js';

const roleDb = identityDb();

describe('0015_settings (real Postgres)', () => {
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

        return user.id as UserId;
    }

    describe('the table', () => {
        it('has user_id as its primary key', async () => {
            const { rows } = await pool.query<{ column_name: string }>(
                `SELECT a.attname AS column_name
                   FROM pg_constraint c
                   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
                  WHERE c.conrelid = 'public.settings'::regclass AND c.contype = 'p'`,
            );

            expect(rows.map((row) => row.column_name)).toEqual(['user_id']);
        });

        it('references users(id) and cascades on delete', async () => {
            const { rows } = await pool.query<{ referenced: string; on_delete: string }>(
                `SELECT c.confrelid::regclass::text AS referenced, c.confdeltype AS on_delete
                   FROM pg_constraint c
                  WHERE c.conrelid = 'public.settings'::regclass AND c.contype = 'f'`,
            );

            expect(rows).toEqual([{ referenced: 'users', on_delete: 'c' }]);
        });

        it('holds search_shortcut as a nullable boolean with NO default', async () => {
            const { rows } = await pool.query<{
                data_type: string;
                is_nullable: string;
                column_default: string | null;
            }>(
                `SELECT data_type, is_nullable, column_default
                   FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'search_shortcut'`,
            );

            expect(rows).toEqual([{ data_type: 'boolean', is_nullable: 'YES', column_default: null }]);
        });

        it('has a NOT NULL updated_at', async () => {
            const { rows } = await pool.query<{ is_nullable: string }>(
                `SELECT is_nullable FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'updated_at'`,
            );

            expect(rows).toEqual([{ is_nullable: 'NO' }]);
        });
    });

    describe('the service role (ADR-0039)', () => {
        it('can SELECT, INSERT, UPDATE and DELETE without a migration granting it', async () => {
            const { rows } = await pool.query<Record<string, boolean>>(
                `SELECT has_table_privilege(current_user, 'public.settings', 'SELECT') AS "select",
                        has_table_privilege(current_user, 'public.settings', 'INSERT') AS "insert",
                        has_table_privilege(current_user, 'public.settings', 'UPDATE') AS "update",
                        has_table_privilege(current_user, 'public.settings', 'DELETE') AS "delete"`,
            );

            expect(rows).toEqual([{ select: true, insert: true, update: true, delete: true }]);
        });

        it('cannot ALTER the table, and holds no TRUNCATE', async () => {
            await expect(pool.query('ALTER TABLE settings ADD COLUMN probe integer')).rejects.toThrow(/must be owner/i);

            const { rows } = await pool.query<{ truncate: boolean }>(
                `SELECT has_table_privilege(current_user, 'public.settings', 'TRUNCATE') AS "truncate"`,
            );

            expect(rows).toEqual([{ truncate: false }]);
        });
    });

    describe('SettingsDAO', () => {
        it('reads nothing for a user who never chose, and writes nothing doing so', async () => {
            const userId = await provisionUser('sub_read');

            expect(await settingsDao.findByUserId(userId)).toBeUndefined();
            expect(await db.select().from(settings)).toEqual([]);
        });

        it('creates the row on the first write and stores only what was supplied', async () => {
            const userId = await provisionUser('sub_first');

            const row = await settingsDao.upsertForActiveUser(userId, { searchShortcut: false });

            expect(row).toMatchObject({ userId, searchShortcut: false });
            expect(await db.select().from(settings).where(eq(settings.userId, userId))).toHaveLength(1);
        });

        it('keeps one row and the last write when the column is written again', async () => {
            const userId = await provisionUser('sub_again');

            await settingsDao.upsertForActiveUser(userId, { searchShortcut: false });
            const row = await settingsDao.upsertForActiveUser(userId, { searchShortcut: true });

            expect(row?.searchShortcut).toBe(true);
            expect(await db.select().from(settings).where(eq(settings.userId, userId))).toHaveLength(1);
        });

        it('leaves exactly one row when two first writes race', async () => {
            const userId = await provisionUser('sub_race');

            const [first, second] = await Promise.all([
                settingsDao.upsertForActiveUser(userId, { searchShortcut: true }),
                settingsDao.upsertForActiveUser(userId, { searchShortcut: false }),
            ]);

            expect(first).toBeDefined();
            expect(second).toBeDefined();
            expect(await db.select().from(settings).where(eq(settings.userId, userId))).toHaveLength(1);
        });

        it.each(['tombstoned', 'erased', 'suspended'] as const)(
            'writes NOTHING and returns undefined for a %s user',
            async (status) => {
                const userId = await provisionUser(`sub_${status}`);

                await pool.query(`UPDATE users SET status = $1 WHERE id = $2`, [status, userId]);

                expect(await settingsDao.upsertForActiveUser(userId, { searchShortcut: false })).toBeUndefined();
                expect(await db.select().from(settings)).toEqual([]);
            },
        );

        it('writes nothing for a user id that does not exist', async () => {
            expect(
                await settingsDao.upsertForActiveUser('01HZZZZZZZZZZZZZZZZZZZZZZZ' as UserId, { searchShortcut: true }),
            ).toBeUndefined();
        });

        it('is removed with the user row (ON DELETE CASCADE)', async () => {
            const userId = await provisionUser('sub_cascade');

            await settingsDao.upsertForActiveUser(userId, { searchShortcut: false });
            await pool.query('DELETE FROM users WHERE id = $1', [userId]);

            expect(await db.select().from(settings).where(eq(settings.userId, userId))).toEqual([]);
        });
    });
    describe('account lifecycle (ADR-0059: closure keeps the row, erasure deletes it)', () => {
        const enqueueDeletion = vi.fn();
        const deleteAllForUser = vi.fn();
        let usersService: UsersService;
        let settingsService: SettingsService;

        beforeAll(() => {
            usersService = new UsersService(db, { enqueueDeletion } as never, {} as never, noopHandleSyncPublisher, {
                deleteAllForUser,
            } as never);
            settingsService = new SettingsService(settingsDao);
        });

        beforeEach(() => {
            enqueueDeletion.mockReset().mockResolvedValue(undefined);
            deleteAllForUser.mockReset().mockResolvedValue(undefined);
        });

        const provisionViewer = (sub: string) =>
            usersService.resolveOrCreateFromClaims({
                sub,
                email: `${sub}@example.test`,
                firstName: 'A',
                lastName: 'Cook',
                scopes: [],
                permissions: [],
                testPrincipal: false,
            });

        it('a closure KEEPS the settings row, and a closed account can no longer write one', async () => {
            const ctx = await provisionViewer('user_settings_closure');

            await settingsService.patchSettings(ctx, { searchShortcut: false });
            await usersService.deleteUserMe(ctx);

            expect(await db.select().from(settings).where(eq(settings.userId, ctx.userId))).toHaveLength(1);
            await expect(settingsService.patchSettings(ctx, { searchShortcut: true })).rejects.toBeInstanceOf(
                ForbiddenException,
            );
            expect((await settingsDao.findByUserId(ctx.userId))?.searchShortcut).toBe(false);
        });

        it('an erasure DELETES the settings row, and nothing can recreate it afterwards', async () => {
            const ctx = await provisionViewer('user_settings_erasure');
            const bystander = await provisionViewer('user_settings_bystander');

            await settingsService.patchSettings(ctx, { searchShortcut: false });
            await settingsService.patchSettings(bystander, { searchShortcut: false });
            await usersService.eraseUserMe(ctx);

            expect(await db.select().from(settings).where(eq(settings.userId, ctx.userId))).toHaveLength(0);
            expect(await db.select().from(settings).where(eq(settings.userId, bystander.userId))).toHaveLength(1);
            await expect(settingsService.patchSettings(ctx, { searchShortcut: true })).rejects.toBeInstanceOf(
                ForbiddenException,
            );
            expect(await db.select().from(settings).where(eq(settings.userId, ctx.userId))).toHaveLength(0);
        });
    });
});
