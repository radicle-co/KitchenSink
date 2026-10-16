/**
 * The "Clerk confirmed this account is gone" fact (`users.provider_deleted_at`, migration 0017), against REAL Postgres.
 *
 * ⛔ WHY THIS TIER. Every claim here is a property of a `WHERE` clause or a CHECK constraint, and a mocked
 * database evaluates neither:
 *
 *  - `eraseIdentityRow` writes the confirmation it is GIVEN in the same UPDATE as the scrub (the sweep passes
 *    `now`, the self-service path passes `null`);
 *  - `confirmProviderDeleted` stamps once, only an erased row, and never moves an earlier stamp;
 *  - the CHECKs make "reconciled while Clerk may be alive" unstorable;
 *  - reconciliation's scan returns an erased row whose provider deletion is still owed.
 */
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/common/db.js', () => ({ getDb: vi.fn() }));

vi.mock('../../src/common/observability.js', () => ({
    emitMetric: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    withObservability: <T, R>(fn: (event: T, ctx: unknown) => Promise<R>) => fn,
}));

import { eraseIdentityRow, UserDAO, users, type UserId } from '@kitchensink/identity-db';

import { selectPendingErasures } from '../../src/handlers/erasureReconciliation.js';
import { openTestDb, resetIdentityRows } from '../support/roleDb.js';
import { makeIdentityUser } from '../__fixtures__/makeIdentityUser.js';

describe('users.provider_deleted_at (integration — real Postgres)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let dao: UserDAO;

    beforeAll(() => {
        ({ pool, db } = openTestDb());
        dao = new UserDAO(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetIdentityRows(pool);
    });

    /** Seed one user row. @sideEffect Inserts into `users`. */
    async function seed(overrides: Parameters<typeof makeIdentityUser>[0] = {}): Promise<UserId> {
        const row = makeIdentityUser(overrides);
        await db.insert(users).values(row);

        return row.id;
    }

    /** Read one user row back. */
    async function read(id: UserId): Promise<typeof users.$inferSelect> {
        const [row] = await db.select().from(users).where(eq(users.id, id));

        return row!;
    }

    describe('eraseIdentityRow writes the confirmation it is given, in the same UPDATE as the scrub', () => {
        it('stores the instant when the caller already deleted the provider account', async () => {
            const id = await seed();
            const now = new Date('2026-10-01T00:00:00.000Z');

            await eraseIdentityRow(
                db,
                { userId: id, triggerSource: 'sweep', actor: null, providerDeletedAt: now },
                now,
            );

            expect((await read(id)).providerDeletedAt?.toISOString()).toBe(now.toISOString());
        });

        it('stores NULL when the provider account is still to be deleted (self-service erasure)', async () => {
            const id = await seed();

            await eraseIdentityRow(
                db,
                { userId: id, triggerSource: 'user', actor: id, providerDeletedAt: null },
                new Date(),
            );

            const row = await read(id);
            expect(row.status).toBe('erased');
            expect(row.providerDeletedAt).toBeNull();
        });
    });

    describe('confirmProviderDeleted', () => {
        it('stamps an erased row, and leaves updated_at alone', async () => {
            const id = await seed({ status: 'erased', updatedAt: new Date('2026-09-01T00:00:00.000Z') });
            const at = new Date('2026-10-02T00:00:00.000Z');

            await dao.confirmProviderDeleted(id, at);

            const row = await read(id);
            expect(row.providerDeletedAt?.toISOString()).toBe(at.toISOString());
            expect(row.updatedAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
        });

        it('is idempotent — a second confirmation never moves the first instant', async () => {
            const id = await seed({ status: 'erased' });
            const first = new Date('2026-10-02T00:00:00.000Z');

            await dao.confirmProviderDeleted(id, first);
            await dao.confirmProviderDeleted(id, new Date('2026-10-09T00:00:00.000Z'));

            expect((await read(id)).providerDeletedAt?.toISOString()).toBe(first.toISOString());
        });

        it('refuses a row that is not erased (the CHECK would reject it anyway; the DAO never asks)', async () => {
            const id = await seed({ status: 'active' });

            await dao.confirmProviderDeleted(id, new Date());

            expect((await read(id)).providerDeletedAt).toBeNull();
        });

        it('touches ONLY the named row', async () => {
            const target = await seed({ status: 'erased' });
            const bystander = await seed({ status: 'erased' });

            await dao.confirmProviderDeleted(target, new Date());

            expect((await read(bystander)).providerDeletedAt).toBeNull();
        });
    });

    describe('the CHECKs refuse an unsafe row', () => {
        // Drizzle wraps the driver error, so the violated constraint is read off the Postgres error it carries.
        const violating = (constraint: string) => ({ cause: expect.objectContaining({ constraint }) });

        it('refuses a confirmation on a row that is not erased', async () => {
            await expect(seed({ status: 'active', providerDeletedAt: new Date() })).rejects.toMatchObject(
                violating('users_provider_deleted_only_erased'),
            );
        });

        it('refuses reconciled_at while the provider deletion is unconfirmed', async () => {
            const id = await seed({ status: 'erased' });

            await expect(
                db.update(users).set({ reconciledAt: new Date() }).where(eq(users.id, id)),
            ).rejects.toMatchObject(violating('users_reconciled_requires_provider_deleted'));
        });
    });

    describe('reconciliation scan', () => {
        const longAgo = new Date('2026-01-01T00:00:00.000Z');
        const cutoff = new Date('2026-06-01T00:00:00.000Z');

        it('returns an erased row whose provider deletion is owed, with the fact that it is owed', async () => {
            const id = await seed({ status: 'erased', updatedAt: longAgo });

            const pending = await selectPendingErasures(db, cutoff);

            expect(pending).toEqual([expect.objectContaining({ id, providerDeletedAt: null })]);
        });

        it('returns a confirmed-but-unreconciled row with its confirmation', async () => {
            const id = await seed({ status: 'erased', updatedAt: longAgo, providerDeletedAt: longAgo });

            const pending = await selectPendingErasures(db, cutoff);

            expect(pending).toEqual([expect.objectContaining({ id, providerDeletedAt: longAgo })]);
        });

        it('excludes a reconciled row, a young row, and a row that is not erased', async () => {
            await seed({ status: 'erased', updatedAt: longAgo, providerDeletedAt: longAgo, reconciledAt: longAgo });
            await seed({ status: 'erased', updatedAt: new Date('2026-09-01T00:00:00.000Z') });
            await seed({ status: 'active', updatedAt: longAgo });

            expect(await selectPendingErasures(db, cutoff)).toEqual([]);
        });
    });
});
