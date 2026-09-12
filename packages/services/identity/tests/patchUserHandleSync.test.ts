/**
 * W8-a.2 — unit test for the identity-side handle-sync producer: `patchUserMe` publishes a rename to the
 * handle-sync topic when (and only when) `displayName` changes, carrying the persisted `updatedAt` as the
 * `sourceTimestamp` (the single monotonic clock). A publish failure must NOT fail the rename.
 */
import { describe, it, expect, vi } from 'vitest';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { UsersService } from '../src/users/users.service.js';
import type { ResolveUserService } from '../src/users/resolveUser.js';
import type { SqsService } from '../src/queue/sqs.service.js';
import type { HandleSyncPublisher } from '../src/users/handleSync.publisher.js';
import type { AuthorizerContext } from '../src/types/jwt.js';

const USER_ID = '01JUSER0000000000000000AAA';

/** A chainable Drizzle fake serving a queued list of `.limit()` results in order, and swallowing updates. */
function fakeDb(limitResults: unknown[][]): NodePgDatabase {
    let call = 0;
    const selectChain = {
        from: () => selectChain,
        where: () => selectChain,
        limit: () => Promise.resolve(limitResults[call++] ?? []),
    };
    const updateChain = { set: () => ({ where: () => Promise.resolve(undefined) }) };

    return { select: () => selectChain, update: () => updateChain } as unknown as NodePgDatabase;
}

function makeService(db: NodePgDatabase, publisher: HandleSyncPublisher): UsersService {
    return new UsersService(
        db,
        {} as unknown as SqsService,
        {} as unknown as ResolveUserService,
        publisher,
        {} as never,
    );
}

const CTX = { userId: USER_ID } as unknown as AuthorizerContext;

describe('patchUserMe handle-sync publish (W8-a.2)', () => {
    it('publishes the new displayName + persisted updatedAt as sourceTimestamp on a rename', async () => {
        const publish = vi.fn().mockResolvedValue(undefined);
        // Reads: [existing user], [updated profile], [updated account].
        const db = fakeDb([
            [{ id: USER_ID, email: 'a@b.com', status: 'active', createdAt: new Date() }],
            [{ displayName: 'Ada Lovelace', avatarUrl: null }],
            [{ id: 'acc-1', userId: USER_ID, subscriptionTier: 'free', createdAt: new Date(), updatedAt: new Date() }],
        ]);

        const result = await makeService(db, { publish }).patchUserMe(CTX, { displayName: 'Ada Lovelace' });

        expect(publish).toHaveBeenCalledTimes(1);
        const msg = publish.mock.calls[0]![0] as { userId: string; displayName: string; sourceTimestamp: string };
        expect(msg.userId).toBe(USER_ID);
        expect(msg.displayName).toBe('Ada Lovelace');
        // sourceTimestamp is the same updatedAt the response reports (the persisted clock, not a fresh Date).
        expect(msg.sourceTimestamp).toBe(result.user.updatedAt);
    });

    it('does NOT publish on an avatar-only update (no displayName change)', async () => {
        const publish = vi.fn().mockResolvedValue(undefined);
        const db = fakeDb([
            [{ id: USER_ID, email: 'a@b.com', status: 'active', createdAt: new Date() }],
            [{ displayName: 'Ada Lovelace', avatarUrl: 'https://x/y.png' }],
            [{ id: 'acc-1', userId: USER_ID, subscriptionTier: 'free', createdAt: new Date(), updatedAt: new Date() }],
        ]);

        await makeService(db, { publish }).patchUserMe(CTX, { avatarUrl: 'https://x/y.png' });

        expect(publish).not.toHaveBeenCalled();
    });

    it('A -> B -> A revert: publishes on BOTH transitions (no stale-baseline gate to skip the revert)', async () => {
        // S-I3 (identity-webhooks) found the `user.updated` webhook gating on a baseline (`users.name`)
        // it never wrote, freezing an A->B->A rename at B. `patchUserMe` writes `profiles` unconditionally
        // from the request body — never gated on a stale baseline — so it does NOT share that bug. This
        // proves the revert transition also publishes, closing decision 6's "both routes correct" ask.
        const publish = vi.fn().mockResolvedValue(undefined);
        const db = fakeDb([
            // First call: A -> B.
            [{ id: USER_ID, email: 'a@b.com', status: 'active', createdAt: new Date() }],
            [{ displayName: 'New Name', avatarUrl: null }],
            [{ id: 'acc-1', userId: USER_ID, subscriptionTier: 'free', createdAt: new Date(), updatedAt: new Date() }],
            // Second call: B -> A (revert).
            [{ id: USER_ID, email: 'a@b.com', status: 'active', createdAt: new Date() }],
            [{ displayName: 'Original Name', avatarUrl: null }],
            [{ id: 'acc-1', userId: USER_ID, subscriptionTier: 'free', createdAt: new Date(), updatedAt: new Date() }],
        ]);
        const service = makeService(db, { publish });

        await service.patchUserMe(CTX, { displayName: 'New Name' });
        await service.patchUserMe(CTX, { displayName: 'Original Name' });

        expect(publish).toHaveBeenCalledTimes(2);
        expect((publish.mock.calls[0]![0] as { displayName: string }).displayName).toBe('New Name');
        // The revert (second call) MUST also publish — this is the transition the webhook's stale-baseline
        // gate bug would have silently dropped had `patchUserMe` shared that gate.
        expect((publish.mock.calls[1]![0] as { displayName: string }).displayName).toBe('Original Name');
    });

    it('swallows a publish failure — the rename still succeeds', async () => {
        const publish = vi.fn().mockRejectedValue(new Error('sns down'));
        const db = fakeDb([
            [{ id: USER_ID, email: 'a@b.com', status: 'active', createdAt: new Date() }],
            [{ displayName: 'New Name', avatarUrl: null }],
            [{ id: 'acc-1', userId: USER_ID, subscriptionTier: 'free', createdAt: new Date(), updatedAt: new Date() }],
        ]);

        const result = await makeService(db, { publish }).patchUserMe(CTX, { displayName: 'New Name' });

        expect(result.user.displayName).toBe('New Name'); // rename succeeded despite the publish throw
    });
});
