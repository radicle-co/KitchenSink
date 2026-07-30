import { createClerkClient } from '@clerk/backend';
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
