/**
 * @module localAwsPin — the AWS pin for a LOCAL e2e tier (`docs/CODING_STANDARDS.md` §7.1a): every default-constructed
 * client goes to LocalStack on this machine. Shared rationale: `awsPin.ts`.
 *
 * A developer may run LocalStack on another port by exporting `AWS_ENDPOINT_URL`, so the pin takes it from the
 * environment, but only when it is a loopback URL (`loopbackHost.ts`). Anything else throws when the config loads:
 * the tier must not run against a remote endpoint, and a silent fallback would hide the misconfiguration.
 *
 * It imports through the package's `#` map, because a vitest config loads it under plain Node (`awsPin.ts`).
 */
import { pinAwsTo, type AwsPin } from '#awsPin';
import { isLoopbackHost } from '#loopbackHost';

/** Where LocalStack listens when the environment names no endpoint. */
export const DEFAULT_LOCALSTACK_ENDPOINT = 'http://localhost:4566';

/** Raised when `AWS_ENDPOINT_URL` names an endpoint off this machine. Matching guard: {@link isNonLoopbackAwsEndpointError}. */
export class NonLoopbackAwsEndpointError extends Error {
    public readonly endpoint: string;

    public constructor(endpoint: string, reason: string) {
        super(
            `refusing to run a LOCAL e2e tier against AWS_ENDPOINT_URL='${endpoint}': ${reason}. Point it at LocalStack ` +
                `on this machine, e.g. ${DEFAULT_LOCALSTACK_ENDPOINT}, or unset it`,
        );
        this.name = 'NonLoopbackAwsEndpointError';
        this.endpoint = endpoint;
        Object.setPrototypeOf(this, NonLoopbackAwsEndpointError.prototype);
    }
}

/**
 * Type guard for {@link NonLoopbackAwsEndpointError}.
 *
 * @param error - Anything thrown.
 * @returns Whether it is the refusal.
 */
export function isNonLoopbackAwsEndpointError(error: unknown): error is NonLoopbackAwsEndpointError {
    return error instanceof NonLoopbackAwsEndpointError;
}

/**
 * The LOCAL e2e pin for an environment.
 *
 * @param env - The environment the config loads in, normally `process.env`.
 * @returns The pin, to `AWS_ENDPOINT_URL` when it is set, else to {@link DEFAULT_LOCALSTACK_ENDPOINT}. Pure.
 * @throws {NonLoopbackAwsEndpointError} when `AWS_ENDPOINT_URL` is set to anything but a loopback URL.
 */
export function localE2eAwsPin(env: Readonly<Record<string, string | undefined>>): AwsPin {
    const endpoint = env['AWS_ENDPOINT_URL'];

    if (endpoint === undefined || endpoint === '') {
        return pinAwsTo(DEFAULT_LOCALSTACK_ENDPOINT);
    }

    if (!URL.canParse(endpoint)) {
        throw new NonLoopbackAwsEndpointError(endpoint, 'it is not a parseable URL');
    }

    const { hostname } = new URL(endpoint);

    if (!isLoopbackHost(hostname)) {
        throw new NonLoopbackAwsEndpointError(endpoint, `its host '${hostname}' is not loopback`);
    }

    return pinAwsTo(endpoint);
}
