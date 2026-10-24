/**
 * The remote search signing key's provisioning step (ADR-0055 point 7): on Create it makes sure the secret holds an
 * RSA-2048 private key, writing one only over the value CloudFormation generated; on Update it keeps the key and
 * refuses a secret that lost it, rather than swap the key food signs with behind a green deploy; on Delete it touches
 * nothing. The private key is never in what it answers.
 *
 * The store is a double; the real Secrets Manager wire is `tests/remoteSearchSigningKey.integration.test.ts`.
 */
import { createPrivateKey, createPublicKey, createSign, createVerify, generateKeyPairSync } from 'node:crypto';

import type {
    CloudFormationCustomResourceCreateEvent,
    CloudFormationCustomResourceDeleteEvent,
    CloudFormationCustomResourceUpdateEvent,
} from 'aws-lambda';
import { describe, expect, it } from 'vitest';

import {
    provisionSigningKey,
    type ProvisionedSigningKey,
    type SigningKeyResult,
    type SigningKeyStore,
} from '../src/remoteSearchSigningKey/signingKeyProvisioner.js';

const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:SigningKey1Secret-AbCdEf';

/** The fields every request type shares. */
const COMMON = {
    ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:framework-onEvent',
    ResponseURL: 'https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com/response',
    StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/kitchensink-remote-search-shared-prod/guid',
    RequestId: 'request-1',
    LogicalResourceId: 'SigningKey1',
    ResourceType: 'Custom::CloudFrontSigningKey',
    ResourceProperties: { ServiceToken: 'token', SecretArn: SECRET_ARN },
} as const;

/**
 * A `Create` event.
 *
 * @param overrides - Fields to replace.
 * @returns The event.
 */
function makeCreateEvent(
    overrides: Partial<CloudFormationCustomResourceCreateEvent> = {},
): CloudFormationCustomResourceCreateEvent {
    return { ...COMMON, RequestType: 'Create', ...overrides };
}

/**
 * An `Update` event.
 *
 * @param overrides - Fields to replace.
 * @returns The event.
 */
function makeUpdateEvent(
    overrides: Partial<CloudFormationCustomResourceUpdateEvent> = {},
): CloudFormationCustomResourceUpdateEvent {
    return {
        ...COMMON,
        RequestType: 'Update',
        PhysicalResourceId: SECRET_ARN,
        OldResourceProperties: COMMON.ResourceProperties,
        ...overrides,
    };
}

/**
 * A `Delete` event.
 *
 * @returns The event.
 */
function makeDeleteEvent(): CloudFormationCustomResourceDeleteEvent {
    return { ...COMMON, RequestType: 'Delete', PhysicalResourceId: SECRET_ARN };
}

/** A store over one in-memory value, recording every read and write. */
interface MemoryStore {
    readonly store: SigningKeyStore;
    readonly reads: string[];
    readonly writes: { readonly secretId: string; readonly value: string }[];
}

/**
 * Build a store whose secret starts with a value (`undefined` for none), or whose read fails.
 *
 * @param initial - The secret's value, `undefined` for a secret with no string value, or the error a read rejects with.
 * @returns The store and its record.
 */
function memoryStore(initial: string | undefined | Error): MemoryStore {
    let value = initial;
    const reads: string[] = [];
    const writes: { secretId: string; value: string }[] = [];

    return {
        reads,
        writes,
        store: {
            read: (secretId) => {
                reads.push(secretId);

                return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
            },
            write: (secretId, next) => {
                writes.push({ secretId, value: next });
                value = next;

                return Promise.resolve();
            },
        },
    };
}

/** The value CloudFormation generates for a new secret, before the provisioner writes the key. */
const GENERATED_PLACEHOLDER = 'r7J#k2!pQx9Lw$vB3nZt8Ye5Mc6Ud4Hs';

/**
 * A PEM private key of a given shape.
 *
 * @param shape - The key type and size.
 * @returns The PKCS#8 PEM.
 */
