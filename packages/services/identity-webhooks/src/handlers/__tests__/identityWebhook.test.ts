import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handleSyncPublish } = vi.hoisted(() => ({ handleSyncPublish: vi.fn() }));
vi.mock('@kitchensink/identity-service/users/handle-sync-publisher', () => ({
    createSnsHandleSyncPublisher: vi.fn(),
    // No HANDLE_SYNC_TOPIC_ARN in tests → the handler uses the no-op; its publish is the spy we assert.
    noopHandleSyncPublisher: { publish: handleSyncPublish },
}));

vi.mock('../../common/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../common/svix.js', () => ({ verifyWebhook: vi.fn() }));
vi.mock('../../common/identityClient.js', () => ({ setExternalId: vi.fn() }));
vi.mock('../../common/provisioning.js', () => ({ buildProvisionDeps: vi.fn(() => ({})) }));
vi.mock('@kitchensink/identity-utils', () => ({ provisionCompleteUser: vi.fn() }));

vi.mock('@kitchensink/identity-db', () => ({
    UserDAO: vi.fn().mockImplementation(function () {
        return {
            upsertByIdentityId: vi.fn(),
            findByIdentityId: vi.fn(),
            updateProfile: vi.fn(),
            syncNameAndPicture: vi.fn().mockResolvedValue({ displayNameChanged: false }),
        };
    }),
    recordOnce: vi.fn().mockResolvedValue(undefined),
    hasProcessedWebhookEvent: vi.fn().mockResolvedValue(false),
    // `users` is only ever forwarded to the (also-mocked) `db.update`/`.select` calls as an opaque
    // table-identity argument here — never queried for real — so a stub object is sufficient.
    users: { id: 'users-table-stub' },
}));
vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(function SQSClient() {
        return { send: vi.fn().mockResolvedValue({}) };
    }),
    SendMessageCommand: vi.fn(function SendMessageCommand(input: unknown) {
        return { input };
    }),
}));
vi.mock('../../common/observability.js', () => ({
    emitMetric: vi.fn(),
    captureProvisioningFailure: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    withObservability: <T, R>(fn: (event: T, ctx: unknown) => Promise<R>) => fn,
}));

import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { UserDAO, recordOnce, hasProcessedWebhookEvent } from '@kitchensink/identity-db';

import { handler as rawHandler } from '../identityWebhook.js';
import { getDb } from '../../common/db.js';
import { setExternalId } from '../../common/identityClient.js';
import { provisionCompleteUser } from '@kitchensink/identity-utils';
import { captureProvisioningFailure, emitMetric, logger } from '../../common/observability.js';
import { verifyWebhook } from '../../common/svix.js';
import { resetConfigCacheForTests } from '../../config/env.js';

type TestHandler = (event: APIGatewayProxyEvent, ctx: Context) => Promise<APIGatewayProxyResult>;
const handler = rawHandler as unknown as TestHandler;

const mockGetDb = vi.mocked(getDb);
const mockVerifyWebhook = vi.mocked(verifyWebhook);
const mockRecordOnce = vi.mocked(recordOnce);
const mockHasProcessed = vi.mocked(hasProcessedWebhookEvent);
const mockSetExternalId = vi.mocked(setExternalId);
const mockProvisionCompleteUser = vi.mocked(provisionCompleteUser);

const makeContext = (): Context => ({ awsRequestId: 'test-req-id' }) as unknown as Context;

const makeEvent = (body: string, headers: Record<string, string> = {}): APIGatewayProxyEvent =>
    ({
        body,
        headers,
        requestContext: { requestId: 'test-req-id' },
    }) as unknown as APIGatewayProxyEvent;

const userCreatedPayload = {
    type: 'user.created' as const,
    data: {
        id: 'user_abc123',
        email_addresses: [{ id: 'email_1', email_address: 'test@example.com' }],
        first_name: 'John',
        last_name: 'Doe',
        image_url: 'https://example.com/avatar.png',
    },
    object: 'event' as const,
};

const userUpdatedPayload = {
    type: 'user.updated' as const,
    data: {
        id: 'user_abc123',
        email_addresses: [{ id: 'email_1', email_address: 'updated@example.com' }],
        first_name: 'Jane',
        last_name: 'Doe',
        image_url: 'https://example.com/new-avatar.png',
    },
    object: 'event' as const,
};

