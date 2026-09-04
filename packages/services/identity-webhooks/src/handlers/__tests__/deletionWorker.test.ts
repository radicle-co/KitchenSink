/**
 * Deletion-worker unit tests (CR-002 / U4b). The worker routes deletion-queue records:
 *  - `closure`/`reactivation` → Clerk ban/unban (this Lambda holds the secret);
 *  - `erasure` (tombstone-sweep) → fan out recipe (first, R9) + food (R11);
 *  - no `event` (the `user.deleted` webhook, KTD-2) → full erasure: erase the identity to `{id}`
 *    (R10-covering `status='erased'`), then fan out. Idempotent throughout; a failed leg forces an SQS
 *    retry rather than a silent half-erasure (R7).
 */
import type { Context, SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFindByIdentityId, mockEraseIdentityRow, mockRunErasureFanout } = vi.hoisted(() => ({
    mockFindByIdentityId: vi.fn(),
    mockEraseIdentityRow: vi.fn(),
    mockRunErasureFanout: vi.fn(),
}));

vi.mock('../../common/db.js', () => ({ getDb: vi.fn() }));

// ONE mock for the whole package: it now supplies both the DAO this handler constructs and the shared
// erasure transaction it calls (`eraseIdentityRow` moved here from this service's `common/` so the identity
// service could reuse it — plan U2). Two separate `vi.mock` calls for one module would silently keep only
// the last, dropping whichever double the earlier one declared.
vi.mock('@kitchensink/identity-db', () => {
    const UserDAO = vi.fn().mockImplementation(function () {
        return { findByIdentityId: mockFindByIdentityId };
    });

    return { UserDAO, eraseIdentityRow: mockEraseIdentityRow };
});

vi.mock('../../common/identityClient.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../common/identityClient.js')>()),
    banUser: vi.fn().mockResolvedValue(undefined),
    unbanUser: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    // `isAlreadyDeleted` is left REAL: it is a pure 404 predicate, and doubling it would let a test pass
    // while the actual convergence rule was wrong.
}));

vi.mock('../../common/erasureFanout.js', () => ({ runErasureFanout: mockRunErasureFanout }));

vi.mock('../../common/observability.js', () => ({
    emitMetric: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    withObservability: <T, R>(fn: (event: T, ctx: unknown) => Promise<R>) => fn,
}));

import { handler as rawHandler } from '../deletionWorker.js';
import { getDb } from '../../common/db.js';
import { banUser, deleteUser, unbanUser } from '../../common/identityClient.js';
import { resetConfigCacheForTests } from '../../config/env.js';

type TestHandler = (event: SQSEvent, ctx: Context) => Promise<void>;
const handler = rawHandler as unknown as TestHandler;

const mockGetDb = vi.mocked(getDb);
const mockBanUser = vi.mocked(banUser);
const mockUnbanUser = vi.mocked(unbanUser);
const mockDeleteUserFn = vi.mocked(deleteUser);

const bothLegsOk = {
    recipe: { service: 'recipe', ok: true, jobStatus: 'queued' },
    food: { service: 'food', ok: true, deletedRequesterRows: 1 },
};

const makeContext = (): Context => ({ awsRequestId: 'test-req-id' }) as unknown as Context;

const makeSqsEvent = (body: Record<string, unknown>): SQSEvent => ({
    Records: [
        {
            messageId: 'msg-1',
            receiptHandle: 'receipt-1',
            body: JSON.stringify(body),
            attributes: {
                ApproximateReceiveCount: '1',
                SentTimestamp: '1234567890',
                SenderId: 'sender-1',
                ApproximateFirstReceiveTimestamp: '1234567890',
            },
            messageAttributes: {},
            md5OfBody: 'abc123',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:us-east-1:123:deletion-queue',
            awsRegion: 'us-east-1',
        },
    ],
});