function privateKeyPem(shape: 'rsa2048' | 'rsa1024' | 'ed25519'): string {
    const { privateKey } =
        shape === 'ed25519'
            ? generateKeyPairSync('ed25519')
            : generateKeyPairSync('rsa', { modulusLength: shape === 'rsa2048' ? 2_048 : 1_024 });

    return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

/**
 * Whether a public key verifies what a private key signed, with the RSA-SHA1 CloudFront's signed URLs use.
 *
 * @param privatePem - The private key.
 * @param publicPem - The public key.
 * @returns True when they are a pair.
 */
function arePair(privatePem: string, publicPem: string): boolean {
    const policy = '{"Statement":[{"Resource":"https://remote-search.example.test/v1/usda/1/search?q=egg"}]}';
    const signature = createSign('RSA-SHA1').update(policy).sign(privatePem);

    return createVerify('RSA-SHA1').update(policy).verify(publicPem, signature);
}

/**
 * The response of a step that provisioned a key.
 *
 * @param result - The step's result.
 * @returns Its response.
 * @throws {Error} when the step was a Delete.
 */
function provisioned(result: SigningKeyResult): ProvisionedSigningKey {
    if (result.outcome === 'deleted') {
        throw new Error('expected a provisioned key, got a delete');
    }

    return result.response;
}

describe('provisionSigningKey — Create', () => {
    it.each([
        ['the value CloudFormation generated', GENERATED_PLACEHOLDER],
        ['no string value at all', undefined],
    ])('writes an RSA-2048 key over %s, and answers with its public key', async (_label, initial) => {
        const { store, writes } = memoryStore(initial);

        const result = await provisionSigningKey(makeCreateEvent(), store);
        const response = provisioned(result);
        const [written] = writes;

        expect(result.outcome).toBe('generated');
        expect(writes).toHaveLength(1);
        expect(written?.secretId).toBe(SECRET_ARN);

        const key = createPrivateKey(written?.value ?? '');

        expect(key.asymmetricKeyType).toBe('rsa');
        expect(key.asymmetricKeyDetails?.modulusLength).toBe(2_048);
        expect(written?.value).toMatch(/^-----BEGIN PRIVATE KEY-----\n/u);
        expect(response.PhysicalResourceId).toBe(SECRET_ARN);
        expect(response.Data.PublicKeyPem).toMatch(/^-----BEGIN PUBLIC KEY-----\n/u);
        expect(arePair(written?.value ?? '', response.Data.PublicKeyPem)).toBe(true);
    });

    it('keeps a key a retried Create already wrote', async () => {
        const stored = privateKeyPem('rsa2048');
        const { store, writes } = memoryStore(stored);

        const result = await provisionSigningKey(makeCreateEvent(), store);

        expect(result.outcome).toBe('reused');
        expect(writes).toStrictEqual([]);
        expect(arePair(stored, provisioned(result).Data.PublicKeyPem)).toBe(true);
    });

    it.each([
        ['an RSA key too short for CloudFront', privateKeyPem('rsa1024')],
        ['a key of a type CloudFront cannot use', privateKeyPem('ed25519')],
        ['a damaged key', privateKeyPem('rsa2048').replace(/\n[A-Za-z0-9+/]{8}/u, '\n!!!!!!!!')],
    ])('refuses, and writes nothing, over %s it did not write', async (_label, initial) => {
        const { store, writes } = memoryStore(initial);

        await expect(provisionSigningKey(makeCreateEvent(), store)).rejects.toThrow();
        expect(writes).toStrictEqual([]);
    });
});

describe('provisionSigningKey — Update', () => {
    it('keeps the key, and answers the same public key every time', async () => {
        const stored = privateKeyPem('rsa2048');
        const { store, writes } = memoryStore(stored);

        const first = provisioned(await provisionSigningKey(makeUpdateEvent(), store));
        const second = provisioned(await provisionSigningKey(makeUpdateEvent(), store));

        expect(writes).toStrictEqual([]);
        expect(first.Data.PublicKeyPem).toBe(
            createPublicKey(stored).export({ type: 'spki', format: 'pem' }).toString(),
        );
        expect(second.Data.PublicKeyPem).toBe(first.Data.PublicKeyPem);
    });

    it.each([
        ['the value CloudFormation generated', GENERATED_PLACEHOLDER],
        ['no string value at all', undefined],
        ['an RSA key too short for CloudFront', privateKeyPem('rsa1024')],
    ])('refuses a secret holding %s, rather than replace the key food signs with', async (_label, initial) => {
        const { store, writes } = memoryStore(initial);

        await expect(provisionSigningKey(makeUpdateEvent(), store)).rejects.toThrow(/signing key/u);
        expect(writes).toStrictEqual([]);
    });
});

describe('provisionSigningKey — what it answers, failures and deletes', () => {
    it('answers with the public key only, never the private key', async () => {
        const { store } = memoryStore(GENERATED_PLACEHOLDER);

        const response = provisioned(await provisionSigningKey(makeCreateEvent(), store));

        expect(Object.keys(response)).toStrictEqual(['PhysicalResourceId', 'Data']);
        expect(Object.keys(response.Data)).toStrictEqual(['PublicKeyPem']);
        expect(JSON.stringify(response)).not.toMatch(/PRIVATE KEY/u);
    });

    it('fails, and writes nothing, when the secret cannot be read', async () => {
        const failure = new Error('AccessDeniedException');
        const { store, writes } = memoryStore(failure);

        await expect(provisionSigningKey(makeCreateEvent(), store)).rejects.toBe(failure);
        expect(writes).toStrictEqual([]);
    });

    it('touches nothing on Delete: CloudFormation deletes the secret itself', async () => {
        const { store, reads, writes } = memoryStore(privateKeyPem('rsa2048'));

        const { response, outcome } = await provisionSigningKey(makeDeleteEvent(), store);

        expect(outcome).toBe('deleted');
        expect(response).toStrictEqual({ PhysicalResourceId: SECRET_ARN });
        expect(reads).toStrictEqual([]);
        expect(writes).toStrictEqual([]);
    });

    it.each([
        ['no secret', { ServiceToken: 'token' }],
        ['an empty secret', { ServiceToken: 'token', SecretArn: '' }],
        ['a secret that is not a string', { ServiceToken: 'token', SecretArn: 7 }],
    ])('refuses an event that names %s, before reading anything', async (_label, ResourceProperties) => {
        const { store, reads } = memoryStore(GENERATED_PLACEHOLDER);

        await expect(provisionSigningKey(makeCreateEvent({ ResourceProperties }), store)).rejects.toThrow(/SecretArn/u);
        expect(reads).toStrictEqual([]);
    });
});
