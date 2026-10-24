/**
 * The two AWS pins and the environment they share: dummy credentials, no profile, no session token, and no
 * credentials or config file the SDK could read. `awsPinIsolation.test.ts` proves the same against the real
 * credential chain; this file pins each pin's contract.
 */
import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ABSENT_AWS_FILE, DUMMY_AWS_ACCESS_KEY_ID, awsPinCheckFile, pinAwsTo } from '../awsPin.js';
import { INTEGRATION_AWS_PIN, REFUSED_AWS_ENDPOINT } from '../integrationAwsPin.js';
import { DEFAULT_LOCALSTACK_ENDPOINT, isNonLoopbackAwsEndpointError, localE2eAwsPin } from '../localAwsPin.js';

describe('pinAwsTo — what both pins share', () => {
    const pin = pinAwsTo('http://localhost:1');

    it('sends a default-constructed client to the endpoint, in a named region', () => {
        expect(pin.endpoint).toBe('http://localhost:1');
        expect(pin.env['AWS_ENDPOINT_URL']).toBe('http://localhost:1');
        expect(pin.env['AWS_REGION']).toMatch(/^[a-z]{2}-[a-z]+-\d$/u);
    });

    it('⛔ pins the dummy key and blanks every other credential source the chain reads before it', () => {
        expect(pin.env).toMatchObject({
            AWS_ACCESS_KEY_ID: DUMMY_AWS_ACCESS_KEY_ID,
            AWS_SECRET_ACCESS_KEY: 'test',
            AWS_PROFILE: '',
            AWS_SESSION_TOKEN: '',
            AWS_CONFIG_FILE: ABSENT_AWS_FILE,
            AWS_SHARED_CREDENTIALS_FILE: ABSENT_AWS_FILE,
        });
    });

    it('names a credentials and config file that cannot exist', () => {
        expect(existsSync(ABSENT_AWS_FILE)).toBe(false);
    });

    it('runs the worker-side check in every file of the tier', () => {
        expect(pin.setupFiles).toEqual([awsPinCheckFile()]);
        expect(existsSync(awsPinCheckFile())).toBe(true);
    });
});

describe('INTEGRATION_AWS_PIN — a refused endpoint', () => {
    it('sends every client to a loopback port nothing serves', () => {
        const url = new URL(REFUSED_AWS_ENDPOINT);

        expect([url.hostname, url.port]).toEqual(['127.0.0.1', '9']);
        expect(INTEGRATION_AWS_PIN).toEqual(pinAwsTo(REFUSED_AWS_ENDPOINT));
    });
});

describe('localE2eAwsPin — LocalStack, at a loopback endpoint only', () => {
    it.each<[string, Readonly<Record<string, string | undefined>>, string]>([
        ['unset', {}, DEFAULT_LOCALSTACK_ENDPOINT],
        ['empty', { AWS_ENDPOINT_URL: '' }, DEFAULT_LOCALSTACK_ENDPOINT],
        ['another port on localhost', { AWS_ENDPOINT_URL: 'http://localhost:4567' }, 'http://localhost:4567'],
        ['the IPv4 loopback', { AWS_ENDPOINT_URL: 'http://127.0.0.1:4566' }, 'http://127.0.0.1:4566'],
        ['the IPv6 loopback', { AWS_ENDPOINT_URL: 'http://[::1]:4566' }, 'http://[::1]:4566'],
    ])('takes the endpoint when the environment leaves it %s', (_case, env, endpoint) => {
        expect(localE2eAwsPin(env)).toEqual(pinAwsTo(endpoint));
    });

    it.each([
        ['real AWS', 'https://s3.us-east-1.amazonaws.com'],
        ['a container name', 'http://localstack:4566'],
        ['a lookalike host', 'http://localhost.example.com:4566'],
        ['an unparseable value', 'not a url'],
    ])('⛔ throws, rather than pinning, for %s', (_case, value) => {
        let thrown: unknown;

        try {
            localE2eAwsPin({ AWS_ENDPOINT_URL: value });
        } catch (error) {
            thrown = error;
        }

        expect(isNonLoopbackAwsEndpointError(thrown)).toBe(true);
    });
});
