import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';

import { provisionCompleteUser, type ProvisionDeps } from '@kitchensink/identity-utils';
import { users, accounts, profiles } from '../src/database/index.js';
import { UserDAO } from '../src/database/dao/index.js';
import { newUserId } from '../src/database/ulid.js';

/**
 * Proves R3 against a real Postgres: the shared provisioning routine is idempotent and race-safe
 * WITHOUT a write-time transaction (re-adding one reintroduces the d59e11c 40P01 deadlock). The
 * concurrent cases run REPEATEDLY — the deadlock is racy, so a single green run proves nothing
 * (the d59e11c fix needed 8/8). Runs against the CI Postgres service; locally set DATABASE_URL.
 */

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const ITERATIONS = 8;

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../src/database/migrations');

async function runMigrations(pool: pg.Pool): Promise<void> {
    const files = readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

    // The integration suites share one database and run serially (vitest fileParallelism: false),
    // so reset to a blank schema before applying migrations. The migration SQL is not idempotent
    // (bare CREATE TABLE), so a second suite replaying it on an already-migrated DB would otherwise
    // fail with "relation already exists".
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

    for (const file of files) {
        await pool.query(readFileSync(join(migrationsDir, file), 'utf-8'));
    }
}

describe.skipIf(!DATABASE_URL)('provisionCompleteUser — race-safety under concurrency (integration)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let deps: ProvisionDeps;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await runMigrations(pool);
        db = drizzle(pool);
        deps = {
            db: db as unknown as PostgresJsDatabase<Record<string, never>>,
            schema: { users, accounts, profiles },
            newUserId,
        };
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await pool.query('TRUNCATE users, accounts, profiles RESTART IDENTITY CASCADE');
    });

    async function countsFor(identityId: string) {
        const userRows = await db.select().from(users).where(eq(users.identityId, identityId));
        const userId = userRows[0]?.id;
        const accountRows = userId ? await db.select().from(accounts).where(eq(accounts.userId, userId)) : [];
        const profileRows = userId ? await db.select().from(profiles).where(eq(profiles.userId, userId)) : [];

        return { users: userRows.length, accounts: accountRows.length, profiles: profileRows.length, userRows };
    }

    const readThrough = (identityId: string, email: string) =>
        provisionCompleteUser(
            deps,
            { identityId, email, name: 'Race', displayName: 'Race' },
            { onEmailCollision: 'placeholder', emailIsReal: true },
        );
    const webhook = (identityId: string, email: string) =>
        provisionCompleteUser(
            deps,
            { identityId, email, name: 'Race', displayName: 'Race' },
            { onEmailCollision: 'signal-incomplete', emailIsReal: true },
        );
    const reconcile = (identityId: string, email: string) =>
        provisionCompleteUser(
            deps,
            { identityId, email, name: 'Race', displayName: 'Race' },
            { onEmailCollision: 'placeholder', emailIsReal: true },
        );

    it('concurrent read-through + webhook for the SAME identity converge on exactly one complete user (×8, no deadlock)', async () => {
        for (let i = 0; i < ITERATIONS; i++) {
            const sub = `user_race_${i}`;
            const email = `${sub}@example.com`;

            // Both writers race on the same identity. No rejection (no 40P01, no escaped duplicate-key).
            await expect(Promise.all([readThrough(sub, email), webhook(sub, email)])).resolves.toBeDefined();

            expect(await countsFor(sub)).toMatchObject({ users: 1, accounts: 1, profiles: 1 });
        }
    });

    it('concurrent read-through + webhook + reconciliation for the SAME identity still converge (×8)', async () => {
        for (let i = 0; i < ITERATIONS; i++) {
            const sub = `user_race3_${i}`;
            const email = `${sub}@example.com`;

            await expect(
                Promise.all([readThrough(sub, email), webhook(sub, email), reconcile(sub, email)]),
            ).resolves.toBeDefined();

            expect(await countsFor(sub)).toMatchObject({ users: 1, accounts: 1, profiles: 1 });
        }
    });

    it('two identities racing the SAME real email: order-invariant — the real email is owned once, never clobbered (×8)', async () => {
        for (let i = 0; i < ITERATIONS; i++) {
            const sharedEmail = `shared_${i}@example.com`;
            const subA = `user_a_${i}`; // read-through (placeholder policy)
            const subB = `user_b_${i}`; // webhook (signal-incomplete policy)

            // No rejection regardless of which writer commits the email first.
            await expect(
                Promise.all([readThrough(subA, sharedEmail), webhook(subB, sharedEmail)]),
            ).resolves.toBeDefined();

            // Exactly one user owns the real email, and that user is complete (has account + profile).
            const owners = await db.select().from(users).where(eq(users.email, sharedEmail));
            expect(owners).toHaveLength(1);
            const ownerId = owners[0]!.id;
            expect(await db.select().from(accounts).where(eq(accounts.userId, ownerId))).toHaveLength(1);
            expect(await db.select().from(profiles).where(eq(profiles.userId, ownerId))).toHaveLength(1);

            // No orphaned aux rows: every account/profile points to a user that exists.
            const allUsers = await db.select().from(users);
            const allUserIds = new Set(allUsers.map((u) => u.id));
            const allAccounts = await db.select().from(accounts);
            const allProfiles = await db.select().from(profiles);
            expect(allAccounts.every((a) => allUserIds.has(a.userId))).toBe(true);
            expect(allProfiles.every((p) => allUserIds.has(p.userId))).toBe(true);

            await pool.query('TRUNCATE users, accounts, profiles RESTART IDENTITY CASCADE');
        }
    });

    it('webhook signal-incomplete branch: a pre-seeded active-email collision returns incomplete, creates no user', async () => {
        await readThrough('user_owner', 'taken@example.com'); // seed the email on a different identity
        const before = (await db.select().from(users)).length;

        const result = await webhook('user_other', 'taken@example.com');

        expect(result).toEqual({ kind: 'incomplete', reason: 'email-collision' });
        // No new user row created for the colliding identity, no aux against a foreign user.
        expect((await db.select().from(users)).length).toBe(before);
        expect(await db.select().from(users).where(eq(users.identityId, 'user_other'))).toHaveLength(0);
    });

    it('revives a re-registered soft-deleted identity (deletedAt reset) and completes it', async () => {
        await readThrough('user_revive', 'revive@example.com');
        const [row] = await db.select().from(users).where(eq(users.identityId, 'user_revive'));
        await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, row!.id));

        await webhook('user_revive', 'revive@example.com');

        const [revived] = await db.select().from(users).where(eq(users.identityId, 'user_revive'));
        expect(revived!.deletedAt).toBeNull();
        expect(await db.select().from(accounts).where(eq(accounts.userId, revived!.id))).toHaveLength(1);
        expect(await db.select().from(profiles).where(eq(profiles.userId, revived!.id))).toHaveLength(1);
    });

    it('purgePrivateDataByIdentityId deletes account + profile and clears the avatar, but RETAINS id/email/name for attribution', async () => {
        const sub = 'user_purge';
        const email = `${sub}@example.com`;
        await provisionCompleteUser(
            deps,
            { identityId: sub, email, name: 'Keep Me', displayName: 'Keep Me', avatarUrl: 'https://img/a.jpg' },
            { onEmailCollision: 'placeholder', emailIsReal: true },
        );
        const [seeded] = await db.select().from(users).where(eq(users.identityId, sub));
        const userId = seeded!.id;
        // Precondition: the complete unit exists, with an avatar set.
        expect(await db.select().from(accounts).where(eq(accounts.userId, userId))).toHaveLength(1);
        expect(await db.select().from(profiles).where(eq(profiles.userId, userId))).toHaveLength(1);

        const dao = new UserDAO(db as unknown as PostgresJsDatabase<Record<string, never>>);
        const purged = await dao.purgePrivateDataByIdentityId(sub);
        expect(purged?.id).toBe(userId);

        // PUBLIC attribution data is retained on a soft-deleted user row: id, email, name survive.
        const [after] = await db.select().from(users).where(eq(users.id, userId));
        expect(after).toBeDefined();
        expect(after!.email).toBe(email);
        expect(after!.name).toBe('Keep Me');
        expect(after!.deletedAt).not.toBeNull();
        // PRIVATE data is purged: the avatar is cleared and the account + profile rows are deleted.
        expect(after!.picture).toBeNull();
        expect(await db.select().from(accounts).where(eq(accounts.userId, userId))).toHaveLength(0);
        expect(await db.select().from(profiles).where(eq(profiles.userId, userId))).toHaveLength(0);
    });
});
