/**
 * HTTP integration test for the food service-principal internal erasure route (CR-002 / U4b / R11), driven
 * over the booted Nest app against a REAL Postgres (`DATABASE_URL`). This is the food mirror of
 * recipe-service's U4a `service-erasure.integration.spec.ts`.
 *
 * It proves the FULL wired stack — routing, the {@link FoodServiceErasureGuard}, the REAL `jose`
 * verification (against a genuinely-signed Ed25519 token; no auth mocks), and {@link UserErasureService}
 * over real rows — behaves as the completion contract requires:
 *  - a valid, single-target food-audience token erases EXACTLY the bound owner's `fetch_requesters` rows
 *    and returns the removed-row count (the reconciliation residue signal); other users survive;
 *  - the erase is idempotent (a second call removes 0);
 *  - the security GATE holds over HTTP: no bearer, a recipe-audience token (cross-service replay), and a
 *    forged token are each `401` with NO data touched.
 *
 * The route is NOT behind the Clerk `FoodAuthGuard` (that middleware is mounted only on the foods
 * controllers), so no Clerk mock is needed — its guard is the service-principal verifier alone.
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { ulid } from 'ulidx';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SERVICE_ERASURE_TOKEN_AUDIENCE } from '@kitchensink/recipe-core';

import { DATABASE_URL, resetSchema } from './support/db.js';
import { generateServiceKeypair, signServiceErasureToken, type ServiceKeypair } from './support/service-token.js';

const OWNER = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
const OTHER = '01J9ZK8N7QF3B2X4M6T0V5C1AD';

describe.skipIf(!DATABASE_URL)('POST /v1/internal/account/erasure (booted Nest + real Postgres)', () => {
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;
    let keys: ServiceKeypair;

    const post = async (token?: string): Promise<{ status: number; body: unknown }> => {
        const headers: Record<string, string> = {};
        if (token) {
            headers['authorization'] = `Bearer ${token}`;
        }
        const response = await fetch(`${baseUrl}/v1/internal/account/erasure`, { method: 'POST', headers });
        const text = await response.text();

        return { status: response.status, body: text ? JSON.parse(text) : undefined };
    };

    /** Seed a food + one `fetch_requesters` row for `requesterId`. */
    const seedRequester = async (name: string, requesterId: string): Promise<void> => {
        const id = ulid();
        await pool.query(
            `INSERT INTO food (id, name, normalized_name, status) VALUES ($1, $2, $3, 'PENDING'::food_status)`,
            [id, name, name.toLowerCase()],
        );
        await pool.query(`INSERT INTO fetch_requesters (food_id, requester_id) VALUES ($1, $2)`, [id, requesterId]);
    };

    const requesterRows = async (requesterId: string): Promise<number> => {
        const { rows } = await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM fetch_requesters WHERE requester_id = $1`,
            [requesterId],
        );

        return rows[0]!.n;
    };

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await resetSchema(pool);

        keys = await generateServiceKeypair();

        process.env['DATABASE_URL'] = DATABASE_URL;
        process.env['USDA_API_KEY'] = 'integration-dummy-key';
        process.env['CLERK_JWT_KEY'] = 'PEM';
        process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://app.example.com';
        process.env['NODE_ENV'] = 'test';
        // The verifier reads this at construction (app boot) — set it BEFORE NestFactory.create.
        process.env['FOOD_SERVICE_PRINCIPAL_JWT_KEY'] = keys.publicKeyPem;

        const { AppModule } = await import('../src/app.module.js');
        app = await NestFactory.create(AppModule, { logger: false });
        await app.listen(0);
        baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await app?.close();
        await pool?.end();
    });

    beforeEach(async () => {
        await pool.query('TRUNCATE food, fetch_requesters RESTART IDENTITY CASCADE');
    });

    it('erases EXACTLY the bound owner`s fetch_requesters and returns the removed count; others survive', async () => {
        await seedRequester('apple', OWNER);
        await seedRequester('pear', OWNER);
        await seedRequester('kale', OTHER);

        const token = await signServiceErasureToken(keys.privateKeyPem, { ownerId: OWNER });
        const res = await post(token);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ requesterId: OWNER, deletedRequesterRows: 2 });
        expect(await requesterRows(OWNER)).toBe(0);
        expect(await requesterRows(OTHER)).toBe(1);
    });

    it('is idempotent: a second erase of the same owner removes 0 rows (the reconciliation clean signal)', async () => {
        await seedRequester('apple', OWNER);
        const token = await signServiceErasureToken(keys.privateKeyPem, { ownerId: OWNER });

        expect((await post(token)).body).toEqual({ requesterId: OWNER, deletedRequesterRows: 1 });
        // A fresh token (single-use) for the same owner.
        const token2 = await signServiceErasureToken(keys.privateKeyPem, { ownerId: OWNER });
        expect((await post(token2)).body).toEqual({ requesterId: OWNER, deletedRequesterRows: 0 });
    });

    it('rejects a request with NO bearer (401) — no data touched', async () => {
        await seedRequester('apple', OWNER);

        expect((await post()).status).toBe(401);
        expect(await requesterRows(OWNER)).toBe(1);
    });

    it('rejects a token minted for the RECIPE audience (cross-service replay) with 401 — no data touched', async () => {
        await seedRequester('apple', OWNER);
        const recipeToken = await signServiceErasureToken(keys.privateKeyPem, {
            ownerId: OWNER,
            audience: SERVICE_ERASURE_TOKEN_AUDIENCE,
        });

        expect((await post(recipeToken)).status).toBe(401);
        expect(await requesterRows(OWNER)).toBe(1);
    });

    it('rejects a FORGED token signed by an untrusted key with 401 — no data touched', async () => {
        await seedRequester('apple', OWNER);
        const untrusted = await generateServiceKeypair();
        const forged = await signServiceErasureToken(untrusted.privateKeyPem, { ownerId: OWNER });

        expect((await post(forged)).status).toBe(401);
        expect(await requesterRows(OWNER)).toBe(1);
    });
});
