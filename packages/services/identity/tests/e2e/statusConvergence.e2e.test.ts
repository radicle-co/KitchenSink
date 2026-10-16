/**
 * U10 — closure and reactivation CONVERGE on the intended state (R26, R27), against a real database.
 *
 * ⛔ WHAT WAS WRONG. Both reach Clerk through the deletion queue, because only that Lambda holds the Clerk
 * secret. That queue is an SQS STANDARD queue — at-least-once and UNORDERED — so a user who closes their
 * account and is then reactivated by an admin can have the two messages delivered in either order, and the
 * worker applied whichever arrived last: it read the EVENT NAME off the message with no reference to what
 * the database said. The reachable outcome is an account `active` in identity and BANNED at Clerk. The
 * person cannot sign in, and nothing anywhere records that the two disagree.
 *
 * ⛔ WHY THIS TIER. The guarantee is that the version increments inside the SAME transaction as the status —
 * a claim a mocked database cannot make — and that the settle is a compare-and-set that a concurrent change
 * defeats. Both are properties of Postgres, not of our code's intentions.
 *
 * Runs as `identity_service` (ADR-0039); skipped without a database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';

import { accounts, profiles, UserDAO, users } from '@kitchensink/identity-db';
import { providerChangeIsOwed } from '@kitchensink/identity-core';

import { AdminService } from '../../src/admin/admin.service.js';
import { noopHandleSyncPublisher } from '../../src/users/handleSync.publisher.js';
import { UsersService } from '../../src/users/users.service.js';
import { identityDb } from '../support/roleDb.js';
import type { UserId } from '../../src/types/index.js';

const roleDb = identityDb();

describe('status convergence (integration)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let userDao: UserDAO;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = drizzle(pool);
        userDao = new UserDAO(db);
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

        await db.insert(accounts).values({ userId: user.id }).onConflictDoNothing();
        await db.insert(profiles).values({ userId: user.id, displayName: 'A Cook' }).onConflictDoNothing();

        return user.id;
    }

    async function readState(userId: UserId) {
        const [row] = await db.select().from(users).where(eq(users.id, userId));

        return {
            status: row?.status ?? 'missing',
            statusVersion: row?.statusVersion ?? 0,
            statusAppliedVersion: row?.statusAppliedVersion ?? 0,
        };
    }

    /** Change the status the way a service path does: status and version in ONE statement. */
    async function changeStatus(userId: UserId, status: 'active' | 'suspended' | 'tombstoned'): Promise<void> {
        await db
            .update(users)
            .set({ status, updatedAt: new Date(), statusVersion: sql`${users.statusVersion} + 1` })
            .where(eq(users.id, userId));
    }

    it('a fresh user starts converged — the provider agrees by construction', async () => {
        const userId = await provisionUser('user_conv_fresh');

        expect(providerChangeIsOwed(await readState(userId))).toBe(false);
    });

    it('⛔ a status change makes the account OWED until the provider is brought to it', async () => {
        const userId = await provisionUser('user_conv_owed');

        await changeStatus(userId, 'tombstoned');

        const owed = await readState(userId);
        expect(providerChangeIsOwed(owed)).toBe(true);

        expect(await userDao.settleStatusVersion(userId, owed.statusVersion)).toBe(true);
        expect(providerChangeIsOwed(await readState(userId))).toBe(false);
    });

    /**
     * ⛔ THE RACE THE COMPARE-AND-SET EXISTS FOR. A newer intent is recorded while the provider call is in
     * flight. Settling anyway would mark the account converged at a state it is no longer in, and nothing
     * downstream could tell — so zero rows matched IS the signal, and the caller must not acknowledge.
     */
    it('⛔ a settle whose intent MOVED during the provider call is refused', async () => {
        const userId = await provisionUser('user_conv_race');
        await changeStatus(userId, 'tombstoned');
        const read = await readState(userId);

        // The admin reactivates while the worker is mid-call at Clerk.
        await changeStatus(userId, 'active');

        expect(await userDao.settleStatusVersion(userId, read.statusVersion)).toBe(false);
        // ...and the account is still owed, so the redelivery applies the NEWER intent.
        expect(providerChangeIsOwed(await readState(userId))).toBe(true);
    });

    /**
     * ⛔ THE INTERLEAVE, end to end. Close, then reactivate, then let the STALE closure settle last — which
     * is exactly what an unordered queue produces. The account must end active and converged, not banned.
     */
    it('⛔ closure then reactivation, with the CLOSURE settling last, leaves the account active', async () => {
        const userId = await provisionUser('user_conv_interleave');

        await changeStatus(userId, 'tombstoned');
        const closure = await readState(userId);

        await changeStatus(userId, 'active');
        const reactivation = await readState(userId);

        // The reactivation's worker settles first...
        expect(await userDao.settleStatusVersion(userId, reactivation.statusVersion)).toBe(true);
        // ...and the closure's worker, holding the older intent, is refused.
        expect(await userDao.settleStatusVersion(userId, closure.statusVersion)).toBe(false);

        const final = await readState(userId);
        expect(final.status).toBe('active');
        expect(providerChangeIsOwed(final)).toBe(false);
    });

    it('repeated settles of ONE intent are idempotent — one applied record', async () => {
        const userId = await provisionUser('user_conv_repeat');
        await changeStatus(userId, 'tombstoned');
        const read = await readState(userId);

        expect(await userDao.settleStatusVersion(userId, read.statusVersion)).toBe(true);
        expect(await userDao.settleStatusVersion(userId, read.statusVersion)).toBe(true);
        expect((await readState(userId)).statusAppliedVersion).toBe(read.statusVersion);
    });

    it('⛔ an ERASED account is never owed, whatever the versions say', async () => {
        const userId = await provisionUser('user_conv_erased');
        await changeStatus(userId, 'tombstoned');
        await db.update(users).set({ status: 'erased' }).where(eq(users.id, userId));

        const state = await readState(userId);
        expect(state.statusAppliedVersion).not.toBe(state.statusVersion);
        expect(providerChangeIsOwed(state)).toBe(false);
    });

    /**
     * ⛔ THE PRODUCTION WRITERS, not a stand-in. The cases above change status through `changeStatus`, which
     * writes the increment itself, so they prove the settle and never that a real status writer bumps the
     * intent. A closure or reactivation that forgot the bump would settle against an unchanged version, and the
     * unordered-queue race above would silently return.
     */
    describe('the service paths that change status bump the intent by exactly one', () => {
        const enqueueDeletion = vi.fn();
        let usersService: UsersService;
        let adminService: AdminService;

        beforeAll(() => {
            usersService = new UsersService(
                db,
                { enqueueDeletion } as never,
                {} as never,
                noopHandleSyncPublisher,
                { deleteAllForUser: vi.fn().mockResolvedValue(undefined) } as never,
                false,
            );
            adminService = new AdminService(db, { enqueueDeletion } as never);
        });

        beforeEach(() => {
            enqueueDeletion.mockReset().mockResolvedValue(undefined);
        });

        const provisionViewer = (sub: string) =>
            usersService.resolveOrCreateFromClaims({
                sub,
                email: `${sub}@example.test`,
                firstName: 'A',
                lastName: 'Cook',
                scopes: [],
                permissions: [],
                roles: [],
                testPrincipal: false,
            });

        it('a closure (deleteUserMe) bumps the version once and leaves the account owed', async () => {
            const ctx = await provisionViewer('user_conv_closure_writer');
            const before = await readState(ctx.userId);

            await usersService.deleteUserMe(ctx);

            const after = await readState(ctx.userId);
            expect(after.status).toBe('tombstoned');
            expect(after.statusVersion).toBe(before.statusVersion + 1);
            expect(providerChangeIsOwed(after)).toBe(true);
        });

        it('a reactivation (reactivateUser) bumps the version once more and leaves the account owed', async () => {
            const ctx = await provisionViewer('user_conv_reactivation_writer');
            await usersService.deleteUserMe(ctx);
            const closed = await readState(ctx.userId);

            await adminService.reactivateUser(ctx.userId, ctx);

            const after = await readState(ctx.userId);
            expect(after.status).toBe('active');
            expect(after.statusVersion).toBe(closed.statusVersion + 1);
            expect(providerChangeIsOwed(after)).toBe(true);
        });
    });
});