beforeEach(() => {
    vi.clearAllMocks();
    resetConfigCacheForTests();
    mockGetDb.mockResolvedValue({} as never);
    mockEraseIdentityRow.mockResolvedValue(undefined);
    mockRunErasureFanout.mockResolvedValue(bothLegsOk);
    process.env['DB_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
    process.env['AUTH_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:123:secret:auth';
    // Fan-out config (the fan-out itself is mocked, but getErasureFanoutConfig must resolve).
    process.env['SERVICE_ERASURE_SIGNING_KEY'] = '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----';
    process.env['RECIPE_SERVICE_BASE_URL'] = 'https://recipe.example.test';
    process.env['FOOD_SERVICE_BASE_URL'] = 'https://food.example.test';
});

describe('deletion-worker handler', () => {
    describe('lifecycle routing (event field)', () => {
        it('closure → BANS the Clerk identity, never erases or fans out', async () => {
            await handler(makeSqsEvent({ identityId: 'user_abc', userId: 'usr_01', event: 'closure' }), makeContext());

            expect(mockBanUser).toHaveBeenCalledWith('user_abc');
            expect(mockUnbanUser).not.toHaveBeenCalled();
            expect(mockRunErasureFanout).not.toHaveBeenCalled();
            expect(mockEraseIdentityRow).not.toHaveBeenCalled();
        });

        it('reactivation → UNBANS the Clerk identity', async () => {
            await handler(
                makeSqsEvent({ identityId: 'user_abc', userId: 'usr_01', event: 'reactivation' }),
                makeContext(),
            );

            expect(mockUnbanUser).toHaveBeenCalledWith('user_abc');
            expect(mockBanUser).not.toHaveBeenCalled();
            expect(mockRunErasureFanout).not.toHaveBeenCalled();
        });
    });

    /**
     * THE MOST DESTRUCTIVE DEFAULT IN THE SYSTEM, closed.
     *
     * `event` is typed `'closure' | 'reactivation' | 'erasure' | undefined`, and `undefined` legitimately means
     * the `user.deleted` webhook full-erasure path — so the `switch` `default` has to erase. But the message was
     * read with a CAST, and a cast cannot narrow a string at runtime. So every value that was not exactly one of
     * the three literals — a typo, a case difference, a renamed event, a producer/consumer version skew — fell
     * through `default` and performed a full GDPR erasure plus a cross-service fan-out.
     *
     * These cases red if `event` stops being a strict enum. They assert on the SINKS (no erase, no fan-out, no
     * Clerk call), not merely that it threw, because a throw AFTER the erasure would be no protection at all.
     */
    describe('an UNRECOGNISED event is rejected, never treated as a full erasure', () => {
        it.each([
            ['a typo', 'closre'],
            ['wrong case', 'Closure'],
            ['a renamed/unknown event', 'account.purge'],
            ['an empty string', ''],
            ['a non-string', 42],
        ])('refuses %s without erasing or fanning out', async (_label, event) => {
            await expect(
                handler(makeSqsEvent({ identityId: 'user_abc', userId: 'usr_01', event } as never), makeContext()),
            ).rejects.toThrow();

            expect(mockEraseIdentityRow).not.toHaveBeenCalled();
            expect(mockRunErasureFanout).not.toHaveBeenCalled();
            expect(mockBanUser).not.toHaveBeenCalled();
            expect(mockUnbanUser).not.toHaveBeenCalled();
        });

        it('refuses a message with no identityId at all', async () => {
            // `findByIdentityId('')` would match nothing and the handler would report a clean idempotent
            // no-op — a deletion that silently did not happen.
            await expect(handler(makeSqsEvent({ identityId: '' } as never), makeContext())).rejects.toThrow();

            expect(mockEraseIdentityRow).not.toHaveBeenCalled();
            expect(mockRunErasureFanout).not.toHaveBeenCalled();
        });

        it('STILL treats an ABSENT event as the user.deleted full-erasure path (behaviour preserved)', async () => {
            // The counterpart that keeps the fix honest: absent and unrecognised must NOT collapse into one
            // verdict. Absent is the legitimate webhook path and must keep erasing.
            mockFindByIdentityId.mockResolvedValue({ id: 'usr_01', identityId: 'user_abc', status: 'active' });

            await handler(makeSqsEvent({ identityId: 'user_abc' }), makeContext());

            expect(mockEraseIdentityRow).toHaveBeenCalledTimes(1);
        });
    });

    describe('erasure event — delete the Clerk account, then fan out (row already scrubbed by the enqueuer)', () => {
        it('fans out to recipe + food keyed by the app ULID, under the erasure actor', async () => {
            await handler(
                makeSqsEvent({
                    identityId: 'user_abc',
                    userId: 'usr_01',
                    event: 'erasure',
                    enqueuedAt: '2026-07-26T00:00:00Z',
                }),
                makeContext(),
            );

            expect(mockRunErasureFanout).toHaveBeenCalledTimes(1);
            const [target] = mockRunErasureFanout.mock.calls[0]!;
            expect(target).toMatchObject({
                userId: 'usr_01',
                eventId: '2026-07-26T00:00:00Z',
                // Enqueuer-neutral on purpose: this branch now serves BOTH the 12-month tombstone-sweep
                // and the user's own erasure request, so a label naming the sweep would be false for half
                // its traffic — and this actor is written into a downstream audit row (R8).
                actor: 'identity-erasure',
            });
            // The sweep already scrubbed the identity row, and the worker must NOT re-do that (a second
            // scrub would append a second R8 audit row for one erasure). A BAN is never right on this
            // path either — the account is being destroyed, not suspended.
            expect(mockEraseIdentityRow).not.toHaveBeenCalled();
            expect(mockBanUser).not.toHaveBeenCalled();
        });

        /**
         * ⛔ The Clerk delete MUST happen on this branch, and it did not used to.
         *
         * The branch was written for exactly one enqueuer — the tombstone-sweep, which deletes the Clerk
         * user itself before enqueuing — so it assumed the account was already gone. Plan U2 adds a second
         * enqueuer: the identity service, acting on the user's own "erase my data" request. That service
         * sits behind a public ALB and holds no Clerk secret **by design**, so it cannot delete the account;
         * if this branch does not, nothing does, and the user keeps signing in to an account they were told
         * was destroyed.
         *
         * Doing it here makes the branch self-sufficient rather than dependent on which enqueuer sent the
         * message — and costs the sweep nothing, because deleting an already-deleted Clerk user is a 404
         * this tolerates.
         */
        it('DELETES the Clerk identity, so a user-initiated erasure actually destroys the account', async () => {
            await handler(makeSqsEvent({ identityId: 'user_abc', userId: 'usr_01', event: 'erasure' }), makeContext());

            expect(mockDeleteUserFn).toHaveBeenCalledWith('user_abc');
            expect(mockRunErasureFanout).toHaveBeenCalledTimes(1);
        });

        it('tolerates an already-deleted Clerk identity (404) and still fans out', async () => {
            // The tombstone-sweep path: Clerk was deleted before this message was enqueued. A 404 is
            // convergence, not failure — treating it as an error would strand every swept erasure.
            mockDeleteUserFn.mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }));

            await handler(makeSqsEvent({ identityId: 'user_abc', userId: 'usr_01', event: 'erasure' }), makeContext());

            expect(mockRunErasureFanout).toHaveBeenCalledTimes(1);
        });

        it('THROWS on any other Clerk failure and does NOT fan out — Clerk first, or not at all', async () => {
            // Ordering is the point: fanning out first would destroy the user's recipes and food rows while
            // their account still exists and still signs in — the worst possible partial state, and one no
            // retry can undo. SQS redelivers instead; every leg is idempotent.
            mockDeleteUserFn.mockRejectedValueOnce(Object.assign(new Error('clerk 503'), { status: 503 }));

            await expect(
                handler(makeSqsEvent({ identityId: 'user_abc', userId: 'usr_01', event: 'erasure' }), makeContext()),
            ).rejects.toThrow(/clerk/i);

            expect(mockRunErasureFanout).not.toHaveBeenCalled();
        });

        it('a failed leg THROWS so SQS redelivers (R7 — no silent half-erasure)', async () => {
            mockRunErasureFanout.mockResolvedValue({
                recipe: { service: 'recipe', ok: false, httpStatus: 503, detail: 'down' },
                food: { service: 'food', ok: true, deletedRequesterRows: 0 },
            });

            await expect(
                handler(makeSqsEvent({ identityId: 'user_abc', userId: 'usr_01', event: 'erasure' }), makeContext()),
            ).rejects.toThrow(/incomplete/i);
        });

        /**
         * REWRITTEN (was "missing userId → cannot fan out, logs and no-ops"). That test pinned an
         * acknowledge-and-skip: the branch `return`ed, Lambda's SQS source deleted the message, and the
         * recipe/food fan-out for that user was skipped permanently with only a `warn` to show for it —
         * the opposite of `deletionQueue.schema.ts`'s own disposition for an invalid message. Every producer
         * sets `userId` on an erasure, so its absence is our bug and must REJECT: throw, so SQS retries and
         * then DLQs to the alarm. The sinks are asserted, not just the throw: no Clerk delete either, because
         * destroying the account and then dropping the message would strand the user's data half-erased.
         */
        it.each([
            ['absent', {}],
            ['empty', { userId: '' }],
        ])(
            'an erasure with a %s userId is REJECTED (throws → retry → DLQ), never acknowledged',
            async (_label, userIdField) => {
                await expect(
                    handler(makeSqsEvent({ identityId: 'user_abc', event: 'erasure', ...userIdField }), makeContext()),
                ).rejects.toThrow();

                expect(mockRunErasureFanout).not.toHaveBeenCalled();
                expect(mockDeleteUserFn).not.toHaveBeenCalled();
                expect(mockEraseIdentityRow).not.toHaveBeenCalled();
            },
        );

        it('a missing fan-out env var fails LOUD (getErasureFanoutConfig throws → SQS retry)', async () => {
            delete process.env['SERVICE_ERASURE_SIGNING_KEY'];
            resetConfigCacheForTests();

            await expect(
                handler(makeSqsEvent({ identityId: 'user_abc', userId: 'usr_01', event: 'erasure' }), makeContext()),
            ).rejects.toThrow();
            expect(mockRunErasureFanout).not.toHaveBeenCalled();
        });
    });

    describe('user.deleted webhook (no event) — KTD-2 full erasure', () => {
        it('existing active user → identity erased (status=erased, R10) then fanned out', async () => {
            mockFindByIdentityId.mockResolvedValue({ id: 'usr_01', identityId: 'user_abc', status: 'active' });

            await handler(makeSqsEvent({ identityId: 'user_abc' }), makeContext());

            expect(mockEraseIdentityRow).toHaveBeenCalledTimes(1);
            const [, eraseInput] = mockEraseIdentityRow.mock.calls[0]!;
            expect(eraseInput).toMatchObject({
                userId: 'usr_01',
                triggerSource: 'admin',
                actor: 'clerk-user-deleted-webhook',
            });
            expect(mockRunErasureFanout).toHaveBeenCalledTimes(1);
            expect(mockRunErasureFanout.mock.calls[0]![0]).toMatchObject({ userId: 'usr_01' });
        });

        it('echo for an ALREADY-erased user → no second scrub/audit, but STILL fans out idempotently (R9)', async () => {
            mockFindByIdentityId.mockResolvedValue({ id: 'usr_01', identityId: 'user_abc', status: 'erased' });

            await handler(makeSqsEvent({ identityId: 'user_abc' }), makeContext());

            expect(mockEraseIdentityRow).not.toHaveBeenCalled();
            expect(mockRunErasureFanout).toHaveBeenCalledTimes(1);
        });

        it('unknown identity → no erase, no fan-out, no throw (idempotent)', async () => {
            mockFindByIdentityId.mockResolvedValue(undefined);

            await expect(handler(makeSqsEvent({ identityId: 'user_nope' }), makeContext())).resolves.toBeUndefined();

            expect(mockEraseIdentityRow).not.toHaveBeenCalled();
            expect(mockRunErasureFanout).not.toHaveBeenCalled();
        });
    });

    describe('config guards', () => {
        it('missing DB_SECRET_ARN → fails fast before touching the DB', async () => {
            delete process.env['DB_SECRET_ARN'];

            await expect(handler(makeSqsEvent({ identityId: 'user_abc' }), makeContext())).rejects.toThrow();
            expect(mockGetDb).not.toHaveBeenCalled();
        });

        it('missing both IDP_SECRET_KEY and AUTH_SECRET_ARN → fails fast on the typed config', async () => {
            delete process.env['AUTH_SECRET_ARN'];

            await expect(handler(makeSqsEvent({ identityId: 'user_abc' }), makeContext())).rejects.toThrow();
            expect(mockGetDb).not.toHaveBeenCalled();
        });
    });
});
