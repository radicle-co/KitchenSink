/**
 * Full-stack e2e for the auth-layer DoS protection (T-054, FR-052/SC-009/SC-011) against the REAL
 * booted food service with the REAL `FoodAuthGuard` → `@kitchensink/clerk-verify` (genuinely-signed
 * RS256 tokens). Under an invalid-token flood the guard must SHED with `503` once a source crosses the
 * per-source `401`-rate cap — so the CPU-bound signature verifier is not saturated and SC-011 (≤10ms
 * p95) holds under flood — while a DIFFERENT source's valid token is unaffected (per-source isolation).
 *
 * The shed threshold is lowered via env so the flood stays tiny + deterministic.
 *
 * ⚠️ **Every assertion here names the LAYER that answered, not just a status number** (repaired 2026-09-03).
 * This suite previously compared bare status codes, which made a `401` from the guard indistinguishable from a
 * `401` raised further in — and that is exactly how it rotted: U11 (`42d82783`) made
 * `GET /api/v1/foods/search` resolve a requester key, so this suite's `validToken` — the ONLY one in
 * `tests/e2e` minted without an `external_id` — started answering `401 IDENTITY_SYNC_PENDING` from the
 * CONTROLLER while the shedder under test was working perfectly. The failure read `expected 401 to be 200`
 * and named nothing. Asserting `{ status, code }` makes the guard's `UNAUTHORIZED`, the shedder's
 * `SERVICE_UNAVAILABLE` and a served request three distinguishable outcomes, so the next contract change
 * downstream of the guard fails HERE with its own name on it instead of masquerading as a shedder bug.
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateClerkKeypair, mintToken } from '../support/jwt.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const APP_AZP = 'https://app.example.com';
const keypair = generateClerkKeypair();
// CR-002/U1: EVERY `/api/v1/foods/*` route resolves a requester key from the token's `external_id` — reads
// included, since U11 scopes a caller's own authored foods into `search`. A token without it is a legitimate
// `401 IDENTITY_SYNC_PENDING`, so it is not the "valid token" this suite needs to observe the shedder.
const validToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_dos',
    externalId: '01J9ZK8N7QF3B2X4M6T0V5C1AB',
    azp: APP_AZP,
});

const SHED_THRESHOLD = 5;

/** What a route answered: the status plus the envelope `code` that says WHICH layer produced it. */
interface Answer {
    readonly status: number;
    /** The error envelope's published `code`; `undefined` on a success (no envelope). */
    readonly code: string | undefined;
}

/** The guard fails a token closed — `UnauthorizedException` before `next()` (FR-035/FR-040). */
const GUARD_REJECTED: Answer = { status: 401, code: 'UNAUTHORIZED' };
/** The shedder refuses the request pre-verification — `ServiceUnavailableException` (FR-052). */
const LOAD_SHED: Answer = { status: 503, code: 'SERVICE_UNAVAILABLE' };
/** The request was verified, admitted, and served by the controller. */
const SERVED: Answer = { status: 200, code: undefined };

describe.skipIf(!DATABASE_URL)('auth-layer DoS load-shed (e2e, FR-052/SC-011)', () => {
    let app: INestApplication;
    let baseUrl: string;

    /**
     * Issue a GET with a bearer token and a simulated source IP (X-Forwarded-For).
     *
     * @returns The status AND the envelope `code`, so an assertion names the layer that answered.
     * @sideEffect Performs an HTTP request against the booted app.
     */
    async function get(path: string, token: string, sourceIp: string): Promise<Answer> {
        const response = await fetch(`${baseUrl}${path}`, {
            method: 'GET',
            headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': sourceIp },
        });
        const body = (await response.json()) as { code?: string };

        return { status: response.status, code: body.code };
    }

    beforeAll(async () => {
        process.env['DATABASE_URL'] = DATABASE_URL;
        process.env['USDA_API_KEY'] = 'e2e-stub-key';
        process.env['CLERK_JWT_KEY'] = keypair.publicKeyPem;
        process.env['CLERK_AUTHORIZED_PARTIES'] = APP_AZP;
        process.env['FOOD_AUTH_SHED_THRESHOLD'] = String(SHED_THRESHOLD);
        process.env['FOOD_AUTH_SHED_WINDOW_MS'] = '60000';
        process.env['NODE_ENV'] = 'test';

        const { AppModule } = await import('../../src/app.module.js');
        app = await NestFactory.create(AppModule, { logger: false });
        await app.listen(0);
        const address = app.getHttpServer().address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await app?.close();
    });

    it('sheds a flooding source with 503 past the 401-rate cap, while a different source is unaffected', async () => {
        const flooder = '203.0.113.50';
        const innocent = '198.51.100.7';

        // The flood: well-formed-but-invalid tokens from one source. The first `threshold` are verified
        // and fail closed with 401 — from the GUARD, which is what makes them count toward the cap.
        for (let i = 0; i < SHED_THRESHOLD; i += 1) {
            expect(await get('/api/v1/foods/search?query=x', 'not-a-valid-jwt', flooder)).toEqual(GUARD_REJECTED);
        }

        // Past the cap, the flooder is shed with 503 WITHOUT a signature check (verifier protected).
        expect(await get('/api/v1/foods/search?query=x', 'not-a-valid-jwt', flooder)).toEqual(LOAD_SHED);
        expect(await get('/api/v1/foods/search?query=x', validToken, flooder)).toEqual(LOAD_SHED); // even a valid token, while shedding

        // Per-source isolation: an innocent source's VALID token is still SERVED under the flood.
        expect(await get('/api/v1/foods/search?query=x', validToken, innocent)).toEqual(SERVED);
    });

    /**
     * The bucket key is the leftmost `X-Forwarded-For` hop and the ALB APPENDS to that header, so the key is
     * CALLER-CHOSEN: an attacker rotates it every request and never trips the per-source cap. That is the
     * shape that turned the shedder's own bookkeeping into an unauthenticated memory-exhaustion vector
     * (finding 02.F-F1 / 08.F-SEC1). Over real HTTP this asserts the two properties that survive key
     * rotation: every request still FAILS CLOSED with 401 rather than degrading to a 5xx, and a legitimate
     * caller behind it is still served. The cardinality bound itself is not observable from outside the
     * process and is asserted in `src/auth/__tests__/AuthLoadShedder.test.ts`.
     */
    it('stays correct and responsive under a flood that rotates its source key every request', async () => {
        for (let i = 0; i < 200; i += 1) {
            expect(await get('/api/v1/foods/search?query=x', 'not-a-valid-jwt', `192.0.2.${i % 256}-${i}`)).toEqual(
                GUARD_REJECTED,
            );
        }

        expect(await get('/api/v1/foods/search?query=x', validToken, '198.51.100.9')).toEqual(SERVED);
    });
});
