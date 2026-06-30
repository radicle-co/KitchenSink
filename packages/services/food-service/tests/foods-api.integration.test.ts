/**
 * Per-endpoint + auth-matrix HTTP integration tests for the source-agnostic `/v1/foods/*` API, driven
 * over the booted Nest app against a REAL Postgres (`DATABASE_URL`). Re-added in Phase 3/4 (T-130–T-145)
 * to replace the superseded fdcId-keyed `foods-api.integration.test` parked in the prior slice.
 *
 * `@kitchensink/clerk-verify` is mocked so the auth matrix is deterministic (no real Clerk JWT): a token
 * string maps to a verified principal, an unknown token throws (→ 401). `@kitchensink/usda-client` is
 * mocked so `PATCH`-resolve re-fetches a canned candidate without a real USDA call. Everything else —
 * routing, the guard, the DAOs, the merge/persist, the enqueue, backpressure — is the real wired stack.
 *
 * Boot config: `FOOD_MAX_QUEUE_DEPTH=10`, `FOOD_DEMOTE_THRESHOLD=2` (backpressure/flood-shed),
 * `USDA_RATE_LIMIT_PER_HOUR=5` (resolve rolling-window cap). The guard reads `CLERK_JWT_KEY` at boot.
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { ulid } from 'ulidx';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

vi.mock('@kitchensink/usda-client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/usda-client')>();

    class FakeUsdaApiClient {
        public async searchFoods(): Promise<{ foods: unknown[] }> {
            return { foods: [] };
        }

        public async getFood(fdcId: number): Promise<Record<string, unknown>> {
            return {
                fdcId,
                description: fdcId === 171688 ? 'Broccoli, raw' : 'Broccoli, cooked, boiled',
                dataType: 'Foundation',
                brandOwner: null,
                brandName: null,
                gtinUpc: null,
                foodNutrients: [{ nutrientName: 'Protein', unitName: 'g', value: 2.8 }],
                publicationDate: '2021-05-01',
                raw: {},
            };
        }

        public async getFoodsBatch(): Promise<unknown[]> {
            return [];
        }
    }

    return { ...actual, UsdaApiClient: FakeUsdaApiClient };
});

import { ClerkVerificationError, verifyClerkToken } from '@kitchensink/clerk-verify';

const mockVerify = vi.mocked(verifyClerkToken);

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');

/** Token → principal map for the deterministic auth matrix; an unknown token throws (→ 401). */
function principalFor(token: string): { sub: string; azp?: string; scopes: string[]; permissions: string[] } {
    switch (token) {
        case 'user':
            return { sub: 'user_1', scopes: [], permissions: [] };
        case 'admin':
            return { sub: 'admin_1', scopes: ['food:admin'], permissions: [] };
        case 'm2m':
            return { sub: 'svc_import', azp: 'svc-client', scopes: [], permissions: [] };
        case 'flooder':
            return { sub: 'flooder', scopes: [], permissions: [] };
        default:
            throw new ClerkVerificationError();
    }
}

