import { createClerkClient } from '@clerk/backend';
import { DEFAULT_ROLE_METADATA, needsDefaultRole } from '@kitchensink/clerk-verify';

import { readSecretStringField } from './secrets.js';

let _client: ReturnType<typeof createClerkClient> | null = null;

const getClient = async () => {
    if (!_client) {
        // Prefer the deploy-time-embedded raw key (IDP_SECRET_KEY) — no runtime GetSecretValue.
        // Fall back to fetching from the auth secret ARN for environments that only set that.
        const rawKey = process.env['IDP_SECRET_KEY'];
        const secretArn = process.env['AUTH_SECRET_ARN'];

        let secretKey: string;

        if (rawKey && !rawKey.startsWith('arn:aws:secretsmanager:')) {
            secretKey = rawKey;
        } else if (secretArn) {
            // JSON field is upper-snake in Secrets Manager (PUBLISHABLE_KEY / SECRET_KEY / …); the
            // previous lower-camel 'secretKey' lookup always missed and threw.
            secretKey = await readSecretStringField(secretArn, 'SECRET_KEY');
        } else {
            throw new Error('IDP_SECRET_KEY or AUTH_SECRET_ARN env var is required');
        }

        _client = createClerkClient({ secretKey });
    }

    return _client;
};

export const setExternalId = async (userId: string, externalId: string): Promise<void> => {
    const client = await getClient();
    await client.users.updateUser(userId, { externalId });
};

/**
 * Give a new user the `default` role, unless their `public_metadata` already carries a `roles` key.
 *
 * ⛔ THE SECOND `public_metadata` WRITER (owner ruling 2026-10-13: `default` is written at sign-up, never inferred
 * from absence). `metadataSingleWriter.test.ts` admits this function and pins it to what follows:
 *
 * - It MERGES (`updateUserMetadata`), never replaces, so the `testPrincipal` marker and any scope survive.
 * - It writes the `roles` key only, and only when that key is absent ({@link needsDefaultRole}). A pool user created by
 *   `poolAdmin` arrives with its roles in the same `createUser` call, and an admin may have set a role since the
 *   event was sent, so the user is read FRESH rather than trusted from the event payload.
 *
 * ⚠️ A small window remains between the read and the merge: a role an admin writes inside it is replaced by `default`.
 * Clerk offers no conditional metadata write, so the window is narrowed (one read, one write) rather than closed.
 *
 * A user Clerk no longer holds (404, on the read or the merge) CONVERGES as `'absent'`: a role for a deleted user is
 * owed to nobody, and throwing would have svix retry a delivery that can never succeed ({@link isAlreadyDeleted}).
 *
 * @param userId - The Clerk user id.
 * @returns `'written'` when `default` was merged; `'present'` when the user already had a `roles` key; `'absent'` when
 *   Clerk no longer holds the user.
 * @throws When Clerk cannot be read or written for any other reason, so the delivery fails and svix retries it.
 * @sideEffect Reads the user from the Clerk admin API and may merge their `public_metadata`.
 */
export const ensureDefaultRole = async (userId: string): Promise<'written' | 'present' | 'absent'> => {
    const client = await getClient();

    try {
        const user = await client.users.getUser(userId);

        if (!needsDefaultRole(user.publicMetadata)) {
            return 'present';
        }

        await client.users.updateUserMetadata(userId, { publicMetadata: { roles: [...DEFAULT_ROLE_METADATA.roles] } });

        return 'written';
    } catch (error) {
        if (isAlreadyDeleted(error)) {
            return 'absent';
        }

        throw error;
    }
};

export const getUser = async (userId: string) => {
    const client = await getClient();

    return client.users.getUser(userId);
};

export const deleteUser = async (userId: string): Promise<void> => {
    const client = await getClient();
    await client.users.deleteUser(userId);
};

/**
 * Ban the Clerk identity (CR-002 closure). Durable and admin-reversible: it PRESERVES the user record and
 * `sub` and blocks sign-in — deliberately NOT `deleteUser` (irreversible) and NOT `lockUser` (auto-expiring).
 * `@clerk/backend` exposes `POST /users/{id}/ban` with no duration param.
 *
 * @sideEffect bans the user via the Clerk admin API.
 */
export const banUser = async (userId: string): Promise<void> => {
    const client = await getClient();
    await client.users.banUser(userId);
};

/**
 * Un-ban the Clerk identity (CR-002 admin-mediated recovery). Restores sign-in for a tombstoned user; the
 * `sub` survived the ban, so the same app ULID resolves.
 *
 * @sideEffect un-bans the user via the Clerk admin API.
 */
export const unbanUser = async (userId: string): Promise<void> => {
    const client = await getClient();
    await client.users.unbanUser(userId);
};

export const listUsers = async () => {
    const client = await getClient();
    const pageSize = 100;
    const all = [];
    let offset = 0;

    for (;;) {
        const { data } = await client.users.getUserList({ limit: pageSize, offset });
        all.push(...data);

        if (data.length < pageSize) {
            break;
        }

        offset += pageSize;
    }

    return all;
};

/**
 * True when a Clerk mutation failed only because the user is already gone (HTTP 404).
 *
 * Deleting an already-deleted account is CONVERGENCE, not failure, and both erasure paths depend on that
 * reading: the tombstone-sweep deletes before enqueuing, the deletion-worker deletes again when it
 * processes the message, and a crash between the two must be able to retry. This lived module-privately in
 * `tombstoneSweep.ts` until the worker needed the same judgement — and "is this failure actually fine?" is
 * exactly the predicate two callers must never answer differently.
 *
 * @param err - The thrown Clerk error.
 * @returns True iff the failure was a 404.
 */
export const isAlreadyDeleted = (err: unknown): boolean =>
    typeof err === 'object' && err !== null && (err as { status?: number }).status === 404;
