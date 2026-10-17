/**
 * The remote search CloudFront signing key's provisioning step (ADR-0055 point 7), run by CloudFormation through CDK's
 * provider framework, once per base stage. The stack creates the secret; this makes sure it holds an RSA-2048 private
 * key and answers with the matching public key, which the stack turns into a CloudFront public key in the key group
 * every search copy at the stage trusts.
 *
 * Only Create writes, and only over a secret that holds no private key (the value CloudFormation generated when it
 * created the secret); a key a retried Create already wrote is kept. Update keeps the key and REFUSES a secret that
 * lost it: generating a new one there would change the key CloudFront trusts while every food task still signs with
 * the old one, behind a successful deploy. Rotation is a new generation instead (`RemoteSearchSharedStack`). Delete
 * touches nothing, because CloudFormation deletes the secret itself.
 *
 * Only the public key leaves: the private key goes from the generator into the secret and nowhere else.
 *
 * @pattern Command — one CloudFormation event, handled idempotently on the secret's contents
 * @module
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';

import type { CloudFormationCustomResourceEvent } from 'aws-lambda';

/** The key size CloudFront accepts for a trusted key group's public key. */
const CLOUDFRONT_RSA_MODULUS_BITS = 2_048;

/** The first line of a PEM private key: PKCS#8, or PKCS#1 for RSA. */
const PEM_PRIVATE_KEY = /^-----BEGIN (?:RSA )?PRIVATE KEY-----\n/u;

/** Where the private key is kept. */
export interface SigningKeyStore {
    /** The secret's current string value, or `undefined` when it holds none. Every other failure is thrown. */
    read(secretId: string): Promise<string | undefined>;
    /** Store a value as the secret's new current version. */
    write(secretId: string, value: string): Promise<void>;
}

/** What CloudFormation receives on Create and Update: the resource's id and the public key. */
export interface ProvisionedSigningKey {
    readonly PhysicalResourceId: string;
    readonly Data: { readonly PublicKeyPem: string };
}

/** What CloudFormation receives on Delete: the resource's id. */
export interface DeletedSigningKey {
    readonly PhysicalResourceId: string;
}

/** What CloudFormation receives. */
export type SigningKeyResponse = ProvisionedSigningKey | DeletedSigningKey;

/** A provisioning step's answer, and what it did to the secret (for the log). */
export type SigningKeyResult =
    | { readonly outcome: 'generated' | 'reused'; readonly response: ProvisionedSigningKey }
    | { readonly outcome: 'deleted'; readonly response: DeletedSigningKey };

/**
 * The secret the event names. Pure.
 *
 * @param event - The event.
 * @returns The secret's ARN.
 * @throws {Error} when the properties name no secret.
 */
function secretIdOf(event: CloudFormationCustomResourceEvent): string {
    const secretArn: unknown = event.ResourceProperties['SecretArn'];

    if (typeof secretArn !== 'string' || secretArn === '') {
        throw new Error('The signing key resource must name its secret as a non-empty SecretArn property.');
    }

    return secretArn;
}

/**
 * The key a stored value holds. Pure.
 *
 * @param stored - The secret's value, or `undefined` when it has none.
 * @returns `absent` when the value is no private key at all, else the key and whether CloudFront can use it.
 * @throws {Error} when the value is a PEM private key that does not parse: a damaged key is never replaced.
 */
function readKey(
    stored: string | undefined,
): { readonly kind: 'absent' } | { readonly kind: 'key'; readonly key: KeyObject; readonly usable: boolean } {
    if (stored === undefined || !PEM_PRIVATE_KEY.test(stored)) {
        return { kind: 'absent' };
    }

    const key = createPrivateKey(stored);
    const usable =
        key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails?.modulusLength === CLOUDFRONT_RSA_MODULUS_BITS;

    return { kind: 'key', key, usable };
}

/**
 * The PEM public key of a private key. Pure.
 *
 * @param privateKey - The private key.
 * @returns Its SubjectPublicKeyInfo PEM, the encoding CloudFront's public keys take.
 */
function publicKeyPem(privateKey: KeyObject): string {
    return createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
}

/**
 * Handle one CloudFormation event for the signing key.
 *
 * @param event - The event.
 * @param store - Where the private key is kept.
 * @returns The response for CloudFormation, and what was done.
 * @throws {Error} when the event names no secret, the secret cannot be read or written, a Create finds a key it cannot
 *   use, or an Update finds no usable key.
 * @sideEffect Reads the secret, and on Create writes a new private key into a secret that holds none.
 */
export async function provisionSigningKey(
    event: CloudFormationCustomResourceEvent,
    store: SigningKeyStore,
): Promise<SigningKeyResult> {
    const secretId = secretIdOf(event);

    if (event.RequestType === 'Delete') {
        return { response: { PhysicalResourceId: event.PhysicalResourceId }, outcome: 'deleted' };
    }

    const stored = readKey(await store.read(secretId));

    if (stored.kind === 'key' && stored.usable) {
        return {
            response: { PhysicalResourceId: secretId, Data: { PublicKeyPem: publicKeyPem(stored.key) } },
            outcome: 'reused',
        };
    }

    if (event.RequestType === 'Update' || stored.kind === 'key') {
        throw new Error(
            `The secret ${secretId} does not hold a usable RSA-2048 signing key. Restore it, or rotate by adding a ` +
                'signing key generation (RemoteSearchSharedStack); never replace the key food signs with in place.',
        );
    }

    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: CLOUDFRONT_RSA_MODULUS_BITS });

    await store.write(secretId, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());

    return {
        response: { PhysicalResourceId: secretId, Data: { PublicKeyPem: publicKeyPem(privateKey) } },
        outcome: 'generated',
    };
}
