/**
 * The local remote search stand-in is wired so that food ACCEPTS it and nothing local reaches a third party.
 *
 * Food refuses a remote search origin that is plain `http` on anything but a loopback host, takes all four settings
 * or none, and signs every request URL over the whole origin (host and port included). So three things must agree,
 * and each is held here against the rule that makes it matter:
 * - the origin food signs for is the origin the sidecar listens on (a mismatch is a 403 on every search);
 * - the key food signs with is the pair the sidecar trusts (verified with the edge's own signature check);
 * - the USDA address food fetches a picked hit from is the double, and the real key never reaches the container.
 */
import { createPrivateKey, createPublicKey } from 'node:crypto';

import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
import { checkSignedUrl } from '@kitchensink/remote-search-edge/signature';
import { describe, expect, it } from 'vitest';

import { planCompose } from '../composePlan.js';
import { localContainerEnv } from '../localImages.js';
import {
    foodRemoteSearchEnv,
    generateStandInKeys,
    REMOTE_SEARCH_STAND_IN,
    remoteSearchSidecar,
} from '../remoteSearchStandIn.js';

const keys = generateStandInKeys();
const env = foodRemoteSearchEnv(keys);

describe('foodRemoteSearchEnv', () => {
    it('states all four settings food takes together, and only those plus the USDA address', () => {
        expect(Object.keys(env).sort()).toEqual([
            'FOOD_REMOTE_REFERENCE_KEY',
            'REMOTE_SEARCH_KEY_PAIR_ID',
            'REMOTE_SEARCH_ORIGIN',
            'REMOTE_SEARCH_SIGNING_KEY',
            'USDA_API_BASE_URL',
            'USDA_API_KEY',
        ]);
    });

    it("names an origin food accepts: plain http on a loopback host, with no path, on the sidecar's port", () => {
        const url = new URL(env['REMOTE_SEARCH_ORIGIN'] ?? '');

        expect(url.hostname).toBe('127.0.0.1');
        expect(url.origin).toBe(env['REMOTE_SEARCH_ORIGIN']);
        expect(Number(url.port)).toBe(REMOTE_SEARCH_STAND_IN.edgePort);
    });

    it('has a key pair id and a reference key of the shapes food parses', () => {
        expect(env['REMOTE_SEARCH_KEY_PAIR_ID']).toMatch(/^[A-Z0-9]+$/u);
        expect(env['FOOD_REMOTE_REFERENCE_KEY']).toMatch(/^[A-Za-z0-9_-]{43}$/u);
        expect(Buffer.from(env['FOOD_REMOTE_REFERENCE_KEY'] ?? '', 'base64url')).toHaveLength(32);
        expect(createPrivateKey(env['REMOTE_SEARCH_SIGNING_KEY'] ?? '').asymmetricKeyType).toBe('rsa');
    });

    it('points food at the USDA double, on loopback, with a key that is not a credential', () => {
        expect(new URL(env['USDA_API_BASE_URL'] ?? '').hostname).toBe('127.0.0.1');
        expect(Number(new URL(env['USDA_API_BASE_URL'] ?? '').port)).toBe(REMOTE_SEARCH_STAND_IN.usdaPort);
        expect(env['USDA_API_KEY']).toBe(REMOTE_SEARCH_STAND_IN.usdaApiKey);
    });

    it('signs with the pair the sidecar is given to trust', () => {
        const signed = getSignedUrl({
            url: `${env['REMOTE_SEARCH_ORIGIN']}/v1/search/usda?q=tahini`,
            keyPairId: env['REMOTE_SEARCH_KEY_PAIR_ID'] ?? '',
            privateKey: env['REMOTE_SEARCH_SIGNING_KEY'] ?? '',
            dateLessThan: new Date(Date.now() + 60_000).toISOString(),
            algorithm: 'SHA256',
        });

        expect(
            checkSignedUrl(
                signed,
                { publicKey: createPublicKey(keys.publicKeyPem), keyPairId: REMOTE_SEARCH_STAND_IN.keyPairId },
                Math.floor(Date.now() / 1_000),
            ),
        ).toMatchObject({ ok: true });
    });

    it('is a different key each time it is generated', () => {
        expect(generateStandInKeys().privateKeyPem).not.toBe(keys.privateKeyPem);
    });
});

