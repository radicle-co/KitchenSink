/**
 * Full-stack e2e for the auth-layer DoS protection (T-054, FR-052/SC-009/SC-011) against the REAL
 * booted food service with the REAL `FoodAuthGuard` → `@kitchensink/clerk-verify` (genuinely-signed
 * RS256 tokens). Under an invalid-token flood the guard must SHED with `503` once a source crosses the
 * per-source `401`-rate cap — so the CPU-bound signature verifier is not saturated and SC-011 (≤10ms
 * p95) holds under flood — while a DIFFERENT source's valid token is unaffected (per-source isolation).
 *
 * The shed threshold is lowered via env so the flood stays tiny + deterministic.
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
const validToken = mintToken(keypair.privateKeyPem, { sub: 'user_dos', azp: APP_AZP });

const SHED_THRESHOLD = 5;

describe.skipIf(!DATABASE_URL)('auth-layer DoS load-shed (e2e, FR-052/SC-011)', () => {
    let app: INestApplication;
    let baseUrl: string;

    /** Issue a GET with a bearer token and a simulated source IP (X-Forwarded-For). */
    async function get(path: string, token: string, sourceIp: string): Promise<number> {
        const response = await fetch(`${baseUrl}${path}`, {
            method: 'GET',
            headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': sourceIp },
        });
        await response.text();

        return response.status;
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
        // and fail closed with 401.
        for (let i = 0; i < SHED_THRESHOLD; i += 1) {
            expect(await get('/api/v1/foods/search?query=x', 'not-a-valid-jwt', flooder)).toBe(401);
        }

        // Past the cap, the flooder is shed with 503 WITHOUT a signature check (verifier protected).
        expect(await get('/api/v1/foods/search?query=x', 'not-a-valid-jwt', flooder)).toBe(503);
        expect(await get('/api/v1/foods/search?query=x', validToken, flooder)).toBe(503); // even a valid token, while shedding

        // Per-source isolation: an innocent source's VALID token still succeeds (200) under the flood.
        expect(await get('/api/v1/foods/search?query=x', validToken, innocent)).toBe(200);
    });
});
