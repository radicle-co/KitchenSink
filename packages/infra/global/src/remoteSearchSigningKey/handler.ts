/**
 * The remote search signing key provisioner's entry point: the `onEvent` function of the provider framework in
 * `RemoteSearchSharedStack`. It reads and writes the one secret the event names, and writes one log line that says
 * what it did and never what the key is.
 *
 * Every failure fails the CloudFormation event, and with it the deploy that ran it: there is no path on which this
 * function succeeds without doing its job, so it sends nothing to Sentry.
 *
 * @module
 */
import { GetSecretValueCommand, PutSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { CloudFormationCustomResourceEvent } from 'aws-lambda';

import { provisionSigningKey, type SigningKeyResponse, type SigningKeyStore } from './signingKeyProvisioner.js';

const client = new SecretsManagerClient({});

/** The store over Secrets Manager. A secret with no string value (binary, or empty) reads as holding none. */
const store: SigningKeyStore = {
    read: async (secretId) => {
        const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

        return SecretString === undefined || SecretString === '' ? undefined : SecretString;
    },
    write: async (secretId, value) => {
        await client.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: value }));
    },
};

/**
 * Handle one CloudFormation event.
 *
 * @param event - The event.
 * @returns The response for CloudFormation.
 * @sideEffect Reads the secret and may write a new private key into it; writes one log line.
 */
export async function handler(event: CloudFormationCustomResourceEvent): Promise<SigningKeyResponse> {
    const { response, outcome } = await provisionSigningKey(event, store);

    console.log(
        JSON.stringify({
            message: 'remote search signing key provisioned',
            requestType: event.RequestType,
            logicalResourceId: event.LogicalResourceId,
            outcome,
        }),
    );

    return response;
}