describe('localContainerEnv with the stand-in stated', () => {
    const context = { database: 'kitchensink_food_dev', port: 3000 } as const;
    const declared = Object.keys(env);

    it('gives the container the group, whatever AWS resolved for the same names', () => {
        const result = localContainerEnv(declared, {
            ...context,
            stated: env,
            resolved: {
                REMOTE_SEARCH_KEY_PAIR_ID: 'KD14NRLZSQWTM',
                USDA_API_KEY: 'a-real-usda-key',
                USDA_API_BASE_URL: 'https://api.nal.usda.gov/fdc/v1',
            },
        });

        expect(result['REMOTE_SEARCH_KEY_PAIR_ID']).toBe(REMOTE_SEARCH_STAND_IN.keyPairId);
        expect(result['USDA_API_KEY']).toBe(REMOTE_SEARCH_STAND_IN.usdaApiKey);
        expect(result['USDA_API_BASE_URL']).toBe(env['USDA_API_BASE_URL']);
        expect(result['REMOTE_SEARCH_ORIGIN']).toBe(env['REMOTE_SEARCH_ORIGIN']);
        expect(result['REMOTE_SEARCH_SIGNING_KEY']).toBe(env['REMOTE_SEARCH_SIGNING_KEY']);
        expect(result['FOOD_REMOTE_REFERENCE_KEY']).toBe(env['FOOD_REMOTE_REFERENCE_KEY']);
    });

    it('leaves a service it was not stated for with no group at all, never a partial one', () => {
        const result = localContainerEnv(declared, {
            ...context,
            resolved: { REMOTE_SEARCH_KEY_PAIR_ID: 'KD14NRLZSQWTM' },
        });

        expect(result['REMOTE_SEARCH_ORIGIN']).toBeUndefined();
        expect(result['REMOTE_SEARCH_KEY_PAIR_ID']).toBeUndefined();
    });
});

describe('remoteSearchSidecar', () => {
    const sidecar = remoteSearchSidecar();

    it("joins food's network namespace, so food reaches it on loopback and no host port is published", () => {
        expect(sidecar.networkMode).toBe('service:food');
    });

    it('listens where food signs for', () => {
        expect(sidecar.environment['REMOTE_SEARCH_EDGE_PORT']).toBe(String(REMOTE_SEARCH_STAND_IN.edgePort));
        expect(sidecar.environment['REMOTE_SEARCH_USDA_PORT']).toBe(String(REMOTE_SEARCH_STAND_IN.usdaPort));
        expect(sidecar.environment['REMOTE_SEARCH_KEY_PAIR_ID']).toBe(REMOTE_SEARCH_STAND_IN.keyPairId);
    });

    it('reads the search function from the mounted bundle and is pinned to LocalStack, never real AWS', () => {
        expect(sidecar.environment['REMOTE_SEARCH_LAMBDA_BUNDLE']).toMatch(/\/lambda\/handler\.js$/u);
        expect(sidecar.environment['AWS_ENDPOINT_URL']).toBe('http://localstack:4566');
        expect(sidecar.environment['AWS_ACCESS_KEY_ID']).toBe('test');
    });

    it('is carried into the compose plan as a service with no ports, started after LocalStack', () => {
        const plan = planCompose(
            { localstackServices: ['s3'], containers: [] },
            { databases: [], sidecars: [sidecar] },
        );
        const planned = plan.services[sidecar.name];

        expect(planned?.networkMode).toBe('service:food');
        expect(planned?.ports).toEqual([]);
        expect(planned?.dependsOn).toEqual(['localstack']);
    });
});
