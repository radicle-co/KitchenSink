/**
 * The REAL remote search signing key provisioner handler — the module the provider framework invokes — over the REAL
 * AWS SDK, against a loopback stand-in for Secrets Manager's JSON API, reached through
 * `AWS_ENDPOINT_URL_SECRETS_MANAGER`.
 *
 * What a unit test cannot show and this does: the reads and writes that cross the wire (one read and one write to
 * create a key, one read and no write to keep it), that a binary secret reads as holding no key, and that the private
 * key reaches the secret and nothing else: not the answer CloudFormation receives, not the log.
 */
import { createSign, createVerify } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { CloudFormationCustomResourceEvent } from 'aws-lambda';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SigningKeyResponse } from '../src/remoteSearchSigningKey/signingKeyProvisioner.js';

const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:SigningKey1Secret-AbCdEf';

/** The value CloudFormation generates for a new secret, before the provisioner writes the key. */
const GENERATED_PLACEHOLDER = 'r7J#k2!pQx9Lw$vB3nZt8Ye5Mc6Ud4Hs';

/** What the stand-in holds, and what reached it. */
interface SecretsStandIn {
    value: { readonly SecretString: string } | { readonly SecretBinary: string } | undefined;
    refuseReads: number;
    readonly operations: string[];
}

const standIn: SecretsStandIn = { value: undefined, refuseReads: 0, operations: [] };

/**
 * Answer one Secrets Manager request.
 *
 * @param request - The request.
 * @param body - Its parsed body.
 * @param response - The response.
 * @sideEffect Records the request, may store the value, writes the response.
 */
function answer(request: IncomingMessage, body: Record<string, unknown>, response: ServerResponse): void {
    const operation = String(request.headers['x-amz-target'] ?? '');
    const json = { 'content-type': 'application/x-amz-json-1.1' };

    standIn.operations.push(operation);

    if (body['SecretId'] !== SECRET_ARN) {
        response.writeHead(400, json).end(JSON.stringify({ __type: 'ResourceNotFoundException' }));

        return;
    }

    if (operation === 'secretsmanager.GetSecretValue') {
        if (standIn.refuseReads > 0) {
            standIn.refuseReads -= 1;
            response.writeHead(400, json).end(JSON.stringify({ __type: 'AccessDeniedException' }));

            return;
        }

        response.writeHead(200, json).end(JSON.stringify({ ARN: SECRET_ARN, VersionId: 'v1', ...standIn.value }));

        return;
    }

    if (operation === 'secretsmanager.PutSecretValue' && typeof body['SecretString'] === 'string') {
        standIn.value = { SecretString: body['SecretString'] };
        response.writeHead(200, json).end(JSON.stringify({ ARN: SECRET_ARN, VersionId: 'v2' }));

        return;
    }

    response.writeHead(400, json).end(JSON.stringify({ __type: 'UnknownOperationException' }));
}

const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
    });
    request.on('end', () => {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');

        answer(request, typeof parsed === 'object' && parsed !== null ? { ...parsed } : {}, response);
    });
});

let handler: (event: CloudFormationCustomResourceEvent) => Promise<SigningKeyResponse>;

/** Everything the handler wrote to the console during the current case. */
let written = '';

beforeAll(async () => {
    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    const port = typeof address === 'object' && address !== null ? (address satisfies AddressInfo).port : 0;

    vi.stubEnv('AWS_ENDPOINT_URL_SECRETS_MANAGER', `http://127.0.0.1:${String(port)}`);
    vi.stubEnv('AWS_REGION', 'us-east-1');
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'integration-access-key');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'integration-secret-key');
});

beforeEach(async () => {
    standIn.value = { SecretString: GENERATED_PLACEHOLDER };
    standIn.refuseReads = 0;
    standIn.operations.length = 0;
    written = '';

    vi.resetModules();
    ({ handler } = await import('../src/remoteSearchSigningKey/handler.js'));

    for (const method of ['log', 'error', 'warn', 'info'] as const) {
        vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => {
            written += `${parts.map(String).join(' ')}\n`;
        });
    }
});

afterEach(() => {
    vi.restoreAllMocks();
});

afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => {
        server.close(() => {
            resolve();
        });
        server.closeAllConnections();
    });
});

