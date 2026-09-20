/**
 * ADR-0040 test-principal containment against a REAL Postgres, through the real `UsersService`.
 *
 * The unit tier proves the refusal happens before any collaborator is touched; this tier proves the property that
 * actually matters to the pool — a contained erasure or closure leaves the database EXACTLY as it was (users row,
 * account, profile, and no lifecycle audit row), and enqueues nothing, while under `off` the same calls tombstone or
 * erase as they always have. The principal is provisioned through `resolveOrCreateFromClaims` from verified-claims
 * input, so the flag crosses the claims → authorizer-context boundary rather than being hand-set on a context.
 *
 * The subject connects as `identity_service` (ADR-0039): DML only, what the deployed service holds.
 * `tests/globalSetup.ts` provisions and migrates the database with the production runner.
 */
import { ForbiddenException } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { accounts, lifecycleEvents, profiles, users } from '@kitchensink/identity-db';

import { hasTestDatabase, identityDb } from './support/roleDb.js';
import type { VerifiedClerkClaims } from '../src/auth/clerkAuth.service.js';
import { noopHandleSyncPublisher } from '../src/users/handleSync.publisher.js';
import { UsersService } from '../src/users/users.service.js';
import type { AuthorizerContext } from '../src/types/index.js';

const roleDb = identityDb();

const claimsFor = (sub: string, testPrincipal: boolean): VerifiedClerkClaims => ({
    sub,
    email: `${sub}@example.test`,
    firstName: 'Pool',
    lastName: 'Member',
    scopes: [],
    permissions: [],
    testPrincipal,
});

describe.skipIf(!hasTestDatabase)('test-principal containment — lifecycle actions (integration)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let service: UsersService;
    const enqueueDeletion = vi.fn();
    const deleteAllForUser = vi.fn();

    /** Everything identity holds for one user — the state a contained action must not change. */
    async function snapshot(userId: string) {
        return {
            users: await db.select().from(users).where(eq(users.id, userId)),
            accounts: await db.select().from(accounts).where(eq(accounts.userId, userId)),
            profiles: await db.select().from(profiles).where(eq(profiles.userId, userId)),
            lifecycleEvents: await db.select().from(lifecycleEvents).where(eq(lifecycleEvents.userId, userId)),
        };
    }

    async function provision(sub: string, testPrincipal: boolean): Promise<AuthorizerContext> {
        return service.resolveOrCreateFromClaims(claimsFor(sub, testPrincipal));
    }

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = drizzle(pool);
        service = new UsersService(db, { enqueueDeletion } as never, {} as never, noopHandleSyncPublisher, {
            deleteAllForUser,
        } as never);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await roleDb.truncate();
        enqueueDeletion.mockReset().mockResolvedValue(undefined);
        deleteAllForUser.mockReset().mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe('under enforce', () => {
        beforeEach(() => {
            vi.stubEnv('TEST_PRINCIPAL_CONTAINMENT', 'enforce');
        });

        it.each([
            ['closure (DELETE me)', 'deleteUserMe'],
            ['erasure (POST me/erasure)', 'eraseUserMe'],
        ] as const)(
            'refuses a test principal’s %s with 403 TEST_PRINCIPAL_CONTAINED and changes no row',
            async (_label, method) => {
                const ctx = await provision(`user_pool_${method}`, true);
                expect(ctx.testPrincipal).toBe(true);

                const before = await snapshot(ctx.userId);
                expect(before.users).toHaveLength(1);
                expect(before.accounts).toHaveLength(1);
                expect(before.profiles).toHaveLength(1);

                const error = await service[method](ctx).then(
                    () => undefined,
                    (thrown: unknown) => thrown,
                );

                expect(error).toBeInstanceOf(ForbiddenException);
                expect((error as ForbiddenException).getStatus()).toBe(403);
                expect((error as ForbiddenException).getResponse()).toMatchObject({ code: 'TEST_PRINCIPAL_CONTAINED' });

                expect(await snapshot(ctx.userId)).toStrictEqual(before);
                expect(before.users[0]!.status).toBe('active');
                expect(before.lifecycleEvents).toHaveLength(0);
                expect(enqueueDeletion).not.toHaveBeenCalled();
                expect(deleteAllForUser).not.toHaveBeenCalled();
            },
        );

        it('still closes a REAL user’s account — containment never reaches a non-pool principal', async () => {
            const ctx = await provision('user_real_enforce', false);

            await service.deleteUserMe(ctx);

            const after = await snapshot(ctx.userId);
            expect(after.users[0]!.status).toBe('tombstoned');
            expect(after.lifecycleEvents.map((event) => event.event)).toStrictEqual(['closure']);
            expect(enqueueDeletion).toHaveBeenCalledWith(expect.objectContaining({ event: 'closure' }));
        });
    });

    describe('under off (sandbox)', () => {
        beforeEach(() => {
            vi.stubEnv('TEST_PRINCIPAL_CONTAINMENT', 'off');
        });

        it('admits a test principal’s closure: tombstones, audits, and enqueues the ban', async () => {
            const ctx = await provision('user_pool_close_off', true);

            await expect(service.deleteUserMe(ctx)).resolves.toMatchObject({ sub: ctx.userId });

            const after = await snapshot(ctx.userId);
            expect(after.users[0]!.status).toBe('tombstoned');
            expect(after.lifecycleEvents.map((event) => event.event)).toStrictEqual(['closure']);
            expect(enqueueDeletion).toHaveBeenCalledWith(
                expect.objectContaining({ identityId: 'user_pool_close_off', userId: ctx.userId, event: 'closure' }),
            );
        });

        it('admits a test principal’s erasure: erases, audits, and enqueues the erasure', async () => {
            const ctx = await provision('user_pool_erase_off', true);

            await expect(service.eraseUserMe(ctx)).resolves.toMatchObject({ sub: ctx.userId });

            const after = await snapshot(ctx.userId);
            expect(after.users[0]!.status).toBe('erased');
            expect(after.lifecycleEvents.map((event) => event.event)).toStrictEqual(['erasure']);
            expect(enqueueDeletion).toHaveBeenCalledWith(
                expect.objectContaining({ identityId: 'user_pool_erase_off', userId: ctx.userId, event: 'erasure' }),
            );
        });
    });
});
