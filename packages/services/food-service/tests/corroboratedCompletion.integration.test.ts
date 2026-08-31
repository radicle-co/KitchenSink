/**
 * U19 — R10's second clause over the booted Nest app + REAL Postgres: a PENDING catalog food whose
 * identity was CORROBORATED by independent corrections (the recipe side's promotion fires the trigger)
 * is marked complete and LEAVES the sync queue.
 *
 * What only this tier can prove: the status transition rides the same LEGAL_PRIORS gate every other
 * transition does, the queue + requester rows are really gone (the sync scan's candidate set is a real
 * table, not a flag), a single-correction food is untouched (corroboration is the trigger — the recipe
 * side only calls on a PROMOTION, and this asserts the food side grants nothing on its own), and an
 * already-synced food no-ops rather than erroring — the trigger is an async quality signal, not a
 * command.
 *
 * Auth follows `authoredFoodsApi.integration.test.ts`'s deterministic token → principal matrix.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken, ClerkVerificationError } from '@kitchensink/clerk-verify';

import { migrationsDir } from './support/db.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const mockVerify = vi.mocked(verifyClerkToken);

const USER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C4AA';

function principalFor(token: string): { sub: string; userId?: string; scopes: string[]; permissions: string[] } {
    if (token === 'user') {
        return { sub: 'user_1', userId: USER_ULID, scopes: [], permissions: [] };
    }

    throw new ClerkVerificationError();
}

describe.skipIf(!DATABASE_URL)('corroborated completion (booted Nest + real Postgres, U19)', () => {
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;

    async function call(method: string, path: string, token = 'user'): Promise<{ status: number; body: unknown }> {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { authorization: `Bearer ${token}` },
        });
        const text = await response.text();

        return { status: response.status, body: text ? JSON.parse(text) : undefined };
    }

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

        for (const file of readdirSync(migrationsDir)
            .filter((name) => name.endsWith('.sql'))
            .sort()) {
            await pool.query(readFileSync(join(migrationsDir, file), 'utf-8'));
        }

        process.env['DATABASE_URL'] = DATABASE_URL;
        process.env['USDA_API_KEY'] = 'integration-dummy-key';
        process.env['CLERK_JWT_KEY'] = 'PEM';
        process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://app.example.com';
        process.env['NODE_ENV'] = 'test';

        const { AppModule } = await import('../src/app.module.js');
        app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
        await app.listen(0);
        const address = app.getHttpServer().address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await app?.close();
        await pool?.end();
    });

    beforeEach(async () => {
        await pool.query(`
            TRUNCATE food, food_sources, nutrient, food_nutrients, food_portions, food_field_provenance,
                     food_candidates, fetch_queue, fetch_requesters RESTART IDENTITY CASCADE
        `);
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    /** Seed one PENDING food sitting in the sync queue with a demand row — the R10 add-by-name shape. */
    async function seedPending(id: string, name: string): Promise<void> {
        await pool.query(`INSERT INTO food (id, name, normalized_name, status) VALUES ($1, $2, lower($2), 'PENDING')`, [
            id,
            name,
        ]);
        await pool.query(`INSERT INTO fetch_queue (food_id, status) VALUES ($1, 'pending')`, [id]);
        await pool.query(`INSERT INTO fetch_requesters (food_id, requester_id) VALUES ($1, $2)`, [id, USER_ULID]);
    }

    const FOOD_ID = '01JZ19PENDNGF00D0000000001';

    it('completes a PENDING food and removes it from the sync scan’s candidate set', async () => {
        await seedPending(FOOD_ID, 'grandma spice blend');

        const result = await call('POST', `/api/v1/foods/${FOOD_ID}/corroborated`);

        expect(result.status).toBe(200);
        expect(result.body).toEqual({ id: FOOD_ID, status: 'RESOLVED' });

        const food = await pool.query(`SELECT status FROM food WHERE id = $1`, [FOOD_ID]);

        expect(food.rows[0]?.status).toBe('RESOLVED');

        // ⛔ LEAVES the queue — both halves. The sync scan reads `fetch_queue`; the requester rows are the
        // demand ledger `resolve` clears with it.
        const queue = await pool.query(`SELECT count(*)::int AS n FROM fetch_queue WHERE food_id = $1`, [FOOD_ID]);
        const requesters = await pool.query(`SELECT count(*)::int AS n FROM fetch_requesters WHERE food_id = $1`, [
            FOOD_ID,
        ]);

        expect(queue.rows[0]?.n).toBe(0);
        expect(requesters.rows[0]?.n).toBe(0);
    });

    it('an already-synced (RESOLVED) food is UNTOUCHED — the trigger no-ops, never errors', async () => {
        await pool.query(
            `INSERT INTO food (id, name, normalized_name, status) VALUES ($1, 'kale', 'kale', 'RESOLVED')`,
            [FOOD_ID],
        );

        const result = await call('POST', `/api/v1/foods/${FOOD_ID}/corroborated`);

        expect(result.status).toBe(200);
        expect(result.body).toEqual({ id: FOOD_ID, status: 'RESOLVED' });
    });

    it('an UNRESOLVED (awaiting disambiguation) food is untouched too — corroboration completes PENDING only', async () => {
        await pool.query(
            `INSERT INTO food (id, name, normalized_name, status) VALUES ($1, 'split', 'split', 'UNRESOLVED')`,
            [FOOD_ID],
        );
        await pool.query(`INSERT INTO fetch_queue (food_id, status) VALUES ($1, 'pending')`, [FOOD_ID]);

        const result = await call('POST', `/api/v1/foods/${FOOD_ID}/corroborated`);

        expect(result.status).toBe(200);
        expect(result.body).toEqual({ id: FOOD_ID, status: 'UNRESOLVED' });

        const queue = await pool.query(`SELECT count(*)::int AS n FROM fetch_queue WHERE food_id = $1`, [FOOD_ID]);

        expect(queue.rows[0]?.n).toBe(1);
    });

    it('an unknown food answers 404; a malformed id answers 400; unauthenticated answers 401', async () => {
        expect((await call('POST', `/api/v1/foods/01JZ19N0SXCHF00D0000000001/corroborated`)).status).toBe(404);
        expect((await call('POST', `/api/v1/foods/not-a-ulid/corroborated`)).status).toBe(400);

        const unauthenticated = await fetch(`${baseUrl}/api/v1/foods/${FOOD_ID}/corroborated`, { method: 'POST' });

        expect(unauthenticated.status).toBe(401);
    });
});