const userDeletedPayload = {
    type: 'user.deleted' as const,
    data: { id: 'user_abc123' },
    object: 'event' as const,
};

/** Builds a `user.updated` payload for `user_abc123` carrying the given first/last name. */
const makeUserUpdatedPayload = (firstName: string, lastName: string) => ({
    type: 'user.updated' as const,
    data: {
        id: 'user_abc123',
        email_addresses: [{ id: 'email_1', email_address: 'test@example.com' }],
        first_name: firstName,
        last_name: lastName,
        image_url: 'https://example.com/avatar.png',
    },
    object: 'event' as const,
});

/**
 * A stateful `UserDAO` double whose `syncNameAndPicture` mirrors the REAL DAO's gate-on-`users`-mirror
 * behavior (S-I3, corrected): the gate compares the incoming Clerk name/picture against `users.name`/
 * `picture` (the Clerk MIRROR, tracked here as `mirror`) — NOT `profiles.displayName`/`avatarUrl` (the
 * EFFECTIVE, possibly self-service-overridden display, tracked here as `profile`). A field is written
 * to `profile` ONLY when that specific field's incoming value differs from `mirror`, so a self-service
 * override on a field Clerk did NOT touch this event survives. This lets handler-level tests drive the
 * exact A->B->A, self-service-preservation, and genuine-Clerk-change sequences and assert the
 * handler's publish-gating wiring reacts correctly, without needing a real database.
 */
const makeStatefulUserDao = (initial: {
    mirrorName: string;
    mirrorPicture: string | null;
    profileDisplayName?: string;
    profileAvatarUrl?: string | null;
}) => {
    let mirror = { name: initial.mirrorName, picture: initial.mirrorPicture };
    let profile = {
        displayName: initial.profileDisplayName ?? initial.mirrorName,
        avatarUrl: initial.profileAvatarUrl !== undefined ? initial.profileAvatarUrl : initial.mirrorPicture,
    };
    const existing = {
        id: 'usr_ulid',
        identityId: 'user_abc123',
        email: 'test@example.com',
        name: mirror.name,
        picture: mirror.picture,
    };

    return {
        upsertByIdentityId: vi.fn(),
        updateProfile: vi.fn(),
        findByIdentityId: vi.fn().mockResolvedValue(existing),
        syncNameAndPicture: vi.fn(
            async (_userId: string, data: { name: string; picture: string | null; now: Date }) => {
                const nameChanged = data.name !== mirror.name;
                const pictureChanged = data.picture !== mirror.picture;

                if (!nameChanged && !pictureChanged) {
                    return { displayNameChanged: false };
                }

                mirror = { name: data.name, picture: data.picture };
                profile = {
                    displayName: nameChanged ? data.name : profile.displayName,
                    avatarUrl: pictureChanged ? data.picture : profile.avatarUrl,
                };

                return { displayNameChanged: nameChanged };
            },
        ),
        getStoredDisplayName: () => profile.displayName,
    };
};

const buildMockDb = () => {
    const returningUser = vi.fn().mockResolvedValue([{ id: 'usr_ulid' }]);
    const whereUser = vi.fn().mockReturnValue({ returning: returningUser });
    const setUser = vi.fn().mockReturnValue({ where: whereUser });
    const updateUser = vi.fn().mockReturnValue({ set: setUser });

    const returningProfile = vi.fn().mockResolvedValue([{ id: 'prof_1' }]);
    const onConflictDoUpdateProfile = vi.fn().mockReturnValue({ returning: returningProfile });
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const valuesProfile = vi.fn().mockReturnValue({
        returning: returningProfile,
        onConflictDoUpdate: onConflictDoUpdateProfile,
        onConflictDoNothing,
    });
    const insertProfile = vi.fn().mockReturnValue({ values: valuesProfile });

    const db = {
        insert: vi.fn((table: unknown) => insertProfile(table)),
        update: vi.fn((table: unknown) => updateUser(table)),
    } as never;

    return {
        db,
        returningUser,
        whereUser,
        setUser,
        updateUser,
        returningProfile,
        valuesProfile,
        insertProfile,
        onConflictDoUpdateProfile,
    };
};

