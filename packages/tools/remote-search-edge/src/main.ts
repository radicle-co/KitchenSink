/**
 * The sandbox container's entry point: the remote search stand-in, serving the REAL search function.
 *
 * It runs as a sidecar in food's network namespace (`network_mode: service:food`), because food accepts a plain-`http`
 * remote search origin only on a loopback host (`remoteSearchOriginSchema`), and a sibling container's compose name is
 * not one. Inside that namespace food reaches it at `127.0.0.1`.
 *
 * The function is the Lambda bundle `bundle:lambda` produces for `@kitchensink/remote-search-service`, loaded by path
 * and run unchanged: the USDA API key is read from Secrets Manager (LocalStack) by the name the bundle's own
 * environment states, and USDA is the double in this process. Nothing here calls a third-party API.
 *
 * Configuration (all required):
 * - `REMOTE_SEARCH_LAMBDA_BUNDLE` - the bundle's `handler.js`;
 * - `REMOTE_SEARCH_PUBLIC_KEY_FILE` - the PEM public key the edge trusts;
 * - `REMOTE_SEARCH_KEY_PAIR_ID` - its CloudFront key pair id;
 * - `REMOTE_SEARCH_EDGE_PORT` and `REMOTE_SEARCH_USDA_PORT` - the two loopback ports;
 * - `AWS_ENDPOINT_URL` - LocalStack, as for every container.
 *
 * @sideEffect Reads files and the environment, listens on two ports, writes one secret to LocalStack.
 */
import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { CreateSecretCommand, ResourceExistsException, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import { startLocalSearch } from './localSearch.js';
import type { SearchOrigin } from './searchEdgeStandIn.js';

/** The secret the function reads its USDA key from. Its value is a placeholder: the double checks no key. */
const USDA_SECRET_ID = 'kitchensink/local/remote-search/usda-api-key';

function required(name: string): string {
    const value = process.env[name];

    if (value === undefined || value === '') {
        throw new Error(`${name} is required`);
    }

    return value;
}

function portFrom(name: string): number {
    const port = Number(required(name));

    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`${name} must be a port, got '${String(process.env[name])}'`);
    }

    return port;
}

/**
 * Make sure the secret exists in LocalStack. Idempotent: a restart finds it.
 *
 * @sideEffect Writes to Secrets Manager.
 */
async function ensureUsdaSecret(): Promise<void> {
    try {
        await new SecretsManagerClient({}).send(
            new CreateSecretCommand({ Name: USDA_SECRET_ID, SecretString: 'local-stand-in-key' }),
        );
    } catch (error) {
        if (!(error instanceof ResourceExistsException)) {
            throw error;
        }
    }
}

async function main(): Promise<void> {
    const bundle = required('REMOTE_SEARCH_LAMBDA_BUNDLE');
    const publicKey = createPublicKey(readFileSync(required('REMOTE_SEARCH_PUBLIC_KEY_FILE')));

    await ensureUsdaSecret();

    // The function reads its configuration from the environment on each request, so the bundle is loaded after the
    // double's address is known and the variables are set. Loaded once, then reused.
    let loaded: Promise<SearchOrigin> | undefined;

    const handler: SearchOrigin = async (event) => {
        loaded ??= import(pathToFileURL(bundle).href).then((module: { handler: SearchOrigin }) => module.handler);

        return (await loaded)(event);
    };

    const local = await startLocalSearch({
        handler,
        publicKey,
        keyPairId: required('REMOTE_SEARCH_KEY_PAIR_ID'),
        port: portFrom('REMOTE_SEARCH_EDGE_PORT'),
        usdaPort: portFrom('REMOTE_SEARCH_USDA_PORT'),
    });

    process.env['USDA_API_KEY_SECRET_ID'] = USDA_SECRET_ID;
    process.env['USDA_API_BASE_URL'] = local.usdaBaseUrl;
    process.stdout.write(`remote search stand-in: edge ${local.origin}, usda ${local.usdaBaseUrl}\n`);

    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
        process.once(signal, () => {
            void local.close().then(() => process.exit(0));
        });
    }
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
});