/** The fields every event shares. */
const COMMON = {
    ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:framework-onEvent',
    ResponseURL: 'https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com/response',
    StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/kitchensink-remote-search-shared-sandbox/guid',
    RequestId: 'request-1',
    LogicalResourceId: 'SigningKey1',
    ResourceType: 'Custom::CloudFrontSigningKey',
    ResourceProperties: { ServiceToken: 'token', SecretArn: SECRET_ARN },
} as const;

const CREATE: CloudFormationCustomResourceEvent = { ...COMMON, RequestType: 'Create' };
const UPDATE: CloudFormationCustomResourceEvent = {
    ...COMMON,
    RequestType: 'Update',
    PhysicalResourceId: SECRET_ARN,
    OldResourceProperties: COMMON.ResourceProperties,
};
const DELETE: CloudFormationCustomResourceEvent = { ...COMMON, RequestType: 'Delete', PhysicalResourceId: SECRET_ARN };

/**
 * The public key an answer carries.
 *
 * @param response - The handler's response.
 * @returns The PEM.
 */
function publicKeyOf(response: SigningKeyResponse): string {
    if (!('Data' in response)) {
        throw new Error('expected a public key in the response');
    }

    return response.Data.PublicKeyPem;
}

/** The private key the stand-in holds now. */
function storedKey(): string {
    return standIn.value !== undefined && 'SecretString' in standIn.value ? standIn.value.SecretString : '';
}

describe('the remote search signing key provisioner — over the wire', () => {
    it('creates a key with one read and one write, and answers with its public half', async () => {
        const response = await handler(CREATE);
        const privateKey = storedKey();
        const policy = 'the policy CloudFront verifies';

        expect(standIn.operations).toStrictEqual(['secretsmanager.GetSecretValue', 'secretsmanager.PutSecretValue']);
        expect(privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----\n/u);
        expect(
            createVerify('RSA-SHA1')
                .update(policy)
                .verify(publicKeyOf(response), createSign('RSA-SHA1').update(policy).sign(privateKey)),
        ).toBe(true);
    });

    it('creates a key over a secret that reads as binary', async () => {
        standIn.value = { SecretBinary: Buffer.from('binary').toString('base64') };

        await handler(CREATE);

        expect(storedKey()).toMatch(/^-----BEGIN PRIVATE KEY-----\n/u);
    });

    it('keeps the key on an Update: one read, no write, the same public key', async () => {
        const created = await handler(CREATE);
        const key = storedKey();

        standIn.operations.length = 0;

        const updated = await handler(UPDATE);

        expect(standIn.operations).toStrictEqual(['secretsmanager.GetSecretValue']);
        expect(storedKey()).toBe(key);
        expect(publicKeyOf(updated)).toBe(publicKeyOf(created));
    });

    it('fails an Update over a secret that lost its key, and writes nothing', async () => {
        await expect(handler(UPDATE)).rejects.toThrow(/signing key/u);
        expect(standIn.operations).toStrictEqual(['secretsmanager.GetSecretValue']);
        expect(storedKey()).toBe(GENERATED_PLACEHOLDER);
    });

    it('touches nothing on Delete', async () => {
        await expect(handler(DELETE)).resolves.toStrictEqual({ PhysicalResourceId: SECRET_ARN });
        expect(standIn.operations).toStrictEqual([]);
    });

    it('fails the event, and writes nothing, when the secret cannot be read', async () => {
        standIn.refuseReads = 1;

        await expect(handler(CREATE)).rejects.toThrow();
        expect(standIn.operations).toStrictEqual(['secretsmanager.GetSecretValue']);
        expect(storedKey()).toBe(GENERATED_PLACEHOLDER);
    });

    it('keeps the private key out of its answer and its log', async () => {
        const response = await handler(CREATE);
        const body = storedKey().split('\n').slice(1, -2).join('');

        // Non-vacuity: the log was captured, and it is this event's line.
        expect(written).toContain('remote search signing key provisioned');
        expect(body.length).toBeGreaterThan(1_000);
        expect(JSON.stringify(response)).not.toContain(body.slice(0, 64));
        expect(written).not.toContain(body.slice(0, 64));
        expect(written).not.toMatch(/PRIVATE KEY/u);
    });
});
