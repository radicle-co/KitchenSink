/**
 * Migration `0018_profiles_avatar_key` and the DAO behaviour that depends on it, against a real database (ADR-0064).
 *
 * ⛔ WHY THIS TIER. The decision's claims are properties of Postgres: the column is nullable text with NO default, and
 * two CHECK constraints make the invalid states unrepresentable — a profile cannot hold BOTH a Clerk picture URL and an
 * uploaded key, and cannot hold a key under another user's prefix. A mocked database answers whatever it is told about
 * both. The last test also proves the Clerk-wins rule (D5) through the real `syncProviderFields` transaction: the
 * `CHECK` would REFUSE the write if the DAO set the picture without clearing the key, so passing it proves both.
 *
 * Runs as `identity_service`, the role the deployed service holds.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import { accounts, profiles, UserDAO } from '@kitchensink/identity-db';

import type { UserId } from '../../src/types/index.js';
import { identityDb } from '../support/roleDb.js';

const roleDb = identityDb();

/** Postgres' SQLSTATE for a violated CHECK constraint. */
const CHECK_VIOLATION = '23514';

describe('0018_profiles_avatar_key (real Postgres)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let dao: UserDAO;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = drizzle(pool);
        dao = new UserDAO(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await roleDb.truncate();
    });

    /** A user with a profile that holds a Clerk picture URL and no uploaded key. */
    async function provision(identityId: string, avatarUrl: string | null): Promise<UserId> {
        const user = await dao.upsertByIdentityId({
            identityId,
            email: `${identityId}@example.com`,
            name: 'Ada',
            picture: avatarUrl ?? undefined,
        });

        await db.insert(accounts).values({ userId: user.id }).onConflictDoNothing();
        await db.insert(profiles).values({ userId: user.id, displayName: 'Ada', avatarUrl }).onConflictDoNothing();

        return user.id;
    }

    async function violation(sql: string, params: unknown[]): Promise<{ code?: string; constraint?: string }> {
        try {
            await pool.query(sql, params);
        } catch (error) {
            const { code, constraint } = error as { code?: string; constraint?: string };

            return { code, constraint };
        }

        return {};
    }

    it('adds a nullable text column with no default', async () => {
        const { rows } = await pool.query<{ type: string; not_null: boolean; has_default: boolean }>(
            `SELECT format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null, a.atthasdef AS has_default
               FROM pg_attribute a
              WHERE a.attrelid = 'public.profiles'::regclass AND a.attname = 'avatar_key' AND NOT a.attisdropped`,
        );

        expect(rows).toEqual([{ type: 'text', not_null: false, has_default: false }]);
    });

    it('accepts a key under the profile’s own user prefix when no Clerk URL is held', async () => {
        const userId = await provision('sub_key_ok', null);

        await pool.query(`UPDATE profiles SET avatar_key = $2 WHERE user_id = $1`, [userId, `avatars/${userId}/1.png`]);

        const [row] = await db.select({ key: profiles.avatarKey }).from(profiles).where(eq(profiles.userId, userId));
        expect(row).toEqual({ key: `avatars/${userId}/1.png` });
    });

    it('REFUSES a key while a Clerk picture URL is also held (one source of truth)', async () => {
        const userId = await provision('sub_both', 'https://img.clerk.com/a.png');

        const refused = await violation(`UPDATE profiles SET avatar_key = $2 WHERE user_id = $1`, [
            userId,
            `avatars/${userId}/1.png`,
        ]);

        expect(refused.code).toBe(CHECK_VIOLATION);
        expect(refused.constraint).toBe('profiles_avatar_key_xor_url');
    });

    it.each([
        ['another user’s prefix', (id: string) => `avatars/OTHER${id}/1.png`],
        ['a recipe photo', (id: string) => `recipes/${id}/1.png`],
        ['no prefix at all', () => `1.png`],
    ])('REFUSES a key under %s', async (_name, keyFor) => {
        const userId = await provision('sub_foreign', null);

        const refused = await violation(`UPDATE profiles SET avatar_key = $2 WHERE user_id = $1`, [
            userId,
            keyFor(userId),
        ]);

        expect(refused.code).toBe(CHECK_VIOLATION);
        expect(refused.constraint).toBe('profiles_avatar_key_own_prefix');
    });

    it('lets the service role read and write the column with no migration granting it (ADR-0039)', async () => {
        const { rows } = await pool.query<Record<string, boolean>>(
            `SELECT has_column_privilege(current_user, 'public.profiles', 'avatar_key', 'SELECT') AS "select",
                    has_column_privilege(current_user, 'public.profiles', 'avatar_key', 'UPDATE') AS "update"`,
        );

        expect(rows).toEqual([{ select: true, update: true }]);
    });

    describe('Clerk wins on a real picture change (D5)', () => {
        it('clears the uploaded key when Clerk’s picture changes', async () => {
            const userId = await provision('sub_clerk_wins', null);
            await pool.query(`UPDATE profiles SET avatar_key = $2 WHERE user_id = $1`, [
                userId,
                `avatars/${userId}/1.png`,
            ]);

            await dao.syncProviderFields(userId, {
                name: 'Ada',
                picture: 'https://img.clerk.com/new.png',
                now: new Date(),
            });

            const [row] = await db
                .select({ key: profiles.avatarKey, url: profiles.avatarUrl })
                .from(profiles)
                .where(eq(profiles.userId, userId));
            expect(row).toEqual({ key: null, url: 'https://img.clerk.com/new.png' });
        });

        it('keeps the uploaded key through an event that changes only the name', async () => {
            const userId = await provision('sub_name_only', null);
            await pool.query(`UPDATE profiles SET avatar_key = $2 WHERE user_id = $1`, [
                userId,
                `avatars/${userId}/1.png`,
            ]);
            // The mirror already holds the picture Clerk will keep sending, so only the name moves.
            await pool.query(`UPDATE users SET picture = $2 WHERE id = $1`, [userId, 'https://img.clerk.com/same.png']);

            await dao.syncProviderFields(userId, {
                name: 'Ada Lovelace',
                picture: 'https://img.clerk.com/same.png',
                now: new Date(),
            });

            const [row] = await db
                .select({ key: profiles.avatarKey, url: profiles.avatarUrl })
                .from(profiles)
                .where(eq(profiles.userId, userId));
            expect(row).toEqual({ key: `avatars/${userId}/1.png`, url: null });
        });
    });
});
