import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { hasTestDatabase, identityDb } from './support/roleDb.js';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import { accounts, profiles, users } from '@kitchensink/identity-db';
import { UserDAO } from '@kitchensink/identity-db';
import { UsersService } from '../src/users/users.service.js';
import { noopHandleSyncPublisher } from '../src/users/handleSync.publisher.js';
import type { VerifiedClerkClaims } from '../src/auth/clerkAuth.service.js';

/**
 * Proves the named success criterion: concurrent `user.created` webhook + first read-through
 * request converge — via the `users.identity_id` / `accounts.user_id` / `profiles.user_id` unique
 * constraints — on exactly one user, account, and profile. Runs against a real Postgres (CI service;
 * named by DATABASE_ADMIN_URL); skips cleanly when none is configured.
 */

/**
 * The subject connects as `identity_service` (ADR-0039): DML and nothing else, which is what the deployed
 * service holds. `tests/globalSetup.ts` provisions and migrates the database with the production runner.
 */
const roleDb = identityDb();

const claimsFor = (sub: string): VerifiedClerkClaims => ({
    sub,
    email: `${sub}@example.com`,
    firstName: 'Con',
    lastName: 'Current',
    scopes: [],
    permissions: [],
});

describe.skipIf(!hasTestDatabase)('create-user flow — idempotency under concurrency (integration)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let usersService: UsersService;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        // No schema option: the test uses explicit table operations (not relational `db.query.*`),
        // and this keeps the type aligned with UsersService's bare NodePgDatabase parameter.
        db = drizzle(pool);
        usersService = new UsersService(db, {} as never, {} as never, noopHandleSyncPublisher, {} as never);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await roleDb.truncate();
    });

    // Mirrors the webhook's handleUserCreated DB writes, without pulling the Lambda's AWS deps in.
    async function webhookCreate(claims: VerifiedClerkClaims): Promise<void> {
        const daoDb = db;
        const displayName = [claims.firstName, claims.lastName].filter(Boolean).join(' ').trim();
        const user = await new UserDAO(daoDb).upsertByIdentityId({
            identityId: claims.sub,
            email: claims.email ?? '',
            name: displayName,
        });

        await db.insert(accounts).values({ userId: user.id }).onConflictDoNothing();
        await db
            .insert(profiles)
            .values({ userId: user.id, displayName })
            .onConflictDoUpdate({ target: profiles.userId, set: { displayName, updatedAt: new Date() } });
    }

    async function countsFor(identityId: string) {
        const userRows = await db.select().from(users).where(eq(users.identityId, identityId));
        const userId = userRows[0]?.id;
        const accountRows = userId ? await db.select().from(accounts).where(eq(accounts.userId, userId)) : [];
        const profileRows = userId ? await db.select().from(profiles).where(eq(profiles.userId, userId)) : [];

        return { users: userRows.length, accounts: accountRows.length, profiles: profileRows.length };
    }

    it('concurrent read-through + webhook create exactly one user, account, and profile', async () => {
        const sub = 'user_concurrent_a';

        await Promise.all([usersService.resolveOrCreateFromClaims(claimsFor(sub)), webhookCreate(claimsFor(sub))]);

        expect(await countsFor(sub)).toEqual({ users: 1, accounts: 1, profiles: 1 });
    });

    it('converges to one of each regardless of start order', async () => {
        const sub = 'user_concurrent_b';

        await Promise.all([webhookCreate(claimsFor(sub)), usersService.resolveOrCreateFromClaims(claimsFor(sub))]);

        expect(await countsFor(sub)).toEqual({ users: 1, accounts: 1, profiles: 1 });
    });

    it('read-through heals a webhook-first user missing an account, without duplicating rows', async () => {
        const sub = 'user_legacy_no_account';
        const daoDb = db;

        // Simulate the pre-backstop webhook: user + profile created, but no account.
        const user = await new UserDAO(daoDb).upsertByIdentityId({
            identityId: sub,
            email: `${sub}@example.com`,
            name: 'Leg Acy',
        });
        await db.insert(profiles).values({ userId: user.id, displayName: 'Leg Acy' }).onConflictDoNothing();

        expect((await countsFor(sub)).accounts).toBe(0);

        await usersService.resolveOrCreateFromClaims(claimsFor(sub));

        expect(await countsFor(sub)).toEqual({ users: 1, accounts: 1, profiles: 1 });
    });

    it('returns the same app user id across repeated read-through calls', async () => {
        const sub = 'user_stable_id';

        const first = await usersService.resolveOrCreateFromClaims(claimsFor(sub));
        const second = await usersService.resolveOrCreateFromClaims(claimsFor(sub));

        expect(first.userId).toBe(second.userId);
        expect(first.clerkUserId).toBe(sub);
        expect(await countsFor(sub)).toEqual({ users: 1, accounts: 1, profiles: 1 });
    });

    it('a no-email read-through does not clobber the real email/name a webhook already wrote', async () => {
        const sub = 'user_email_keep';

        // Webhook lands the real email + name first.
        await webhookCreate(claimsFor(sub)); // email `${sub}@example.com`, name 'Con Current'

        // A read-through with NO email/name claim would synthesize a placeholder email + empty name.
        // It must NOT overwrite the real values the webhook wrote (the cold-start race this feature
        // exists to handle).
        await usersService.resolveOrCreateFromClaims({ sub, scopes: [], permissions: [] });

        const [row] = await db.select().from(users).where(eq(users.identityId, sub));
        expect(row?.email).toBe(`${sub}@example.com`); // real email preserved, not the placeholder
        expect(row?.name).toBe('Con Current'); // real name preserved, not clobbered to empty
    });

    it('provisions a colliding-email identity with a placeholder instead of 500ing on users_email_unique', async () => {
        const subA = 'user_collide_a';
        const subB = 'user_collide_b';

        // A owns the email.
        await usersService.resolveOrCreateFromClaims({
            sub: subA,
            email: 'shared@example.com',
            scopes: [],
            permissions: [],
        });

        // B presents the SAME email (Clerk permits shared emails — delete+recreate, social link). This
        // must not raise an uncaught unique-violation (which would 500 the auth middleware on every
        // request); B is provisioned with a per-identity placeholder instead.
        await usersService.resolveOrCreateFromClaims({
            sub: subB,
            email: 'shared@example.com',
            scopes: [],
            permissions: [],
        });

        const [rowB] = await db.select().from(users).where(eq(users.identityId, subB));
        expect(rowB?.email).toBe(`${subB}@no-email.invalid`);
        expect(await countsFor(subB)).toEqual({ users: 1, accounts: 1, profiles: 1 });

        // A is untouched.
        const [rowA] = await db.select().from(users).where(eq(users.identityId, subA));
        expect(rowA?.email).toBe('shared@example.com');
    });

    it('creates two distinct users with no email claim without colliding on users_email_unique', async () => {
        // email is NOT NULL UNIQUE; a fabricated empty email would make the second emailless user
        // collide and 500. The per-identity placeholder keeps both inserts distinct.
        await usersService.resolveOrCreateFromClaims({
            sub: 'user_noemail_a',
            firstName: 'A',
            lastName: 'One',
            scopes: [],
            permissions: [],
        });
        await usersService.resolveOrCreateFromClaims({
            sub: 'user_noemail_b',
            firstName: 'B',
            lastName: 'Two',
            scopes: [],
            permissions: [],
        });

        expect(await countsFor('user_noemail_a')).toEqual({ users: 1, accounts: 1, profiles: 1 });
        expect(await countsFor('user_noemail_b')).toEqual({ users: 1, accounts: 1, profiles: 1 });
    });
});
