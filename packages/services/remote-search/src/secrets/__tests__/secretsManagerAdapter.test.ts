/**
 * The Secrets Manager reader over a double of the one client call it makes: which command it sends, what it returns,
 * and that a secret with no string value is refused without the value reaching the error.
 *
 * The wire itself (the real client, the JSON protocol, the endpoint, the credentials) is the integration tier's, in
 * `tests/searchFunction.integration.test.ts`.
 */
import { GetSecretValueCommand, type GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager';
import { describe, expect, it } from 'vitest';

import { isSecretUnavailableError } from '../SecretUnavailableError.js';
import { secretsManagerReader, type SecretValueReads } from '../secretsManagerAdapter.js';

const SECRET_ID = 'kitchensink/test/food/usda-api-key';

/**
 * A client double whose `send` answers every command with one output, recording the commands.
 *
 * @param output - What `send` resolves with.
 * @returns The double and the commands it was sent.
 */
function clientAnswering(output: Omit<GetSecretValueCommandOutput, '$metadata'>): {
    readonly client: SecretValueReads;
    readonly sent: unknown[];
} {
    const sent: unknown[] = [];

    const send = (command: GetSecretValueCommand): Promise<GetSecretValueCommandOutput> => {
        sent.push(command);

        return Promise.resolve({ $metadata: {}, ...output });
    };

    return { client: { send }, sent };
}

describe('secretsManagerReader', () => {
    it('asks for the secret by its id and answers with its string value', async () => {
        const { client, sent } = clientAnswering({ SecretString: 'usda-key-0123' });

        await expect(secretsManagerReader(client)(SECRET_ID)).resolves.toBe('usda-key-0123');
        expect(sent).toHaveLength(1);
        expect(sent[0]).toBeInstanceOf(GetSecretValueCommand);
        expect(sent[0]).toMatchObject({ input: { SecretId: SECRET_ID } });
    });

    it.each([
        ['a binary secret', { SecretBinary: new Uint8Array([1, 2, 3]) }],
        ['an empty string', { SecretString: '' }],
    ])('refuses %s, naming the secret and not its value', async (_label, output) => {
        const { client } = clientAnswering(output);
        const read = secretsManagerReader(client)(SECRET_ID);

        await expect(read).rejects.toSatisfy(isSecretUnavailableError);
        await expect(read).rejects.toThrow(SECRET_ID);
    });
});
