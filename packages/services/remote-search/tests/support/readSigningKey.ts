/**
 * Read the key food signs remote search URLs with, the way food's deployment reads it: the key-pair id and the
 * secret's ARN from SSM, the private key from that secret (ADR-0055 point 7). The key belongs to the BASE stage, so a
 * caller names the base stage's parameters.
 *
 * Shared by the DEPLOYED e2e suite and the load tier's URL minter, which must sign exactly as food does.
 *
 * @module
 */
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

/** The SSM parameters that name the key. */
export interface SigningKeyParameters {
    /** The parameter holding the CloudFront key-pair id. */
    readonly keyPairIdParameter: string;
    /** The parameter holding the ARN of the secret that holds the private key. */
    readonly signingKeyParameter: string;
}

/** The key, as `getSignedUrl` takes it. */
export interface SigningKey {
    readonly keyPairId: string;
    readonly privateKey: string;
}

/**
 * Read the key. Never logs it.
 *
 * @param parameters - The SSM parameters that name it.
 * @returns The key-pair id and the private key.
 * @throws {Error} when a parameter or the secret is empty.
 * @sideEffect Reads SSM and Secrets Manager.
 */
export async function readSigningKey(parameters: SigningKeyParameters): Promise<SigningKey> {
    const ssm = new SSMClient({});

    const read = async (name: string): Promise<string> => {
        const { Parameter } = await ssm.send(new GetParameterCommand({ Name: name }));

        if (Parameter?.Value === undefined || Parameter.Value === '') {
            throw new Error(`the SSM parameter ${name} is empty`);
        }

        return Parameter.Value;
    };

    const secretArn = await read(parameters.signingKeyParameter);
    const { SecretString } = await new SecretsManagerClient({}).send(
        new GetSecretValueCommand({ SecretId: secretArn }),
    );

    if (SecretString === undefined || SecretString === '') {
        throw new Error(`the signing key secret named by ${parameters.signingKeyParameter} holds no key`);
    }

    return { keyPairId: await read(parameters.keyPairIdParameter), privateKey: SecretString };
}
