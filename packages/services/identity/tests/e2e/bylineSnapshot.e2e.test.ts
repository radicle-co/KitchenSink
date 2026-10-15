/**
 * The byline snapshot's producer half against a real Postgres (plan 2026-10-15-010 D5/D6; LOCAL e2e, §7.1a).
 *
 * ⛔ WHY THIS TIER. The snapshot's contract is "the last writer carries the highest key AND the whole state", and
 * every part of that is a property of the database: the row lock that serialises the two writers (the webhook's
 * `syncProviderFields` and `PATCH /users/me`), READ COMMITTED re-evaluating the SET against the committed row, and the
 * `profileClock` expression stamping a strictly larger millisecond than the row's previous one. A mocked database
 * answers whatever it is told about all three.
 *
 * Runs as `identity_service`, the role the deployed service and webhook hold.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import { profiles, UserDAO } from '@kitchensink/identity-db';
import type { HandleSyncMessage } from '@kitchensink/identity-core';

import { UsersService } from '../../src/users/users.service.js';
import type { HandleSyncPublisher } from '../../src/users/handleSync.publisher.js';
import type { AuthorizerContext } from '../../src/auth/decorators/currentUser.decorator.js';
import type { UserId } from '../../src/types/index.js';
import { identityDb } from '../support/roleDb.js';

const roleDb = identityDb();

describe('the byline snapshot (real Postgres)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let userDao: UserDAO;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 4 });
        db = drizzle(pool);
        userDao = new UserDAO(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await roleDb.truncate();
    });

    /** A provisioned user whose Clerk name is "Ada Lovelace", username "ada", profile display name `displayName`. */
    async function provision(identityId: string, displayName = 'Ada Lovelace'): Promise<UserId> {
        const user = await userDao.upsertByIdentityId({
            identityId,
            email: `${identityId}@example.com`,
            name: 'Ada Lovelace',
        });
        await pool.query('INSERT INTO accounts (user_id) VALUES ($1)', [user.id]);
        await pool.query('INSERT INTO profiles (user_id, display_name, username) VALUES ($1, $2, $3)', [
            user.id,
            displayName,
            'ada',
        ]);

        return user.id as UserId;
    }

    async function profileOf(userId: UserId) {
        const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId));

        return row!;
    }

    function serviceWith(publish: HandleSyncPublisher['publish']): UsersService {
        return new UsersService(db, {} as never, { resolveUser: vi.fn() } as never, { publish }, {} as never, false);
    }

    function ctx(userId: UserId): AuthorizerContext {
        return { userId, roles: [] } as unknown as AuthorizerContext;
    }

    describe('UserDAO.syncProviderFields (the webhook’s write)', () => {
        it('a USERNAME-ONLY change returns a snapshot carrying the PROFILE’s display name, not Clerk’s', async () => {
            // The cook overrode their display name in Profile; Clerk still says "Ada Lovelace".
            const userId = await provision('sub_override', 'Chef Ada');

            const result = await userDao.syncProviderFields(userId, {
                name: 'Ada Lovelace',
                picture: null,
                username: 'ada_cooks',
                now: new Date(),
            });
            const row = await profileOf(userId);

            expect(result.byline).toMatchObject({ displayName: 'Chef Ada', username: 'ada_cooks' });
            expect(row).toMatchObject({ displayName: 'Chef Ada', username: 'ada_cooks' });
            // One stamp, three places: the snapshot's key, the row's clock, and the owed marker.
            expect(result.byline?.stampedAt.toISOString()).toBe(row.updatedAt.toISOString());
            expect(row.handleSyncOwedAt?.toISOString()).toBe(row.updatedAt.toISOString());
        });

        it('a NAME change returns Clerk’s new name beside the stored username', async () => {
            const userId = await provision('sub_name');

            const result = await userDao.syncProviderFields(userId, {
                name: 'Ada King',
                picture: null,
                username: 'ada',
                now: new Date(),
            });

            expect(result.byline).toMatchObject({ displayName: 'Ada King', username: 'ada' });
        });

        it('returns NO snapshot and writes nothing when neither half moved (a picture-only change)', async () => {
            const userId = await provision('sub_picture');
            const before = await profileOf(userId);

            const result = await userDao.syncProviderFields(userId, {
                name: 'Ada Lovelace',
                picture: 'https://img/ada.png',
                username: 'ada',
                now: new Date(),
            });
            const after = await profileOf(userId);

            expect(result.byline).toBeUndefined();
            expect(after.handleSyncOwedAt).toBeNull();
            expect(after.avatarUrl).toBe('https://img/ada.png');
            expect(after.username).toBe(before.username);
        });

        it('stores a NULL username when Clerk says the cook has none', async () => {
            const userId = await provision('sub_null');

            const result = await userDao.syncProviderFields(userId, {
                name: 'Ada Lovelace',
                picture: null,
                username: null,
                now: new Date(),
            });

            expect(result.byline).toMatchObject({ username: null });
            expect((await profileOf(userId)).username).toBeNull();
        });
    });

    describe('the clock', () => {
        it('stamps a STRICTLY larger millisecond on back-to-back writes, so no two snapshots share a key', async () => {
            const userId = await provision('sub_clock');
            const messages: HandleSyncMessage[] = [];
            const service = serviceWith(async (message) => {
                messages.push(message);
            });

            await service.patchUserMe(ctx(userId), { displayName: 'One' });
            await service.patchUserMe(ctx(userId), { displayName: 'Two' });
            await service.patchUserMe(ctx(userId), { displayName: 'Three' });

            const stamps = messages.map((message) => Date.parse(message.sourceTimestamp));
            expect(stamps).toHaveLength(3);
            expect(stamps[1]!).toBeGreaterThan(stamps[0]!);
            expect(stamps[2]!).toBeGreaterThan(stamps[1]!);
        });

        it('⛔ stamps whole milliseconds even when the previous stamp carries MICROSECONDS, so the debt can settle', async () => {
            // A row written by a column default (`now()`) carries microseconds. Put that stamp ahead of the
            // statement's clock so `previous + 1 ms` is the larger arm of GREATEST: a clock that truncated before
            // comparing would hand back microseconds, which no JS `Date` can hold, and the settle would never match.
            const userId = await provision('sub_micro');
            await pool.query(
                `UPDATE profiles SET updated_at = now() + interval '5 seconds' + interval '123 microseconds' WHERE user_id = $1`,
                [userId],
            );

            const { byline } = await userDao.syncProviderFields(userId, {
                name: 'Ada King',
                picture: null,
                username: 'ada',
                now: new Date(),
            });
            await userDao.settleHandleSync(userId, byline!.stampedAt, null);
            const row = await profileOf(userId);

            expect(row.updatedAt.toISOString()).toBe(byline!.stampedAt.toISOString());
            expect(row.handleSyncOwedAt).toBeNull();
        });

        it('⛔ under a CONCURRENT PATCH and webhook, the highest-keyed snapshot carries BOTH changes', async () => {
            const userId = await provision('sub_race');
            const messages: HandleSyncMessage[] = [];
            const service = serviceWith(async (message) => {
                messages.push(message);
            });

            await Promise.all([
                service.patchUserMe(ctx(userId), { displayName: 'Chef Ada' }),
                userDao
                    .syncProviderFields(userId, {
                        name: 'Ada Lovelace',
                        picture: null,
                        username: 'ada_cooks',
                        now: new Date(),
                    })
                    .then((result) => {
                        if (result.byline !== undefined) {
                            messages.push({
                                userId,
                                displayName: result.byline.displayName,
                                username: result.byline.username,
                                sourceTimestamp: result.byline.stampedAt.toISOString(),
                            });
                        }
                    }),
            ]);

            const latest = [...messages].sort(
                (a, b) => Date.parse(b.sourceTimestamp) - Date.parse(a.sourceTimestamp),
            )[0];
            const row = await profileOf(userId);

            expect(new Set(messages.map((message) => message.sourceTimestamp)).size).toBe(messages.length);
            // Whichever writer committed second saw the other's change, so the winning key holds the final state.
            expect(latest).toMatchObject({ displayName: 'Chef Ada', username: 'ada_cooks' });
            expect(latest?.sourceTimestamp).toBe(row.updatedAt.toISOString());
        });
    });

    describe('read-through create (plan 2026-10-15-010 D6b)', () => {
        it('publishes the byline it CREATED, keyed by the insert’s stamp, and settles that debt', async () => {
            const publish = vi.fn().mockResolvedValue(undefined);

            const created = await serviceWith(publish).resolveOrCreateFromClaims({
                sub: 'sub_seed',
                email: 'seed@example.com',
                firstName: 'Ada',
                lastName: 'Lovelace',
                username: 'ada',
                scopes: [],
                roles: [],
                permissions: [],
                testPrincipal: false,
            });
            const row = await profileOf(created.userId);

            expect(publish).toHaveBeenCalledWith({
                userId: created.userId,
                displayName: 'Ada Lovelace',
                username: 'ada',
                sourceTimestamp: row.updatedAt.toISOString(),
            });
            expect(row.handleSyncOwedAt).toBeNull();
        });

        it('publishes NOTHING for a cook who already exists — the hot path stays one SELECT', async () => {
            const userId = await provision('sub_existing');
            const publish = vi.fn().mockResolvedValue(undefined);

            const resolved = await serviceWith(publish).resolveOrCreateFromClaims({
                sub: 'sub_existing',
                email: 'sub_existing@example.com',
                username: 'ada',
                scopes: [],
                roles: [],
                permissions: [],
                testPrincipal: false,
            });

            expect(resolved.userId).toBe(userId);
            expect(publish).not.toHaveBeenCalled();
        });

        it('leaves the creation debt, coded, when the publish fails — the sign-in still succeeds', async () => {
            const created = await serviceWith(
                vi.fn().mockRejectedValue(new Error('sns down')),
            ).resolveOrCreateFromClaims({
                sub: 'sub_seed_fail',
                email: 'fail@example.com',
                firstName: 'Ada',
                username: 'ada',
                scopes: [],
                roles: [],
                permissions: [],
                testPrincipal: false,
            });
            const row = await profileOf(created.userId);

            expect(row.handleSyncOwedAt?.toISOString()).toBe(row.updatedAt.toISOString());
            expect(row.handleSyncFailureCode).toBe('publish_failed');
        });
    });

    describe('PATCH /users/me', () => {
        it('publishes the snapshot from the row it wrote, keyed by the database’s stamp, and settles the debt', async () => {
            const userId = await provision('sub_patch');
            const publish = vi.fn().mockResolvedValue(undefined);

            await serviceWith(publish).patchUserMe(ctx(userId), { displayName: 'Chef Ada' });
            const row = await profileOf(userId);

            expect(publish).toHaveBeenCalledWith({
                userId,
                displayName: 'Chef Ada',
                username: 'ada',
                sourceTimestamp: row.updatedAt.toISOString(),
            });
            expect(row.handleSyncOwedAt).toBeNull();
        });

        it('leaves the debt, with its failure code, when the publish fails — and the rename still succeeds', async () => {
            const userId = await provision('sub_patch_fail');

            const result = await serviceWith(vi.fn().mockRejectedValue(new Error('sns down'))).patchUserMe(
                ctx(userId),
                {
                    displayName: 'Chef Ada',
                },
            );
            const row = await profileOf(userId);

            expect(result.user.displayName).toBe('Chef Ada');
            expect(row.handleSyncOwedAt?.toISOString()).toBe(row.updatedAt.toISOString());
            expect(row.handleSyncFailureCode).toBe('publish_failed');
        });
    });
});
