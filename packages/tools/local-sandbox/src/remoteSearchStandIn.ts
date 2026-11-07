/**
 * @module remoteSearchStandIn — the local equivalent of the remote search service, wired for food.
 *
 * ⛔ WHY THERE IS ONE. Food asks the remote search service for USDA foods through a CloudFront distribution it signs
 * every request for. None of that exists locally (`localSupport.ts` lists the CloudFront types as unsupported), so
 * food ran with its remote search group ABSENT, every probe answered `unavailable`, and `e2e-seed provision` threw
 * `RemoteProbeExhaustedError` at the first word: every local lane stopped at setup, and the remote-food flows could
 * not run at all.
 *
 * What stands in for it is `@kitchensink/remote-search-edge`: the real search function (the Lambda bundle, unchanged)
 * behind a signature-checking edge, over a deterministic USDA double. It runs as a SIDECAR in food's network
 * namespace, because food accepts a plain-`http` origin on a loopback host only, and a sibling container's compose
 * name is not one.
 *
 * ⛔ NOTHING HERE CALLS A THIRD PARTY. A pick makes FOOD fetch the item from USDA itself, so food's own
 * `USDA_API_BASE_URL` is pointed at the double too, and its `USDA_API_KEY` is replaced: the real key
 * `local:up` reads from Secrets Manager is never given to the container.
 *
 * @pattern Facade — the keys, the food environment and the sidecar, derived from one set of constants so the origin
 *   food signs for and the port the sidecar listens on cannot drift apart
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';

import type { SidecarContainer } from './composePlan.js';

/** Where the stand-in lives, in food's network namespace. */
export const REMOTE_SEARCH_STAND_IN = Object.freeze({
    /** The edge's port: food's `REMOTE_SEARCH_ORIGIN` names it, and the signature covers it. */
    edgePort: 4010,
    /** The USDA double's port. */
    usdaPort: 4011,
    /** A CloudFront key pair id shape (`^[A-Z0-9]+$`). */
    keyPairId: 'KLOCALSTANDIN',
    /** A value that is not a credential: the double checks no key. */
    usdaApiKey: 'local-stand-in-key',
    /** The compose service it joins. */
    joins: 'food',
    /** Where the generated files are mounted inside the container. */
    mount: '/standin',
});

/** The key material the stand-in and food share. */
export interface StandInKeys {
    /** RSA private key, PEM: food signs with it. */
    readonly privateKeyPem: string;
    /** Its public half, PEM: the edge trusts it. */
    readonly publicKeyPem: string;
    /** 32 bytes as unpadded base64url: seals and opens a remote hit's reference. */
    readonly referenceKey: string;
}

/**
 * Generate the key material. A fresh key pair each call.
 *
 * @returns The keys.
 * @sideEffect Reads the system's random source.
 */
export function generateStandInKeys(): StandInKeys {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

    return {
        privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        referenceKey: randomBytes(32).toString('base64url'),
    };
}

/**
 * The environment food runs with so that it uses the stand-in: the four remote search settings, and the USDA address
 * and key it fetches a picked hit with. Pure.
 *
 * @param keys - The shared key material.
 * @returns Name to value.
 */
export function foodRemoteSearchEnv(keys: StandInKeys): Readonly<Record<string, string>> {
    return {
        REMOTE_SEARCH_ORIGIN: `http://127.0.0.1:${String(REMOTE_SEARCH_STAND_IN.edgePort)}`,
        REMOTE_SEARCH_KEY_PAIR_ID: REMOTE_SEARCH_STAND_IN.keyPairId,
        REMOTE_SEARCH_SIGNING_KEY: keys.privateKeyPem,
        FOOD_REMOTE_REFERENCE_KEY: keys.referenceKey,
        USDA_API_BASE_URL: `http://127.0.0.1:${String(REMOTE_SEARCH_STAND_IN.usdaPort)}/fdc/v1`,
        USDA_API_KEY: REMOTE_SEARCH_STAND_IN.usdaApiKey,
    };
}

/**
 * The sidecar container. Pure.
 *
 * It expects the generated files under `./remoteSearch` beside the compose file: `main.mjs` (the stand-in's bundle),
 * `lambda/` (the search function's bundle) and `publicKey.pem`. The image is the one food's own Dockerfile builds on,
 * so it is already present after the images are built.
 *
 * @returns The sidecar.
 */
export function remoteSearchSidecar(): SidecarContainer {
    const mount = REMOTE_SEARCH_STAND_IN.mount;

    return {
        name: 'remote-search',
        image: 'node:24-slim',
        networkMode: `service:${REMOTE_SEARCH_STAND_IN.joins}`,
        command: ['node', `${mount}/main.mjs`],
        volumes: [`./remoteSearch:${mount}:ro`],
        environment: {
            REMOTE_SEARCH_LAMBDA_BUNDLE: `${mount}/lambda/handler.js`,
            REMOTE_SEARCH_PUBLIC_KEY_FILE: `${mount}/publicKey.pem`,
            REMOTE_SEARCH_KEY_PAIR_ID: REMOTE_SEARCH_STAND_IN.keyPairId,
            REMOTE_SEARCH_EDGE_PORT: String(REMOTE_SEARCH_STAND_IN.edgePort),
            REMOTE_SEARCH_USDA_PORT: String(REMOTE_SEARCH_STAND_IN.usdaPort),
            // Pinned to LocalStack with throwaway credentials, as every container is: the function reads its USDA
            // key from Secrets Manager, and this must never be the real one.
            AWS_ENDPOINT_URL: 'http://localstack:4566',
            AWS_REGION: 'us-east-1',
            AWS_DEFAULT_REGION: 'us-east-1',
            AWS_ACCESS_KEY_ID: 'test',
            AWS_SECRET_ACCESS_KEY: 'test',
        },
        healthcheck: {
            // A TCP connect: the edge answers an unsigned request `403`, so an HTTP check would call a healthy one down.
            test: [
                'CMD-SHELL',
                `node -e "require('net').connect(${String(REMOTE_SEARCH_STAND_IN.edgePort)},'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"`,
            ],
            interval: '3s',
            timeout: '3s',
            retries: 30,
        },
    };
}
