/**
 * U9 — a rename that fails to publish is VISIBLE instead of lost (R21, R25), against a real database.
 *
 * ⛔ WHAT WAS WRONG. Both rename routes publish to the handle-sync topic AFTER the profile write commits,
 * and the publish is deliberately best-effort: a failed fan-out must not fail the user's rename. The
 * consequence was that a failed publish left NOTHING behind. The cook's name changed in identity and never
 * changed on their recipes, and the only trace was one `logger.error` in a log nobody reads —
 * `users.service.ts` said the reconciliation backstops it, and there is no reconciliation for display names.
 *
 * The rename now records that a sync is OWED, in the SAME statement that changes the name (ADR-0034's rule:
 * the record and the thing it describes move together or not at all). The publish clears it on success and
 * leaves it with a code on failure.
 *
 * ⛔ WHY THIS TIER. "In the same statement" is a claim about a TRANSACTION — that a rolled-back rename leaves
 * no marker, that a concurrent second rename keeps the newer intent, that the conditional settle matches on a
 * stamp. A mocked database answers whatever it is told.
 *
 * Runs as `identity_service` (ADR-0039), the role the deployed service holds; skipped without a database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import { accounts, profiles, UserDAO, users } from '@kitchensink/identity-db';
import { HANDLE_SYNC_PUBLISH_FAILED } from '@kitchensink/identity-core';

import { hasTestDatabase, identityDb } from './support/roleDb.js';
import type { UserId } from '../src/types/index.js';

const roleDb = identityDb();

describe.skipIf(!hasTestDatabase)('the handle-sync owed marker (integration)', () => {
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

    async function provisionUser(identityId: string, displayName: string): Promise<UserId> {
        const user = await userDao.upsertByIdentityId({
            identityId,
            email: `${identityId}@example.com`,
            name: displayName,
        });

        await db.insert(accounts).values({ userId: user.id }).onConflictDoNothing();
        await db.insert(profiles).values({ userId: user.id, displayName }).onConflictDoNothing();

        return user.id as UserId;
    }

    async function marker(userId: string): Promise<{ owedAt: Date | null; code: string | null }> {
        const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId));

        return { owedAt: row?.handleSyncOwedAt ?? null, code: row?.handleSyncFailureCode ?? null };
    }

    it('⛔ a rename through the WEBHOOK route sets the marker in the same transaction as the name', async () => {
        const userId = await provisionUser('user_owed_webhook', 'Original');
        const now = new Date();

        const { displayNameChanged } = await userDao.syncNameAndPicture(userId, {
            name: 'Renamed',
            picture: null,
            now,
        });

        expect(displayNameChanged).toBe(true);

        const after = await marker(userId);
        expect(after.owedAt?.getTime()).toBe(now.getTime());
        expect(after.code).toBeNull();
    });

    /**
     * ⛔ The transaction claim itself. `syncNameAndPicture` writes `users` and `profiles` inside ONE
     * transaction, so a failure after the name write must leave no marker either — otherwise the backstop
     * would chase a debt for a rename that never happened.
     */
    it('⛔ a ROLLED BACK rename leaves no marker and no name change', async () => {
        const userId = await provisionUser('user_owed_rollback', 'Original');

        await expect(
            db.transaction(async (tx) => {
                await new UserDAO(tx as unknown as NodePgDatabase<Record<string, never>>).syncNameAndPicture(userId, {
                    name: 'Renamed',
                    picture: null,
                    now: new Date(),
                });

                throw new Error('the caller failed after the rename');
            }),
        ).rejects.toThrow('the caller failed after the rename');

        const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
        expect(profile?.displayName).toBe('Original');
        expect(profile?.handleSyncOwedAt).toBeNull();
    });

    it('an AVATAR-only change owes nothing — it publishes nothing', async () => {
        const userId = await provisionUser('user_owed_avatar', 'Original');

        await userDao.syncNameAndPicture(userId, {
            name: 'Original',
            picture: 'https://example.com/new.png',
            now: new Date(),
        });

        expect((await marker(userId)).owedAt).toBeNull();
    });

    it('a SUCCESSFUL publish clears the marker', async () => {
        const userId = await provisionUser('user_owed_cleared', 'Original');
        const now = new Date();
        await userDao.syncNameAndPicture(userId, { name: 'Renamed', picture: null, now });

        await userDao.settleHandleSync(userId, now, null);

        expect(await marker(userId)).toEqual({ owedAt: null, code: null });
    });

    it('a FAILED publish leaves the debt, with a code saying why', async () => {
        const userId = await provisionUser('user_owed_failed', 'Original');
        const now = new Date();
        await userDao.syncNameAndPicture(userId, { name: 'Renamed', picture: null, now });

        await userDao.settleHandleSync(userId, now, HANDLE_SYNC_PUBLISH_FAILED);

        const after = await marker(userId);
        expect(after.owedAt?.getTime()).toBe(now.getTime());
        expect(after.code).toBe(HANDLE_SYNC_PUBLISH_FAILED);
    });

    /**
     * ⛔ THE RACE THE CONDITIONAL SETTLE EXISTS FOR. A second rename lands while the first publish is still
     * in flight. Settling unconditionally would erase the NEWER debt and leave that second name un-synced
     * with nothing recording it — the exact silence this marker exists to end, reintroduced by the
     * SUCCESSFUL path, which is the one nobody would think to check.
     */
    it('⛔ a second rename during a failed publish keeps the NEWER owed stamp', async () => {
        const userId = await provisionUser('user_owed_race', 'Original');
        const first = new Date('2026-09-16T10:00:00.000Z');
        const second = new Date('2026-09-16T10:00:05.000Z');

        await userDao.syncNameAndPicture(userId, { name: 'Second', picture: null, now: first });
        await userDao.syncNameAndPicture(userId, { name: 'Third', picture: null, now: second });

        // The FIRST rename's publish now finishes — successfully — and must not settle the second's debt.
        await userDao.settleHandleSync(userId, first, null);

        const after = await marker(userId);
        expect(after.owedAt?.getTime()).toBe(second.getTime());
    });

    /**
     * ⚠️ Both columns live on `profiles`, which erasure deletes wholesale — so no new sweep is owed and a
     * GDPR erasure takes the marker with the row. Asserted rather than assumed, because "the existing sweep
     * covers it" is exactly the kind of claim that stops being true when a table moves.
     */
    it('⛔ erasing the identity takes both columns with the row', async () => {
        const userId = await provisionUser('user_owed_erased', 'Original');
        await userDao.syncNameAndPicture(userId, { name: 'Renamed', picture: null, now: new Date() });

        await db.delete(users).where(eq(users.id, userId));

        const rows = await db.select().from(profiles).where(eq(profiles.userId, userId));
        expect(rows).toHaveLength(0);
    });
});