beforeEach(() => {
    vi.clearAllMocks();
    resetConfigCacheForTests();
    // clearAllMocks resets call history but NOT implementations, so re-assert the per-test defaults
    // to prevent a `hasProcessed → true` set in one test from leaking into the next.
    mockHasProcessed.mockResolvedValue(false);
    mockRecordOnce.mockResolvedValue(undefined);
    mockSetExternalId.mockResolvedValue(undefined as never);
    mockProvisionCompleteUser.mockResolvedValue({ kind: 'complete', user: { id: 'usr_ulid' } } as never);
    process.env['DB_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
    process.env['DELETION_QUEUE_URL'] = 'https://sqs.us-east-1.amazonaws.com/123/deletion-queue';
    process.env['IDP_WEBHOOK_SECRET'] = 'whsec_test';
    // The real webhook Lambda's env always carries at least one Clerk backend secret (IDP_SECRET_KEY
    // via clerkBackendEnv, AUTH_SECRET_ARN via commonEnv) — the schema's either-or refine reflects that.
    process.env['AUTH_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:123:secret:auth';
});

describe('identity-webhook handler', () => {
    it('already-processed svix-id dedups to 200 without processing or re-recording', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userCreatedPayload as never);
        mockHasProcessed.mockResolvedValue(true);

        const result = await handler(
            makeEvent(JSON.stringify(userCreatedPayload), { 'svix-id': 'msg_123' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        expect(mockHasProcessed).toHaveBeenCalledWith(db, 'msg_123');
        // Confirm-after-process: a duplicate neither re-processes nor re-records.
        expect(mockSetExternalId).not.toHaveBeenCalled();
        expect(mockRecordOnce).not.toHaveBeenCalled();
    });

    it('user.created -> provisions the complete user via the shared routine, sets external id, syncs timestamp', async () => {
        const { db, setUser } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userCreatedPayload as never);
        mockProvisionCompleteUser.mockResolvedValue({
            kind: 'complete',
            user: { id: 'usr_ulid', identityId: 'user_abc123', email: 'test@example.com' },
        } as never);

        const result = await handler(
            makeEvent(JSON.stringify(userCreatedPayload), { 'svix-id': 'msg_123' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        expect(mockRecordOnce).toHaveBeenCalledWith(db, 'msg_123', 'user_abc123', 'user.created');
        // One routine call owns user + account + profile; the webhook uses the signal-incomplete policy.
        expect(mockProvisionCompleteUser).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                identityId: 'user_abc123',
                email: 'test@example.com',
                name: 'John Doe',
                displayName: 'John Doe',
                avatarUrl: 'https://example.com/avatar.png',
            }),
            { onEmailCollision: 'signal-incomplete', emailIsReal: true },
        );
        // External id backfill runs AFTER the complete local unit, and stamps the sync marker on success.
        expect(mockSetExternalId).toHaveBeenCalledWith('user_abc123', 'usr_ulid');
        expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ externalIdSyncedAt: expect.any(Date) }));
    });

    // ⛔ THE COST GUARD, AT ONE REAL CALL SITE. `emitMetric` publishes
    // `Dimensions: [['service','metric',...Object.keys(dimensions)]]`, so every key passed becomes a CloudWatch
    // dimension and every distinct VALUE becomes a separately billed custom metric (~$0.30/mo, 15-month
    // retention). `{ identityId: data.id }` therefore bought one metric PER USER — ~$3,000/mo at 10k users —
    // holding a single datapoint each. This asserts BOTH halves of the fix on the same invocation: the metric
    // carries no per-user dimension, AND the identifier is still emitted, as a structured log attribute (where
    // `sentry-scrubbers.ts` pseudonymizes it; the EMF line goes to raw stdout and passes no scrubber).
    // `src/common/__tests__/emf-dimension-cardinality.test.ts` is the tree-wide version of the same rule.
    it('user.created -> counts the event with NO per-user dimension, and keeps the id on the log line', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userCreatedPayload as never);
        mockProvisionCompleteUser.mockResolvedValue({
            kind: 'complete',
            user: { id: 'usr_ulid', identityId: 'user_abc123', email: 'test@example.com' },
        } as never);

        await handler(makeEvent(JSON.stringify(userCreatedPayload), { 'svix-id': 'msg_123' }), makeContext());

        // The counter still fires, and still under exactly one dimension set — the emitter's own
        // `service`/`metric` literals, which is what the `kitchensink-*` alarms select (W4).
        expect(vi.mocked(emitMetric)).toHaveBeenCalledWith('UserCreatedWebhook', 1);

        const dimensionArguments = vi
            .mocked(emitMetric)
            .mock.calls.filter(([name]) => name === 'UserCreatedWebhook')
            .map(([, , dimensions]) => dimensions);

        expect(dimensionArguments).toEqual([undefined]);

        // …and nothing was lost: the id is still there, on the structured log line.
        expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
            'identity-webhook: user.created processed',
            expect.objectContaining({ identityId: 'user_abc123', userId: 'usr_ulid' }),
        );
    });

    it('user.created with an email owned by another active identity -> skips (no 502), still 200', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userCreatedPayload as never);
        // The routine signals incomplete on a cross-identity email collision; the read-through provisions
        // this user (with its placeholder fallback) on first login, so the webhook must NOT retry-storm.
        mockProvisionCompleteUser.mockResolvedValue({ kind: 'incomplete', reason: 'email-collision' } as never);

        const result = await handler(
            makeEvent(JSON.stringify(userCreatedPayload), { 'svix-id': 'msg_123' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        expect(mockSetExternalId).not.toHaveBeenCalled();
        expect(mockRecordOnce).toHaveBeenCalled(); // processed (a duplicate redelivery dedups, not retries)
        // R5 taxonomy: the EXPECTED email-collision fallback must NOT page.
        expect(vi.mocked(captureProvisioningFailure)).not.toHaveBeenCalled();
    });

    it('user.created completes account+profile even when setExternalId throws (does not abort, still 200)', async () => {
        const { db, setUser } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userCreatedPayload as never);
        // The bug class this guards: a non-critical external Clerk call must not block the local user
        // unit. setExternalId throwing used to abort the handler AFTER the user row, leaving no account.
        mockSetExternalId.mockRejectedValue(new Error('Clerk 503'));

        const result = await handler(
            makeEvent(JSON.stringify(userCreatedPayload), { 'svix-id': 'msg_123' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        // The complete user unit is provisioned by the routine before the external call, so it lands.
        expect(mockProvisionCompleteUser).toHaveBeenCalled();
        // The webhook is recorded as processed (no retry storm) and the synced timestamp is NOT stamped,
        // so reconciliation knows external_id still needs backfilling.
        expect(mockRecordOnce).toHaveBeenCalled();
        expect(setUser).not.toHaveBeenCalledWith(expect.objectContaining({ externalIdSyncedAt: expect.any(Date) }));
    });

    it('user.updated with email and name change -> updates users.email directly, syncs name/picture via the DAO, and publishes', async () => {
        const { db, setUser, whereUser } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userUpdatedPayload as never);

        const daoInstance = {
            upsertByIdentityId: vi.fn(),
            findByIdentityId: vi.fn().mockResolvedValue({
                id: 'usr_ulid',
                identityId: 'user_abc123',
                email: 'test@example.com',
                name: 'John Doe',
                picture: 'https://example.com/avatar.png',
            }),
            updateProfile: vi.fn(),
            syncNameAndPicture: vi.fn().mockResolvedValue({ displayNameChanged: true }),
        };
        vi.mocked(UserDAO).mockImplementation(function () {
            return daoInstance;
        });

        const result = await handler(
            makeEvent(JSON.stringify(userUpdatedPayload), { 'svix-id': 'msg_456' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        // The email path is unchanged: a direct `users` write, untouched by the coherent-sync DAO method.
        expect(setUser).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'updated@example.com', updatedAt: expect.any(Date) }),
        );
        expect(whereUser).toHaveBeenCalledWith(expect.anything());
        // S-I3: name/picture sync goes through the coherent DAO method (one transaction, both tables),
        // not a raw `db.update(profiles)` gated on the stale `users.name` baseline.
        expect(daoInstance.syncNameAndPicture).toHaveBeenCalledWith(
            'usr_ulid',
            expect.objectContaining({ name: 'Jane Doe', picture: 'https://example.com/new-avatar.png' }),
        );
        // W8-a.2: the DAO reported a real displayName change, so the webhook publishes a handle-sync
        // rename carrying the app-user ULID (not the Clerk id) + the new name.
        expect(handleSyncPublish).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'usr_ulid', displayName: 'Jane Doe' }),
        );
    });

    it('user.updated A -> B -> A: the revert is NOT silently dropped — both transitions write + publish', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);

        // The store starts holding "Original Name" — mirrors profiles.displayName / users.name both
        // already at "A" before either webhook delivery below.
        const daoInstance = makeStatefulUserDao({
            mirrorName: 'Original Name',
            mirrorPicture: 'https://example.com/avatar.png',
        });
        vi.mocked(UserDAO).mockImplementation(function () {
            return daoInstance;
        });

        // A -> B: rename to "New Name".
        mockVerifyWebhook.mockReturnValue(makeUserUpdatedPayload('New', 'Name') as never);
        const first = await handler(
            makeEvent(JSON.stringify(makeUserUpdatedPayload('New', 'Name')), { 'svix-id': 'msg_a_to_b' }),
            makeContext(),
        );

        expect(first.statusCode).toBe(200);
        expect(daoInstance.getStoredDisplayName()).toBe('New Name');
        expect(handleSyncPublish).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'usr_ulid', displayName: 'New Name' }),
        );

        handleSyncPublish.mockClear();

        // B -> A: revert back to "Original Name". Against the ORIGINAL (pre-fix) handler this is
        // silently skipped — it gated on `users.name`, which the webhook path never wrote, so the
        // stale baseline never moved off "Original Name" and the revert looked like a no-op.
        mockVerifyWebhook.mockReturnValue(makeUserUpdatedPayload('Original', 'Name') as never);
        const second = await handler(
            makeEvent(JSON.stringify(makeUserUpdatedPayload('Original', 'Name')), { 'svix-id': 'msg_b_to_a' }),
            makeContext(),
        );

        expect(second.statusCode).toBe(200);
        expect(daoInstance.getStoredDisplayName()).toBe('Original Name');
        // The revert MUST publish — this is the assertion that fails against the pre-fix handler.
        expect(handleSyncPublish).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'usr_ulid', displayName: 'Original Name' }),
        );
    });

    it('user.updated after a self-service rename: an avatar-only Clerk event does NOT revert profiles.displayName and does NOT publish', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);

        // Self-service state: `profiles.displayName` was overridden to "Self Service Name" via
        // PATCH /api/v1/users/me, but `users.name` (the Clerk mirror) still reads Clerk's last-synced
        // "Clerk Name" — exactly the divergence the corrected gate must respect.
        const daoInstance = makeStatefulUserDao({
            mirrorName: 'Clerk Name',
            mirrorPicture: 'https://example.com/avatar.png',
            profileDisplayName: 'Self Service Name',
        });
        vi.mocked(UserDAO).mockImplementation(function () {
            return daoInstance;
        });

        // Only the avatar changed on Clerk's side — the name (via buildDisplayName) is still "Clerk Name".
        const avatarOnlyPayload = {
            ...makeUserUpdatedPayload('Clerk', 'Name'),
            data: { ...makeUserUpdatedPayload('Clerk', 'Name').data, image_url: 'https://example.com/new-avatar.png' },
        };
        mockVerifyWebhook.mockReturnValue(avatarOnlyPayload as never);

        const result = await handler(
            makeEvent(JSON.stringify(avatarOnlyPayload), { 'svix-id': 'msg_avatar_only' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        // The self-service override MUST survive an unrelated Clerk event — this is the assertion
        // that fails against the profiles-gated design (commit 6f9d43f2).
        expect(daoInstance.getStoredDisplayName()).toBe('Self Service Name');
        expect(handleSyncPublish).not.toHaveBeenCalled();
    });

    it('user.updated with a genuine Clerk name change: Clerk wins over a prior self-service override, and publishes', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);

        const daoInstance = makeStatefulUserDao({
            mirrorName: 'Clerk Name',
            mirrorPicture: 'https://example.com/avatar.png',
            profileDisplayName: 'Self Service Name',
        });
        vi.mocked(UserDAO).mockImplementation(function () {
            return daoInstance;
        });

        mockVerifyWebhook.mockReturnValue(makeUserUpdatedPayload('New', 'ClerkName') as never);
        const result = await handler(
            makeEvent(JSON.stringify(makeUserUpdatedPayload('New', 'ClerkName')), { 'svix-id': 'msg_genuine_change' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        expect(daoInstance.getStoredDisplayName()).toBe('New ClerkName');
        expect(handleSyncPublish).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'usr_ulid', displayName: 'New ClerkName' }),
        );
    });

    it('user.updated with no actual name/picture change -> does not publish a handle-sync rename', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);

        const daoInstance = makeStatefulUserDao({
            mirrorName: 'Same Name',
            mirrorPicture: 'https://example.com/avatar.png',
        });
        vi.mocked(UserDAO).mockImplementation(function () {
            return daoInstance;
        });

        const noopPayload = {
            ...makeUserUpdatedPayload('Same', 'Name'),
            data: {
                ...makeUserUpdatedPayload('Same', 'Name').data,
                image_url: 'https://example.com/avatar.png',
            },
        };
        mockVerifyWebhook.mockReturnValue(noopPayload as never);

        const result = await handler(makeEvent(JSON.stringify(noopPayload), { 'svix-id': 'msg_noop' }), makeContext());

        expect(result.statusCode).toBe(200);
        expect(daoInstance.getStoredDisplayName()).toBe('Same Name');
        expect(handleSyncPublish).not.toHaveBeenCalled();
    });

    it('user.deleted -> enqueues SQS deletion message', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userDeletedPayload as never);

        const daoInstance = {
            upsertByIdentityId: vi.fn(),
            findByIdentityId: vi.fn(),
            updateProfile: vi.fn(),
        };
        vi.mocked(UserDAO).mockImplementation(function () {
            return daoInstance;
        });

        const result = await handler(
            makeEvent(JSON.stringify(userDeletedPayload), { 'svix-id': 'msg_789' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        // The deletion-worker parses `identityId` from the body — the message MUST carry that key,
        // not `userId`, or every webhook-driven deletion silently no-ops once the worker consumes
        // the queue (U1 / A1 deletion-payload alignment).
        expect(SendMessageCommand).toHaveBeenCalledWith({
            QueueUrl: process.env['DELETION_QUEUE_URL'],
            MessageBody: JSON.stringify({ identityId: 'user_abc123' }),
        });
    });

    it('does NOT record the svix-id when processing fails (so svix retries, not deduped away)', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userCreatedPayload as never);

        const daoInstance = {
            upsertByIdentityId: vi.fn().mockResolvedValue({
                id: 'usr_ulid',
                identityId: 'user_abc123',
                email: 'test@example.com',
                name: 'John Doe',
                picture: null,
            }),
            findByIdentityId: vi.fn(),
            updateProfile: vi.fn(),
        };
        vi.mocked(UserDAO).mockImplementation(function () {
            return daoInstance;
        });
        // A GENUINE processing failure (the local user unit couldn't be completed). Note this is NOT
        // setExternalId — that's best-effort now and must not fail the webhook; a DB error inside the
        // provisioning routine is the real "processing failed" case that should make svix retry.
        mockProvisionCompleteUser.mockRejectedValue(new Error('db unavailable'));

        await expect(
            handler(makeEvent(JSON.stringify(userCreatedPayload), { 'svix-id': 'msg_fail' }), makeContext()),
        ).rejects.toThrow('db unavailable');

        // Confirm-after-process: the svix-id is NOT recorded on failure, so svix's retry re-processes
        // instead of short-circuiting to dedup (the original A2 event-loss failure mode).
        expect(mockRecordOnce).not.toHaveBeenCalled();
        // R5: a genuine failure emits the distinct paging signal (carrying only the Clerk identity id).
        expect(vi.mocked(captureProvisioningFailure)).toHaveBeenCalledWith(expect.any(Error), 'user_abc123');
    });

    it('records the svix-id on the PK only after a successful user.created', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userCreatedPayload as never);

        const daoInstance = {
            upsertByIdentityId: vi.fn().mockResolvedValue({
                id: 'usr_ulid',
                identityId: 'user_abc123',
                email: 'test@example.com',
                name: 'John Doe',
                picture: null,
            }),
            findByIdentityId: vi.fn(),
            updateProfile: vi.fn(),
        };
        vi.mocked(UserDAO).mockImplementation(function () {
            return daoInstance;
        });

        const result = await handler(
            makeEvent(JSON.stringify(userCreatedPayload), { 'svix-id': 'msg_ok' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        expect(mockRecordOnce).toHaveBeenCalledWith(db, 'msg_ok', 'user_abc123', 'user.created');
    });

    it('invalid signature -> 401 without processing, so a stale secret is recoverable', async () => {
        // A signature failure is the ONE rejection that must stay retryable. It briefly returned 200 on the
        // reasoning that a wrong signing secret "every retry reproduces" — but a wrong secret is a TRANSIENT,
        // operator-fixable condition, and svix's multi-hour retry window is what rescues it. A 200 says
        // "delivered" and discards every queued real Clerk event permanently behind a green check (the recorded
        // dropped-`user.created` incident). It also tells a forger their forgery was accepted, on an endpoint
        // whose signature is the only trust boundary. The ERROR log + per-reason metric are asserted in
        // `common/__tests__/handler-pipeline.test.ts`, which owns that path.
        mockVerifyWebhook.mockImplementation(() => {
            throw new Error('Invalid signature');
        });

        const result = await handler(makeEvent(JSON.stringify(userCreatedPayload), {}), makeContext());

        expect(result.statusCode).toBe(401);
        expect(JSON.parse(result.body)).toEqual({ ok: false, rejected: 'signature' });
        // Still never processed, and still never recorded — rejecting is not the same as accepting.
        expect(mockRecordOnce).not.toHaveBeenCalled();
    });

    it('unreadable shape behind a VALID signature -> 200, because no redelivery can ever parse it', async () => {
        // The other half of the pair, asserted HERE too so the two statuses cannot silently converge onto one
        // value: a shape failure is permanent (the same bytes reparse identically), so acknowledging takes it
        // off svix's schedule. Reds if `shape` is ever mapped to a non-2xx.
        mockVerifyWebhook.mockReturnValue({ type: 'user.created', data: {} } as never);

        const result = await handler(makeEvent(JSON.stringify(userCreatedPayload), {}), makeContext());

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body)).toEqual({ ok: false, rejected: 'shape' });
        expect(mockRecordOnce).not.toHaveBeenCalled();
    });

    it('missing IDP_WEBHOOK_SECRET -> fails fast on the typed config, not a 401', async () => {
        // S-I5: an env misconfig is a cold-start failure now, distinct from a genuine bad-signature
        // 401 — it must propagate (reject), not be swallowed into the signature-verification branch.
        delete process.env['IDP_WEBHOOK_SECRET'];

        await expect(handler(makeEvent(JSON.stringify(userCreatedPayload), {}), makeContext())).rejects.toThrow();
        expect(mockVerifyWebhook).not.toHaveBeenCalled();
    });

    it('missing DELETION_QUEUE_URL -> fails fast on the typed config before verifying the signature', async () => {
        delete process.env['DELETION_QUEUE_URL'];

        await expect(handler(makeEvent(JSON.stringify(userCreatedPayload), {}), makeContext())).rejects.toThrow();
        expect(mockVerifyWebhook).not.toHaveBeenCalled();
    });

    it('missing both IDP_SECRET_KEY and AUTH_SECRET_ARN -> fails fast on the typed config', async () => {
        delete process.env['AUTH_SECRET_ARN'];

        await expect(handler(makeEvent(JSON.stringify(userCreatedPayload), {}), makeContext())).rejects.toThrow();
        expect(mockVerifyWebhook).not.toHaveBeenCalled();
    });

    it('reads IDP_WEBHOOK_SECRET and DB_SECRET_ARN from the typed config (not requireEnv)', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userCreatedPayload as never);

        await handler(makeEvent(JSON.stringify(userCreatedPayload), { 'svix-id': 'msg_config' }), makeContext());

        expect(mockVerifyWebhook).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'whsec_test');
        expect(mockGetDb).toHaveBeenCalledWith('arn:aws:secretsmanager:us-east-1:123:secret:db');
    });
});
