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
