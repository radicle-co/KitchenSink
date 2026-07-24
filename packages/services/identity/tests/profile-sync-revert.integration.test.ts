import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';

import { users, accounts, profiles } from '../src/database/index.js';
import { UserDAO } from '../src/database/dao/index.js';
import type { UserId } from '../src/types/index.js';

/**
 * Proves S-I3 against a REAL database: an A->B->A `user.updated` rename (as driven through
 * `UserDAO.syncNameAndPicture`, the coherent-write method `handleUserUpdated` calls) does NOT get
 * silently stuck at B. The prior bug gated the `profiles` write on `users.name`, which the webhook
 * path never updates — so a revert back to A compared against the stale, never-moved `users.name`
 * baseline and looked like a no-op, dropping both the write and the handle-sync publish.
 *
 * Runs against a real Postgres (CI service; locally set DATABASE_URL); skips cleanly when none is
 * configured — see `packages/services/identity/infra/docker/docker-compose.yml` to run locally.
 */

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../src/database/migrations');

async function runMigrations(pool: pg.Pool): Promise<void> {
    const files = readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

    // The integration suites share one database and run serially (vitest fileParallelism: false), so
    // reset to a blank schema before applying migrations. The migration SQL is not idempotent (bare
    // CREATE TABLE), so a second suite replaying it on an already-migrated DB would otherwise fail
    // with "relation already exists".
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

    for (const file of files) {
        await pool.query(readFileSync(join(migrationsDir, file), 'utf-8'));
    }
}

describe.skipIf(!DATABASE_URL)('user.updated A->B->A profile sync — coherent users/profiles (integration)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let userDao: UserDAO;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await runMigrations(pool);
        db = drizzle(pool);
        userDao = new UserDAO(db as unknown as PostgresJsDatabase<Record<string, never>>);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await pool.query('TRUNCATE users, accounts, profiles RESTART IDENTITY CASCADE');
    });

    /** Provisions a complete user + account + profile at the given initial display name. */
    async function provisionUser(identityId: string, initialDisplayName: string): Promise<UserId> {
        const user = await userDao.upsertByIdentityId({
            identityId,
            email: `${identityId}@example.com`,
            name: initialDisplayName,
            picture: 'https://example.com/avatar-a.png',
        });

        await db.insert(accounts).values({ userId: user.id }).onConflictDoNothing();
        await db
            .insert(profiles)
            .values({ userId: user.id, displayName: initialDisplayName, avatarUrl: 'https://example.com/avatar-a.png' })
            .onConflictDoNothing();

        return user.id as UserId;
    }

    it('A -> B -> A: the revert lands, profiles.displayName ends at A, and users.name stays coherent', async () => {
        const userId = await provisionUser('user_revert_a', 'Original Name');

        // A -> B
        const toB = await userDao.syncNameAndPicture(userId, {
            name: 'New Name',
            picture: 'https://example.com/avatar-b.png',
            now: new Date(),
        });
        expect(toB.displayNameChanged).toBe(true);

        const [afterB] = await db.select().from(profiles).where(eq(profiles.userId, userId));
        const [userAfterB] = await db.select().from(users).where(eq(users.id, userId));
        expect(afterB?.displayName).toBe('New Name');
        expect(userAfterB?.name).toBe('New Name');
        expect(userAfterB?.picture).toBe('https://example.com/avatar-b.png');

        // B -> A: the revert. Against the pre-fix implementation (gate on `users.name`, which the
        // webhook path never wrote) this would be silently dropped — `users.name` would still read
        // "Original Name" from before the FIRST rename, so the incoming "Original Name" would look
        // unchanged and neither table would be written nor the handle-sync published.
        const toA = await userDao.syncNameAndPicture(userId, {
            name: 'Original Name',
            picture: 'https://example.com/avatar-a.png',
            now: new Date(),
        });
        expect(toA.displayNameChanged).toBe(true);

        const [afterA] = await db.select().from(profiles).where(eq(profiles.userId, userId));
        const [userAfterA] = await db.select().from(users).where(eq(users.id, userId));

        // The revert MUST land — this is the assertion that fails against the pre-fix DAO/handler.
        expect(afterA?.displayName).toBe('Original Name');
        // `users.name` stays coherent with `profiles.displayName` — no stale duplicate baseline.
        expect(userAfterA?.name).toBe('Original Name');
        expect(userAfterA?.picture).toBe('https://example.com/avatar-a.png');
    });

    it('a no-op update (identical name and picture) writes nothing and reports no change', async () => {
        const userId = await provisionUser('user_revert_noop', 'Same Name');

        const result = await userDao.syncNameAndPicture(userId, {
            name: 'Same Name',
            picture: 'https://example.com/avatar-a.png',
            now: new Date(),
        });

        expect(result.displayNameChanged).toBe(false);

        const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
        expect(profile?.displayName).toBe('Same Name');
    });

    it('a picture-only change writes both tables but reports displayName unchanged (no handle-sync)', async () => {
        const userId = await provisionUser('user_revert_avatar_only', 'Stable Name');

        const result = await userDao.syncNameAndPicture(userId, {
            name: 'Stable Name',
            picture: 'https://example.com/avatar-new.png',
            now: new Date(),
        });

        expect(result.displayNameChanged).toBe(false);

        const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
        const [user] = await db.select().from(users).where(eq(users.id, userId));
        expect(profile?.avatarUrl).toBe('https://example.com/avatar-new.png');
        expect(user?.picture).toBe('https://example.com/avatar-new.png');
    });
});
