/**
 * The secret reader over AWS Secrets Manager.
 *
 * @pattern Adapter — the Secrets Manager client behind {@link SecretReader}
 * @module
 */
import { GetSecretValueCommand, type GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager';

import { SecretUnavailableError } from './SecretUnavailableError.js';
import type { SecretReader } from './secretPorts.js';

/** The one call the reader makes. A `SecretsManagerClient` is one. */
export interface SecretValueReads {
    send(command: GetSecretValueCommand): Promise<GetSecretValueCommandOutput>;
}

/**
 * A reader over Secrets Manager.
 *
 * @param client - The client.
 * @returns A reader that answers with the secret's current string value.
 */
export function secretsManagerReader(client: SecretValueReads): SecretReader {
    return async (secretId) => {
        const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

        if (SecretString === undefined || SecretString === '') {
            throw new SecretUnavailableError(secretId);
        }

        return SecretString;
    };
}
