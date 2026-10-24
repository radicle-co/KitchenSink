/**
 * `assertSignerEntitled` over a REAL HTTP wire, against bodies built and checked by identity's PUBLISHED schema.
 *
 * ⛔ What the unit tier cannot prove: that the request carries the signer's bearer to the path identity serves
 * (`/api/v1/users/me`), that a real `Response` from a real socket parses, and that a body identity publishes for an
 * unentitled caller is refused while the same body for an entitled one is not.
 *
 * ⚠️ The server is an HTTP-level FAKE of identity: it scopes by bearer because the contract says identity does, and
 * every body it sends is first validated by `userProfileSchema`, so it cannot answer a shape identity would not.
 * It does not prove the DEPLOYED identity derives `granted` from the signer's roles — only a deployed run proves
 * that, and the Maestro tier's `provision` step is that run.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { userProfileSchema, type PaidFeatures } from '@kitchensink/schema-identity';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { assertSignerEntitled, isSignerNotEntitledError } from '../src/signerEntitlement.js';

/** Each bearer's entitlement. A bearer absent here answers 401, as identity does for an unknown token. */
const ENTITLEMENTS: ReadonlyMap<string, PaidFeatures> = new Map([
    ['granted-signer', 'granted'],
    ['upsell-signer', 'upsell'],
    ['hidden-signer', 'hidden'],
]);

/** How many 503s each bearer gets before its answer — a cold identity task. */
let coldCalls: Map<string, number>;
/** `bearer METHOD path` for every request. */
let traffic: string[];
let server: Server;
let origin: string;

const buildProfile = (paidFeatures: PaidFeatures) =>
    userProfileSchema.parse({
        user: {
            id: '01J0K6000000000000000000AA',
            email: 'test-signer+clerk_test@radcile.com',
            displayName: '',
            username: 'test_signer',
            avatarUrl: null,
            status: 'active',
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
        },
        account: {
            id: '01J0K6000000000000000000AB',
            userId: '01J0K6000000000000000000AA',
            paidFeatures,
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
        },
    });

/**
 * Every body the fake serves, built and checked ONCE at module load. A schema change that makes one invalid throws
 * here, as a suite-level failure naming the zod issue — not inside the request handler, where a throw leaves the
 * socket unanswered and the test hangs to its timeout.
 */
const PROFILE_BODIES: ReadonlyMap<PaidFeatures, string> = new Map(
    (['granted', 'upsell', 'hidden'] as const).map((paidFeatures) => [
        paidFeatures,
        JSON.stringify(buildProfile(paidFeatures)),
    ]),
);

beforeAll(async () => {
    server = createServer((request, response) => {
        const bearer = (request.headers.authorization ?? '').replace(/^Bearer /u, '');

        traffic.push(`${bearer} ${request.method ?? ''} ${request.url ?? ''}`);

        if (request.method !== 'GET' || request.url !== '/api/v1/users/me') {
            response.writeHead(404).end();

            return;
        }

        const cold = coldCalls.get(bearer) ?? 0;

        if (cold > 0) {
            coldCalls.set(bearer, cold - 1);
            response.writeHead(503).end();

            return;
        }

        const paidFeatures = ENTITLEMENTS.get(bearer);
        const body = paidFeatures === undefined ? undefined : PROFILE_BODIES.get(paidFeatures);

        if (body === undefined) {
            response.writeHead(401, { 'content-type': 'application/json' }).end('{"message":"Unauthorized"}');

            return;
        }

        response.writeHead(200, { 'content-type': 'application/json' }).end(body);
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => {
        server.close(() => {
            resolve();
        });
    });
});

beforeEach(() => {
    coldCalls = new Map();
    traffic = [];
});

const check = (bearer: string) =>
    assertSignerEntitled(
        { identityOrigin: origin, signerEmail: `${bearer}@pool.test`, token: async () => bearer },
        { retry: { retries: 2, intervalMs: 10, attemptDeadlineMs: 1_000 } },
    );

describe('the signer preflight, over a real socket', () => {
    it('⛔ gives up on a server that accepts and never answers, within (retries + 1) x (deadline + interval)', async () => {
        const silent = createServer(() => undefined);

        await new Promise<void>((resolve) => {
            silent.listen(0, '127.0.0.1', resolve);
        });

        const retry = { retries: 1, intervalMs: 20, attemptDeadlineMs: 150 };
        const bound = (retry.retries + 1) * (retry.attemptDeadlineMs + retry.intervalMs);
        const started = Date.now();

        try {
            const failure = await assertSignerEntitled(
                {
                    identityOrigin: `http://127.0.0.1:${(silent.address() as AddressInfo).port}`,
                    signerEmail: 'silent@pool.test',
                    token: async () => 'granted-signer',
                },
                { retry },
            ).catch((error: unknown) => error);

            expect(failure).toBeInstanceOf(Error);
            expect(isSignerNotEntitledError(failure)).toBe(false);
            expect((failure as Error).message).toMatch(/did not complete/u);
            // Generous slack for a loaded CI box, still orders of magnitude under the ~300 s unbounded wait.
            expect(Date.now() - started).toBeLessThan(bound + 2_000);
        } finally {
            silent.closeAllConnections();
            await new Promise<void>((resolve) => {
                silent.close(() => {
                    resolve();
                });
            });
        }
    });

    it('passes an entitled signer, asking identity as that signer', async () => {
        await expect(check('granted-signer')).resolves.toBeUndefined();
        expect(traffic).toEqual(['granted-signer GET /api/v1/users/me']);
    });

    it.each(['upsell-signer', 'hidden-signer'])('⛔ refuses %s, with the poolAdmin fix', async (bearer) => {
        const failure = await check(bearer).catch((error: unknown) => error);

        expect(isSignerNotEntitledError(failure)).toBe(true);
        expect((failure as Error).message).toContain('poolAdmin --apply');
        expect((failure as Error).message).toContain(`${bearer}@pool.test`);
    });

    it('fails loudly, once, on an unknown bearer — identity refused, which is not "not entitled"', async () => {
        const failure = await check('nobody').catch((error: unknown) => error);

        expect(isSignerNotEntitledError(failure)).toBe(false);
        expect((failure as Error).message).toMatch(/answered 401/u);
        expect(traffic).toHaveLength(1);
    });

    it('waits out a cold identity task, then reads the answer', async () => {
        coldCalls.set('granted-signer', 2);

        await expect(check('granted-signer')).resolves.toBeUndefined();
        expect(traffic).toHaveLength(3);
    });
});
