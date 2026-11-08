/**
 * Concurrent status changes: only one wins, against a real database (LOCAL e2e, `docs/CODING_STANDARDS.md` §7.1a).
 *
 * Suspend, unsuspend and self-closure each READ a status, check it, then WRITE. Before the status-guarded writes, two
 * of them racing both passed the check and the later write won, so an erased or tombstoned account could come back
 * as `suspended` or `active`. Now the status that was read sits in the UPDATE's WHERE: when two writers race, Postgres
 * lets one through and re-checks the other's WHERE against the committed row, which no longer matches.
 *
 * ⛔ WHY THIS TIER. A mocked database has no row lock and no second session, so it can only show that the WHERE is
 * written, never that two real transactions are told apart. Each case below runs the two calls at the same time over
 * separate pooled connections, many times, because the interleave is the thing under test.
 *
 * Runs as `identity_service` (ADR-0039). With no `DATABASE_ADMIN_URL` the harness throws; this tier never skips.
 */
import { HttpException } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { users } from '@kitchensink/identity-db';

import { AdminService } from '../../src/admin/admin.service.js';
import { noopHandleSyncPublisher } from '../../src/users/handleSync.publisher.js';
import { UsersService } from '../../src/users/users.service.js';
import { identityDb } from '../support/roleDb.js';
import type { AuthorizerContext, UserId } from '../../src/types/index.js';

const roleDb = identityDb();

/** How many fresh users each case races. The interleave is timing, so one round proves little. */
const ROUNDS = 25;

/** Why a settled call failed: the HTTP status Nest would send, or `undefined` for a call that succeeded. */
function failureStatus(result: PromiseSettledResult<unknown>): number | undefined {
    if (result.status === 'fulfilled') {
        return undefined;
    }

    return result.reason instanceof HttpException ? result.reason.getStatus() : -1;
}

describe('status races (LOCAL e2e — real Postgres)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let usersService: UsersService;
    let adminService: AdminService;
    let sequence = 0;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 10 });
        db = drizzle(pool);
        usersService = new UsersService(
            db,
            { enqueueDeletion: vi.fn().mockResolvedValue(undefined) } as never,
            {} as never,
            noopHandleSyncPublisher,
            { removeAll: vi.fn().mockResolvedValue(undefined) } as never,
            false,
        );
        adminService = new AdminService(db, { enqueueDeletion: vi.fn().mockResolvedValue(undefined) } as never);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await roleDb.truncate();
    });

    const provision = (): Promise<AuthorizerContext> => {
        sequence += 1;
        const sub = `user_race_${sequence}`;

        return usersService.resolveOrCreateFromClaims({
            sub,
            email: `${sub}@example.test`,
            firstName: 'A',
            lastName: 'Cook',
            scopes: [],
            permissions: [],
            roles: [],
            testPrincipal: false,
        });
    };

    const statusOf = async (userId: UserId): Promise<string | undefined> => {
        const [row] = await db.select({ status: users.status }).from(users).where(eq(users.id, userId));

        return row?.status;
    };

    it('two concurrent suspensions of one user: one wins, the other gets 409', async () => {
        for (let round = 0; round < ROUNDS; round += 1) {
            const target = await provision();

            const results = await Promise.allSettled([
                adminService.suspendUser(target.userId, target),
                adminService.suspendUser(target.userId, target),
            ]);

            expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
            expect(results.map(failureStatus).filter((status) => status !== undefined)).toEqual([409]);
            expect(await statusOf(target.userId)).toBe('suspended');
        }
    });

    it('a suspension racing the user closing their own account: one wins, the loser is refused', async () => {
        for (let round = 0; round < ROUNDS; round += 1) {
            const target = await provision();

            const [suspension, closure] = await Promise.allSettled([
                adminService.suspendUser(target.userId, target),
                usersService.deleteUserMe(target),
            ]);

            const final = await statusOf(target.userId);

            // Exactly one of them changed the row, and the row holds THAT writer's status.
            expect([suspension.status, closure.status].filter((status) => status === 'fulfilled')).toHaveLength(1);
            expect(final).toBe(suspension.status === 'fulfilled' ? 'suspended' : 'tombstoned');
            // The loser either read the winner's status (403 from the gate) or lost the write (409 from the guard).
            const loserStatus = [failureStatus(suspension), failureStatus(closure)].find(
                (status) => status !== undefined,
            );
            expect([403, 409]).toContain(loserStatus);
        }
    });

    it('a suspension cannot overwrite an erased account', async () => {
        const target = await provision();
        await pool.query(`UPDATE users SET status = 'erased' WHERE id = $1`, [target.userId]);

        await expect(adminService.suspendUser(target.userId, target)).rejects.toMatchObject({ status: 409 });
        expect(await statusOf(target.userId)).toBe('erased');
    });
});