describe.skipIf(!DATABASE_URL)('/v1/foods/* HTTP API (booted Nest + real Postgres)', () => {
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;

    /** Issue a request; omit `token` for an unauthenticated call. */
    async function call(
        method: string,
        path: string,
        opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
    ): Promise<{ status: number; body: unknown; headers: Headers }> {
        const headers: Record<string, string> = { ...opts.headers };

        if (opts.token) {
            headers['authorization'] = `Bearer ${opts.token}`;
        }

        if (opts.body !== undefined) {
            headers['content-type'] = 'application/json';
        }

        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers,
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        });
        const text = await response.text();

        return { status: response.status, body: text ? JSON.parse(text) : undefined, headers: response.headers };
    }

    /** Seed a bare `food` row at a given status; returns its id. */
    async function seedFood(status: string, name: string): Promise<string> {
        const id = ulid();
        await pool.query(
            `INSERT INTO food (id, name, normalized_name, status, tombstoned_at)
             VALUES ($1, $2, $3, $4::food_status, CASE WHEN $4 IN ('NOT_FOUND','FAILED') THEN now() ELSE NULL END)`,
            [id, name, name.trim().toLowerCase(), status],
        );

        return id;
    }

    /** Seed a full RESOLVED golden record (food + crosswalk + nutrient + value + field provenance). */
    async function seedResolved(name: string, externalKey = '171688'): Promise<string> {
        const id = await seedFood('RESOLVED', name);
        const sourceId = ulid();
        const nutrientId = ulid();
        await pool.query(`INSERT INTO food_sources (id, food_id, source, external_key) VALUES ($1, $2, 'usda', $3)`, [
            sourceId,
            id,
            externalKey,
        ]);
        // The nutrient dictionary is shared (one row per (name, unit)); upsert + resolve the id so
        // seeding several RESOLVED foods does not collide on nutrient_name_unit_unique.
        const dict = await pool.query<{ id: string }>(
            `INSERT INTO nutrient (id, name, unit) VALUES ($1, 'Protein', 'g')
             ON CONFLICT (name, unit) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
            [nutrientId],
        );
        await pool.query(
            `INSERT INTO food_nutrients (id, food_id, nutrient_id, amount, basis, source_id)
             VALUES ($1, $2, $3, '2.8', 'per_100g', $4)`,
            [ulid(), id, dict.rows[0]!.id, sourceId],
        );
        await pool.query(`INSERT INTO food_field_provenance (food_id, field, source_id) VALUES ($1, 'name', $2)`, [
            id,
            sourceId,
        ]);

        return id;
    }

    /** Seed an UNRESOLVED food with a candidate set; returns the food id + candidate ids. */
    async function seedUnresolved(name: string): Promise<{ id: string; candidateIds: string[] }> {
        const id = await seedFood('UNRESOLVED', name);
        const c1 = ulid();
        const c2 = ulid();
        await pool.query(
            `INSERT INTO food_candidates (id, food_id, source, external_key, name, summary) VALUES
             ($1, $2, 'usda', '171688', 'Broccoli, raw', '34 kcal/100g'),
             ($3, $2, 'usda', '170379', 'Broccoli, cooked, boiled', '35 kcal/100g')`,
            [c1, id, c2],
        );

        return { id, candidateIds: [c1, c2] };
    }

    /** Seed `count` pending queue rows all requested by `sub` (backpressure fixtures). */
    async function seedPendingQueue(count: number, sub: string): Promise<void> {
        for (let i = 0; i < count; i += 1) {
            const id = await seedFood('PENDING', `pending food ${sub} ${i}`);
            await pool.query(`INSERT INTO fetch_queue (food_id, status) VALUES ($1, 'pending')`, [id]);
            await pool.query(`INSERT INTO fetch_requesters (food_id, sub) VALUES ($1, $2)`, [id, sub]);
        }
    }

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
        await pool.query(readFileSync(join(migrationsDir, '0000_food_schema.sql'), 'utf-8'));

        process.env['DATABASE_URL'] = DATABASE_URL;
        process.env['USDA_API_KEY'] = 'integration-dummy-key';
        process.env['USDA_RATE_LIMIT_PER_HOUR'] = '5';
        process.env['CLERK_JWT_KEY'] = 'PEM';
        process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://app.example.com';
        process.env['FOOD_MAX_QUEUE_DEPTH'] = '10';
        process.env['FOOD_DEMOTE_THRESHOLD'] = '2';
        process.env['NODE_ENV'] = 'test';

        const { AppModule } = await import('../src/app.module.js');
        app = await NestFactory.create(AppModule, { logger: false });
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
                     food_category, food_category_assignment, food_candidates, fetch_queue, fetch_requesters,
                     source_call_log, source_sync_metadata RESTART IDENTITY CASCADE
        `);
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    // ── Auth matrix (T-033/T-047/T-048) ───────────────────────────────────────────────────────────
    describe('auth gate', () => {
        it('rejects a request with no token (401) before any work (FR-035)', async () => {
            const res = await call('GET', `/v1/foods/${ulid()}`);
            expect(res.status).toBe(401);
        });

        it('rejects an invalid/expired/wrong-azp token (401)', async () => {
            const res = await call('GET', `/v1/foods/${ulid()}`, { token: 'garbage' });
            expect(res.status).toBe(401);
        });

        it('does NOT create a row or enqueue for an unauthenticated POST (401, no side effects)', async () => {
            const res = await call('POST', '/v1/foods', { body: { name: 'broccoli' } });
            expect(res.status).toBe(401);

            const rows = await pool.query('SELECT count(*)::int AS n FROM food');
            expect(rows.rows[0].n).toBe(0);
            const queue = await pool.query('SELECT count(*)::int AS n FROM fetch_queue');
            expect(queue.rows[0].n).toBe(0);
        });

        it('ignores a forged x-debug-sub / x-authorizer-context and uses the verified sub for provenance', async () => {
            const res = await call('POST', '/v1/foods', {
                token: 'user',
                body: { name: 'forge test' },
                headers: { 'x-debug-sub': 'forged_admin', 'x-authorizer-context': '{"sub":"forged_admin"}' },
            });
            expect(res.status).toBe(202);

            const requesters = await pool.query('SELECT sub FROM fetch_requesters');
            expect(requesters.rows.map((r) => r.sub)).toEqual(['user_1']);
        });

        it('accepts an azp-allowlisted M2M token (not 401) (FR-047)', async () => {
            const res = await call('POST', '/v1/foods', { token: 'm2m', body: { name: 'service add' } });
            expect(res.status).toBe(202);

            const requesters = await pool.query('SELECT sub FROM fetch_requesters');
            expect(requesters.rows.map((r) => r.sub)).toEqual(['svc_import']);
        });

        it('enforces precedence 401 > 400: a malformed id with a bad token → 401 (not 400)', async () => {
            const res = await call('GET', '/v1/foods/not-a-ulid', { token: 'garbage' });
            expect(res.status).toBe(401);
        });

        it('enforces precedence 403 > 400 on /refetch: valid token w/o scope + malformed id → 403', async () => {
            const res = await call('POST', '/v1/foods/not-a-ulid/refetch', { token: 'user' });
            expect(res.status).toBe(403);
        });
    });

    // ── GET /v1/foods/{id} (T-131) ─────────────────────────────────────────────────────────────────
    describe('GET /v1/foods/{id}', () => {
        it('returns 200 + the golden record (no source call) for a RESOLVED food', async () => {
            const id = await seedResolved('Broccoli, raw');

            const res = await call('GET', `/v1/foods/${id}`, { token: 'user' });

            expect(res.status).toBe(200);
            const body = res.body as {
                id: string;
                status: string;
                nutrients: unknown[];
                provenance: Record<string, string>;
            };
            expect(body.id).toBe(id);
            expect(body.status).toBe('RESOLVED');
            expect(body.nutrients).toEqual([
                { nutrient: 'Protein', amount: 2.8, unit: 'g', basis: 'per_100g', source: 'usda' },
            ]);
            expect(body.provenance).toEqual({ name: 'usda' });
            expect(JSON.stringify(body)).not.toContain('fdcId');
        });

        it('returns 202 for a PENDING food', async () => {
            const id = await seedFood('PENDING', 'pending food');
            const res = await call('GET', `/v1/foods/${id}`, { token: 'user' });
            expect(res.status).toBe(202);
            expect((res.body as { status: string }).status).toBe('PENDING');
        });

        it('returns 202 for an UNRESOLVED food', async () => {
            const { id } = await seedUnresolved('broccoli');
            const res = await call('GET', `/v1/foods/${id}`, { token: 'user' });
            expect(res.status).toBe(202);
            expect((res.body as { status: string }).status).toBe('UNRESOLVED');
        });

        it('returns 404 with the status in the body for a NOT_FOUND food', async () => {
            const id = await seedFood('NOT_FOUND', 'ghost food');
            const res = await call('GET', `/v1/foods/${id}`, { token: 'user' });
            expect(res.status).toBe(404);
            expect((res.body as { status: string }).status).toBe('NOT_FOUND');
        });

        it('returns 404 for a FAILED food', async () => {
            const id = await seedFood('FAILED', 'failed food');
            const res = await call('GET', `/v1/foods/${id}`, { token: 'user' });
            expect(res.status).toBe(404);
            expect((res.body as { status: string }).status).toBe('FAILED');
        });

        it('returns 404 for an unknown id', async () => {
            const res = await call('GET', `/v1/foods/${ulid()}`, { token: 'user' });
            expect(res.status).toBe(404);
        });

        it('returns 400 for a malformed ULID (with a valid token)', async () => {
            const res = await call('GET', '/v1/foods/not-a-ulid', { token: 'user' });
            expect(res.status).toBe(400);
        });
    });

    // ── GET /v1/foods/{id}/status (T-132) ──────────────────────────────────────────────────────────
    describe('GET /v1/foods/{id}/status', () => {
        it('returns the status + golden record for a RESOLVED food', async () => {
            const id = await seedResolved('Broccoli, raw');
            const res = await call('GET', `/v1/foods/${id}/status`, { token: 'user' });
            expect(res.status).toBe(200);
            const body = res.body as { status: string; food?: unknown };
            expect(body.status).toBe('RESOLVED');
            expect(body.food).toBeDefined();
        });

        it('returns the status (no food) for a PENDING food and 404 for an unknown id', async () => {
            const id = await seedFood('PENDING', 'pending poll');
            const ok = await call('GET', `/v1/foods/${id}/status`, { token: 'user' });
            expect(ok.status).toBe(200);
            expect((ok.body as { status: string; food?: unknown }).food).toBeUndefined();

            const missing = await call('GET', `/v1/foods/${ulid()}/status`, { token: 'user' });
            expect(missing.status).toBe(404);
        });
    });

    // ── GET /v1/foods/{id}/candidates (T-133) ──────────────────────────────────────────────────────
    describe('GET /v1/foods/{id}/candidates', () => {
        it('lists the candidate set for an UNRESOLVED food (no fdcId)', async () => {
            const { id } = await seedUnresolved('broccoli');
            const res = await call('GET', `/v1/foods/${id}/candidates`, { token: 'user' });
            expect(res.status).toBe(200);
            const body = res.body as { candidates: { source: string; externalKey: string }[] };
            expect(body.candidates).toHaveLength(2);
            expect(body.candidates[0].source).toBe('usda');
            expect(JSON.stringify(body)).not.toContain('fdcId');
        });

        it('returns an empty candidate set for a RESOLVED food', async () => {
            const id = await seedResolved('Broccoli, raw');
            const res = await call('GET', `/v1/foods/${id}/candidates`, { token: 'user' });
            expect(res.status).toBe(200);
            expect((res.body as { candidates: unknown[] }).candidates).toEqual([]);
        });
    });

    // ── GET /v1/foods/search (T-134) ───────────────────────────────────────────────────────────────
    describe('GET /v1/foods/search', () => {
        it('returns ranked matches and never an unrelated food', async () => {
            await seedResolved('Chicken breast, raw', '1');
            await seedResolved('Chicken thigh, raw', '2');
            await seedResolved('Beef steak', '3');

            const res = await call('GET', '/v1/foods/search?query=chicken%20breast', { token: 'user' });
            expect(res.status).toBe(200);
            const names = (res.body as { results: { name: string }[] }).results.map((r) => r.name);
            expect(names).toContain('Chicken breast, raw');
            expect(names).not.toContain('Beef steak');
        });

        it('fuzzy-matches a misspelled query (avacado → Avocado, raw)', async () => {
            await seedResolved('Avocado, raw', '10');
            await seedResolved('Banana, raw', '11');
            const res = await call('GET', '/v1/foods/search?query=avacado', { token: 'user' });
            const names = (res.body as { results: { name: string }[] }).results.map((r) => r.name);
            expect(names).toContain('Avocado, raw');
        });

        it('resolves a known external_key crosswalk to the food id, and empty for no match', async () => {
            const id = await seedResolved('Broccoli, raw', '171688');
            const cross = await call('GET', '/v1/foods/search?query=171688', { token: 'user' });
            expect((cross.body as { results: { id: string }[] }).results.map((r) => r.id)).toContain(id);

            const none = await call('GET', '/v1/foods/search?query=zzzznotathing', { token: 'user' });
            expect((none.body as { results: unknown[] }).results).toEqual([]);
        });
    });

    // ── POST /v1/foods (T-140) ─────────────────────────────────────────────────────────────────────
    describe('POST /v1/foods', () => {
        it('adds by name → 202 + id, with exactly one fetch_queue row', async () => {
            const res = await call('POST', '/v1/foods', { token: 'user', body: { name: 'Broccoli' } });
            expect(res.status).toBe(202);
            const body = res.body as { id: string; status: string };
            expect(body.status).toBe('PENDING');

            const queue = await pool.query('SELECT count(*)::int AS n FROM fetch_queue WHERE food_id = $1', [body.id]);
            expect(queue.rows[0].n).toBe(1);
        });

        it('dedups a concurrent re-add of the same normalized name to one row/id', async () => {
            const first = await call('POST', '/v1/foods', { token: 'user', body: { name: 'Spinach' } });
            const second = await call('POST', '/v1/foods', { token: 'user', body: { name: '  spinach ' } });
            expect((first.body as { id: string }).id).toBe((second.body as { id: string }).id);

            const foods = await pool.query('SELECT count(*)::int AS n FROM food');
            expect(foods.rows[0].n).toBe(1);
        });

        it('rejects an empty/whitespace name with 400, nothing enqueued', async () => {
            const res = await call('POST', '/v1/foods', { token: 'user', body: { name: '   ' } });
            expect(res.status).toBe(400);
            const foods = await pool.query('SELECT count(*)::int AS n FROM food');
            expect(foods.rows[0].n).toBe(0);
        });
    });

    // ── POST /v1/foods/batch (T-143) ───────────────────────────────────────────────────────────────
    describe('POST /v1/foods/batch', () => {
        it('returns a per-item partial: inline RESOLVED hits + PENDING misses', async () => {
            await seedResolved('Chicken breast, raw', '1');

            const res = await call('POST', '/v1/foods/batch', {
                token: 'user',
                body: { names: ['Chicken breast, raw', 'Quinoa', 'Lentils'] },
            });
            expect(res.status).toBe(201);
            const items = (res.body as { items: { status: string }[] }).items;
            expect(items.filter((i) => i.status === 'RESOLVED')).toHaveLength(1);
            expect(items.filter((i) => i.status === 'PENDING')).toHaveLength(2);
        });

        it('collapses an intra-batch duplicate name to one item', async () => {
            const res = await call('POST', '/v1/foods/batch', {
                token: 'user',
                body: { names: ['Kale', 'kale', '  KALE '] },
            });
            expect((res.body as { items: unknown[] }).items).toHaveLength(1);
        });

        it('rejects a batch over 100 names with 400, nothing enqueued', async () => {
            const names = Array.from({ length: 101 }, (_, i) => `food ${i}`);
            const res = await call('POST', '/v1/foods/batch', { token: 'user', body: { names } });
            expect(res.status).toBe(400);
            const foods = await pool.query('SELECT count(*)::int AS n FROM food');
            expect(foods.rows[0].n).toBe(0);
        });
    });

    // ── PATCH /v1/foods/{id} (T-142) ───────────────────────────────────────────────────────────────
    describe('PATCH /v1/foods/{id}', () => {
        it('resolves from a valid pick → 200 RESOLVED and clears the candidate set', async () => {
            const { id, candidateIds } = await seedUnresolved('broccoli');

            const res = await call('PATCH', `/v1/foods/${id}`, {
                token: 'user',
                body: { candidateIds: [candidateIds[0]] },
            });
            expect(res.status).toBe(200);
            expect((res.body as { status: string }).status).toBe('RESOLVED');

            const food = await pool.query('SELECT status FROM food WHERE id = $1', [id]);
            expect(food.rows[0].status).toBe('RESOLVED');
            const remaining = await pool.query('SELECT count(*)::int AS n FROM food_candidates WHERE food_id = $1', [
                id,
            ]);
            expect(remaining.rows[0].n).toBe(0);
        });

        it('rejects a candidate not in the food set with 409, status unchanged', async () => {
            const { id } = await seedUnresolved('broccoli');
            const res = await call('PATCH', `/v1/foods/${id}`, { token: 'user', body: { candidateIds: [ulid()] } });
            expect(res.status).toBe(409);
            const food = await pool.query('SELECT status FROM food WHERE id = $1', [id]);
            expect(food.rows[0].status).toBe('UNRESOLVED');
        });

        it('is an idempotent 200 no-op on an already-RESOLVED food', async () => {
            const id = await seedResolved('Broccoli, raw');
            const res = await call('PATCH', `/v1/foods/${id}`, { token: 'user', body: { candidateIds: [ulid()] } });
            expect(res.status).toBe(200);
            expect((res.body as { status: string }).status).toBe('RESOLVED');
        });

        it('rejects a malformed body (no candidateIds) with 400', async () => {
            const { id } = await seedUnresolved('broccoli');
            const res = await call('PATCH', `/v1/foods/${id}`, { token: 'user', body: {} });
            expect(res.status).toBe(400);
        });

        it('returns 503 (not 429) when the rolling-window cap is exhausted; food stays UNRESOLVED (DSN-6)', async () => {
            const { id, candidateIds } = await seedUnresolved('broccoli');
            // Fill the USDA window to its hard cap (USDA_RATE_LIMIT_PER_HOUR=5) so tryRecord denies.
            await pool.query(
                `INSERT INTO source_call_log (source, called_at) SELECT 'usda', now() FROM generate_series(1, 5)`,
            );

            const res = await call('PATCH', `/v1/foods/${id}`, {
                token: 'user',
                body: { candidateIds: [candidateIds[0]] },
            });
            expect(res.status).toBe(503);
            expect(res.headers.get('retry-after')).toBeTruthy();
            const food = await pool.query('SELECT status FROM food WHERE id = $1', [id]);
            expect(food.rows[0].status).toBe('UNRESOLVED');
        });

        it('still proceeds at the 90% pause threshold (resolve is pause-exempt, TST-4)', async () => {
            const { id, candidateIds } = await seedUnresolved('broccoli');
            // Pause threshold = floor(5 * 0.9) = 4; seed 4 calls → paused but under the hard cap.
            await pool.query(
                `INSERT INTO source_call_log (source, called_at) SELECT 'usda', now() FROM generate_series(1, 4)`,
            );

            const res = await call('PATCH', `/v1/foods/${id}`, {
                token: 'user',
                body: { candidateIds: [candidateIds[0]] },
            });
            expect(res.status).toBe(200);
            expect((res.body as { status: string }).status).toBe('RESOLVED');
        });
    });

    // ── POST /v1/foods/{id}/refetch (T-145) ────────────────────────────────────────────────────────
    describe('POST /v1/foods/{id}/refetch', () => {
        it('rejects a valid token without the admin scope with 403', async () => {
            const id = await seedResolved('Broccoli, raw');
            const res = await call('POST', `/v1/foods/${id}/refetch`, { token: 'user' });
            expect(res.status).toBe(403);
        });

        it('re-enqueues for an admin-scoped token (202)', async () => {
            const id = await seedResolved('Broccoli, raw');
            const res = await call('POST', `/v1/foods/${id}/refetch`, { token: 'admin' });
            expect(res.status).toBe(202);

            const queue = await pool.query('SELECT status FROM fetch_queue WHERE food_id = $1', [id]);
            expect(queue.rows[0].status).toBe('pending');
        });
    });

    // ── Backpressure + flood-shed (T-144) ──────────────────────────────────────────────────────────
    describe('backpressure (T-144)', () => {
        it('returns 503 + Retry-After at the queue-depth ceiling', async () => {
            await seedPendingQueue(10, 'user_1'); // FOOD_MAX_QUEUE_DEPTH=10

            const res = await call('POST', '/v1/foods', { token: 'user', body: { name: 'one too many' } });
            expect(res.status).toBe(503);
            expect(res.headers.get('retry-after')).toBeTruthy();
        });

        it('flood-sheds a heavy sub near the ceiling while a light sub is unaffected', async () => {
            await seedPendingQueue(9, 'flooder'); // near ceiling (>=9), flooder pending=9 > threshold(2)

            const shed = await call('POST', '/v1/foods', { token: 'flooder', body: { name: 'flooder add' } });
            expect(shed.status).toBe(503);

            const light = await call('POST', '/v1/foods', { token: 'user', body: { name: 'light add' } });
            expect(light.status).toBe(202);
        });
    });
});
