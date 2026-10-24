/**
 * A loopback stand-in for AWS Secrets Manager's JSON API, for the suites that drive real handlers through the real
 * AWS SDK. The SDK reaches it through `AWS_ENDPOINT_URL_SECRETS_MANAGER`, so what is asserted is what crossed the
 * wire: which operation, for which secret, how many times.
 *
 * It answers the one operation this package calls, `GetSecretValue`, in the shape the service documents, and an AWS
 * error body for a secret it does not hold, a read it is told to refuse, or any other operation.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** One request that reached the stub. */
export interface SecretsManagerRequest {
    /** The operation, from `X-Amz-Target` (`secretsmanager.GetSecretValue`). */
    readonly operation: string;
    /** The `SecretId` the request named. */
    readonly secretId: unknown;
}

/** A running stub. */
export interface SecretsManagerStubServer {
    /** The URL to set as `AWS_ENDPOINT_URL_SECRETS_MANAGER`. */
    readonly endpoint: string;
    /** The secrets it holds, by id. A suite sets them per case. */
    readonly secrets: Map<string, string>;
    /** How many of the next reads to refuse with `AccessDeniedException`. */
    refuseReads: number;
    /** Every request that reached the stub, in order. */
    readonly requests: SecretsManagerRequest[];
    /** Forget every secret, request and refusal. */
    reset(): void;
    /** Stop listening. */
    close(): Promise<void>;
}

/** The content type of the Secrets Manager JSON protocol. */
const AWS_JSON = { 'content-type': 'application/x-amz-json-1.1' };

/**
 * Answer with an AWS error body.
 *
 * @param response - The response.
 * @param type - The error's `__type`.
 * @sideEffect Writes the response.
 */
function awsError(response: ServerResponse, type: string): void {
    response.writeHead(400, AWS_JSON).end(JSON.stringify({ __type: type, message: `${type} from the stub` }));
}

/**
 * Answer one request.
 *
 * @param stub - The stub's state.
 * @param request - The request.
 * @param body - Its parsed body.
 * @param response - The response.
 * @sideEffect Records the request, writes the response.
 */
function answer(
    stub: SecretsManagerStubServer,
    request: IncomingMessage,
    body: Record<string, unknown>,
    response: ServerResponse,
): void {
    const operation = String(request.headers['x-amz-target'] ?? '');
    const secretId = body['SecretId'];

    stub.requests.push({ operation, secretId });

    if (typeof secretId !== 'string') {
        awsError(response, 'InvalidParameterException');

        return;
    }

    const arn = `arn:aws:secretsmanager:us-east-1:123456789012:secret:${secretId}-AbCdEf`;

    switch (operation) {
        case 'secretsmanager.GetSecretValue': {
            if (stub.refuseReads > 0) {
                stub.refuseReads -= 1;
                awsError(response, 'AccessDeniedException');

                return;
            }

            const value = stub.secrets.get(secretId);

            if (value === undefined) {
                awsError(response, 'ResourceNotFoundException');

                return;
            }

            response.writeHead(200, AWS_JSON).end(
                JSON.stringify({
                    ARN: arn,
                    Name: secretId,
                    SecretString: value,
                    VersionId: 'v1',
                    VersionStages: ['AWSCURRENT'],
                }),
            );

            return;
        }

        default:
            awsError(response, 'UnknownOperationException');
    }
}

/**
 * Start the stub on a free loopback port.
 *
 * @returns The running stub.
 * @sideEffect Opens a listening socket.
 */
export async function startSecretsManagerStubServer(): Promise<SecretsManagerStubServer> {
    const stub: SecretsManagerStubServer = {
        endpoint: '',
        secrets: new Map(),
        refuseReads: 0,
        requests: [],
        reset(): void {
            stub.secrets.clear();
            stub.requests.length = 0;
            stub.refuseReads = 0;
        },
        async close(): Promise<void> {
            await new Promise<void>((resolve) => {
                server.close(() => {
                    resolve();
                });
                server.closeAllConnections();
            });
        },
    };
    const server: Server = createServer((request, response) => {
        const chunks: Buffer[] = [];

        request.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });
        request.on('end', () => {
            const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');

            answer(stub, request, typeof parsed === 'object' && parsed !== null ? { ...parsed } : {}, response);
        });
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    const port = typeof address === 'object' && address !== null ? (address satisfies AddressInfo).port : 0;

    return Object.assign(stub, { endpoint: `http://127.0.0.1:${String(port)}` });
}
