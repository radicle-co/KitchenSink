/**
 * W8-a.2 / plan 2026-10-15-010 D6 — unit test for the identity-side handle-sync producer: `patchUserMe` publishes the
 * BYLINE SNAPSHOT when (and only when) `displayName` changes. The snapshot is the row the UPDATE returned — the new
 * display name, the Clerk username the row already holds — keyed by the stamp that same statement wrote
 * (`profileClock`), never a process clock. A publish failure must NOT fail the rename.
 *
 * Rewritten for the snapshot: it used to assert the process-clock `now` was the source timestamp, which is the very
 * shape that loses an update under a concurrent webhook (see `tests/e2e/bylineSnapshot.e2e.test.ts`, which proves the
 * ordering against a real database).
 */
import { is, SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { describe, it, expect, vi } from 'vitest';

import { UsersService } from '../src/users/users.service.js';
import type { ResolveUserService } from '../src/users/resolveUser.js';
import type { SqsService } from '../src/queue/sqs.service.js';
import type { HandleSyncPublisher } from '../src/users/handleSync.publisher.js';
import type { AuthorizerContext } from '../src/types/jwt.js';

const USER_ID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
/** The stamp the database returned — deliberately far from "now", so a process clock cannot match it by accident. */
const STAMPED = new Date('2026-01-02T03:04:05.678Z');

/** The profile row the UPDATE … RETURNING hands back. */
function returnedProfile(overrides: Record<string, unknown> = {}) {
    return { displayName: 'Ada Lovelace', avatarUrl: null, username: 'ada', updatedAt: STAMPED, ...overrides };
}

/**
 * A chainable Drizzle fake: `select … limit` serves `reads` in order; `update … set … where` either resolves (the
 * settle) or serves `.returning()` from `returning` in order. Every `set` argument is captured.
 */
function fakeDb(reads: unknown[][], returning: unknown[][]) {
    let read = 0;
    let returned = 0;
    const sets: Record<string, unknown>[] = [];
    const selectChain = {
        from: () => selectChain,
        where: () => selectChain,
        limit: () => Promise.resolve(reads[read++] ?? []),
    };
    const update = () => ({
        set: (values: Record<string, unknown>) => {
            sets.push(values);

            const where = Promise.resolve(undefined) as Promise<undefined> & { returning: () => Promise<unknown[]> };
            where.returning = () => Promise.resolve(returning[returned++] ?? []);

            return { where: () => where };
        },
    });

    return { db: { select: () => selectChain, update } as unknown as NodePgDatabase, sets };
}

function makeService(db: NodePgDatabase, publisher: HandleSyncPublisher): UsersService {
    return new UsersService(
        db,
        {} as unknown as SqsService,
        {} as unknown as ResolveUserService,
        publisher,
        {} as never,
        false,
    );
}

const CTX = { userId: USER_ID, roles: [] } as unknown as AuthorizerContext;
const EXISTING = [{ id: USER_ID, email: 'a@b.com', status: 'active', createdAt: new Date(), updatedAt: new Date() }];
const ACCOUNT = [{ id: 'acc-1', userId: USER_ID, createdAt: new Date(), updatedAt: new Date() }];

describe('patchUserMe handle-sync publish', () => {
    it('publishes the snapshot the UPDATE returned, keyed by the database’s stamp', async () => {
        const publish = vi.fn().mockResolvedValue(undefined);
        const { db } = fakeDb([EXISTING, ACCOUNT], [[returnedProfile()]]);

        const result = await makeService(db, { publish }).patchUserMe(CTX, { displayName: 'Ada Lovelace' });

        expect(publish).toHaveBeenCalledWith({
            userId: USER_ID,
            displayName: 'Ada Lovelace',
            // Not in the request: the Clerk username the row already holds rides along in every snapshot.
            username: 'ada',
            sourceTimestamp: STAMPED.toISOString(),
        });
        expect(result.user.updatedAt).toBe(STAMPED.toISOString());
    });

    it('stamps updated_at AND the owed marker with the database clock, never a process Date', async () => {
        const { db, sets } = fakeDb([EXISTING, ACCOUNT], [[returnedProfile()]]);

        await makeService(db, { publish: vi.fn().mockResolvedValue(undefined) }).patchUserMe(CTX, {
            displayName: 'Ada',
        });

        const [write] = sets;
        expect(is(write?.['updatedAt'], SQL)).toBe(true);
        expect(is(write?.['handleSyncOwedAt'], SQL)).toBe(true);
        expect(write?.['handleSyncFailureCode']).toBeNull();
    });

    it('stores the display name trimmed', async () => {
        const { db, sets } = fakeDb([EXISTING, ACCOUNT], [[returnedProfile()]]);

        await makeService(db, { publish: vi.fn().mockResolvedValue(undefined) }).patchUserMe(CTX, {
            displayName: '  Ada Lovelace  ',
        });

        expect(sets[0]?.['displayName']).toBe('Ada Lovelace');
    });

    it('does NOT publish, and owes nothing, on an avatar-only update', async () => {
        const publish = vi.fn().mockResolvedValue(undefined);
        const { db, sets } = fakeDb([EXISTING, ACCOUNT], [[returnedProfile({ avatarUrl: 'https://x/y.png' })]]);

        await makeService(db, { publish }).patchUserMe(CTX, { avatarUrl: 'https://x/y.png' });

        expect(publish).not.toHaveBeenCalled();
        expect(sets[0]).not.toHaveProperty('handleSyncOwedAt');
    });

    it('A -> B -> A revert: publishes on BOTH transitions (no stale-baseline gate to skip the revert)', async () => {
        const publish = vi.fn().mockResolvedValue(undefined);
        const { db } = fakeDb(
            [EXISTING, ACCOUNT, EXISTING, ACCOUNT],
            [[returnedProfile({ displayName: 'New Name' })], [returnedProfile({ displayName: 'Original Name' })]],
        );
        const service = makeService(db, { publish });

        await service.patchUserMe(CTX, { displayName: 'New Name' });
        await service.patchUserMe(CTX, { displayName: 'Original Name' });

        expect(publish.mock.calls.map(([message]) => (message as { displayName: string }).displayName)).toEqual([
            'New Name',
            'Original Name',
        ]);
    });

    it('swallows a publish failure — the rename still succeeds', async () => {
        const { db } = fakeDb([EXISTING, ACCOUNT], [[returnedProfile({ displayName: 'New Name' })]]);

        const result = await makeService(db, { publish: vi.fn().mockRejectedValue(new Error('sns down')) }).patchUserMe(
            CTX,
            { displayName: 'New Name' },
        );

        expect(result.user.displayName).toBe('New Name');
    });
});
