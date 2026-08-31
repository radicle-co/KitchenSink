/**
 * U10 — the authored-food HTTP vertical over the booted Nest app + REAL Postgres.
 *
 * The plan's scenarios that only this tier can prove: 201 with the COMPLETE entity born RESOLVED and NO
 * crosswalk row (never-synced structural), the stranger matrix (private → 404 everywhere; promoted →
 * 403 on write), pipeline PUT → 409, dedup 409 with the colliding id, the search/nutrition exclusions
 * against the real queries, and add-by-name NOT deduping against an authored row.
 *
 * Auth follows `foodsApi.integration.test.ts`'s deterministic token → principal matrix (the real
 * FoodAuthGuard, `verifyClerkToken` mocked at the module seam).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { ulid } from 'ulidx';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken, ClerkVerificationError } from '@kitchensink/clerk-verify';

import { migrationsDir } from './support/db.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const mockVerify = vi.mocked(verifyClerkToken);

const AUTHOR_ULID = '01J9ZK8N7QF3B2X4M6T0V5C2AA';
const STRANGER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C2AB';

function principalFor(token: string): { sub: string; userId?: string; scopes: string[]; permissions: string[] } {
    switch (token) {
        case 'author':
            return { sub: 'user_author', userId: AUTHOR_ULID, scopes: [], permissions: [] };
        case 'stranger':
            return { sub: 'user_stranger', userId: STRANGER_ULID, scopes: [], permissions: [] };
        case 'm2m':
            return { sub: 'svc_import', scopes: [], permissions: [] };
        default:
            throw new ClerkVerificationError();
    }
}

const CREATE_BODY = {
    name: 'My Protein Blend',
    description: 'Homemade shake mix',
    macros: { calories: 380, proteinG: 70, carbsG: 12, fatG: 6 },
    portions: [{ label: '1 scoop', gramWeight: 30 }],
};

describe.skipIf(!DATABASE_URL)('authored foods HTTP API (booted Nest + real Postgres, U10)', () => {
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;

    async function call(
        method: string,
        path: string,
        opts: { token?: string; body?: unknown } = {},
    ): Promise<{ status: number; body: unknown }> {
        const headers: Record<string, string> = {};

        if (opts.token !== undefined) {
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
                     food_category, food_category_assignment, food_candidates, fetch_queue, fetch_requesters,
                     source_call_log, source_sync_metadata RESTART IDENTITY CASCADE
        `);
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    async function createAuthored(token = 'author'): Promise<{ id: string }> {
        const res = await call('POST', '/api/v1/foods/authored', { token, body: CREATE_BODY });

        expect(res.status).toBe(201);

        return res.body as { id: string };
    }

    it('201: the COMPLETE entity, born RESOLVED, visibility private, macros as author-provenance values — and NO crosswalk row', async () => {
        const body = (await call('POST', '/api/v1/foods/authored', { token: 'author', body: CREATE_BODY }))
            .body as Record<string, unknown>;
        const created = await pool.query(`SELECT status, user_id, visibility FROM food WHERE id = $1`, [
            (body as { id: string }).id,
        ]);

        expect(created.rows[0]).toEqual({ status: 'RESOLVED', user_id: AUTHOR_ULID, visibility: 'private' });
        expect(body['status']).toBe('RESOLVED');
        expect(body['visibility']).toBe('private');

        const nutrients = body['nutrients'] as { nutrient: string; amount: number; source: string }[];

        expect(nutrients).toHaveLength(4);
        expect(nutrients.every((entry) => entry.source === 'author')).toBe(true);
        expect(nutrients.find((entry) => entry.nutrient === 'Energy')?.amount).toBe(380);

        // KTD-H: never-synced is STRUCTURAL — no food_sources row exists to put it in any refresh scan.
        const sources = await pool.query(`SELECT 1 FROM food_sources WHERE food_id = $1`, [
            (body as { id: string }).id,
        ]);

        expect(sources.rows).toHaveLength(0);
    });

    it('a svc_* principal cannot author a food (403)', async () => {
        const res = await call('POST', '/api/v1/foods/authored', { token: 'm2m', body: CREATE_BODY });

        expect(res.status).toBe(403);
    });

    it('dedup: the same author again → 409 DUPLICATE_AUTHORED_NAME with the colliding id; ANOTHER author → 201', async () => {
        const { id } = await createAuthored('author');
        const dup = await call('POST', '/api/v1/foods/authored', { token: 'author', body: CREATE_BODY });

        expect(dup.status).toBe(409);
        expect(dup.body).toMatchObject({ code: 'DUPLICATE_AUTHORED_NAME', details: { existingId: id } });

        const other = await call('POST', '/api/v1/foods/authored', { token: 'stranger', body: CREATE_BODY });

        expect(other.status).toBe(201);
    });

    it('⛔ the stranger matrix on a PRIVATE food: GET and PUT both answer 404 — existence concealed', async () => {
        const { id } = await createAuthored();

        expect((await call('GET', `/api/v1/foods/${id}`, { token: 'stranger' })).status).toBe(404);
        expect((await call('PUT', `/api/v1/foods/${id}`, { token: 'stranger', body: CREATE_BODY })).status).toBe(404);

        // …while the author reads and edits it freely.
        expect((await call('GET', `/api/v1/foods/${id}`, { token: 'author' })).status).toBe(200);

        const renamed = await call('PUT', `/api/v1/foods/${id}`, {
            token: 'author',
            body: { ...CREATE_BODY, name: 'My Renamed Blend', macros: { ...CREATE_BODY.macros, calories: 390 } },
        });

        expect(renamed.status).toBe(200);
        expect((renamed.body as { name: string; nutrients: { nutrient: string; amount: number }[] }).name).toBe(
            'My Renamed Blend',
        );
    });

    it('R21: create writes version 1; every edit appends — a PROMOTED food`s edit included', async () => {
        const { id } = await createAuthored();

        const v1 = await pool.query(
            `SELECT version_number, snapshot->>'name' AS name FROM food_versions WHERE food_id = $1`,
            [id],
        );

        expect(v1.rows).toEqual([{ version_number: 1, name: 'My Protein Blend' }]);

        await pool.query(`UPDATE food SET visibility = 'promoted' WHERE id = $1`, [id]);

        const edited = await call('PUT', `/api/v1/foods/${id}`, {
            token: 'author',
            body: { ...CREATE_BODY, name: 'Promoted Blend' },
        });

        expect(edited.status).toBe(200);

        const versions = await pool.query(
            `SELECT version_number, snapshot->>'name' AS name FROM food_versions WHERE food_id = $1 ORDER BY version_number`,
            [id],
        );

        expect(versions.rows).toEqual([
            { version_number: 1, name: 'My Protein Blend' },
            { version_number: 2, name: 'Promoted Blend' },
        ]);
    });

    it('a PROMOTED food: stranger GET 200, stranger PUT 403', async () => {
        const { id } = await createAuthored();
        await pool.query(`UPDATE food SET visibility = 'promoted' WHERE id = $1`, [id]);

        expect((await call('GET', `/api/v1/foods/${id}`, { token: 'stranger' })).status).toBe(200);

        const put = await call('PUT', `/api/v1/foods/${id}`, { token: 'stranger', body: CREATE_BODY });

        expect(put.status).toBe(403);
    });

    it('a PIPELINE food answers 409 NOT_EDITABLE on PUT — for its would-be editor and everyone else', async () => {
        const id = ulid();
        await pool.query(
            `INSERT INTO food (id, name, normalized_name, status) VALUES ($1, 'Butter', 'butter', 'RESOLVED')`,
            [id],
        );

        const put = await call('PUT', `/api/v1/foods/${id}`, { token: 'author', body: CREATE_BODY });

        expect(put.status).toBe(409);
        expect((put.body as { code: string }).code).toBe('NOT_EDITABLE');
    });

    it('⛔ search and the edge-cached nutrition batch NEVER surface a private authored food', async () => {
        const { id } = await createAuthored();

        const search = await call('GET', `/api/v1/foods/search?query=protein%20blend`, { token: 'stranger' });

        expect(JSON.stringify(search.body)).not.toContain(id);

        const nutrition = await call('GET', `/api/v1/foods/nutrition?ids=${id}`, { token: 'stranger' });

        expect((nutrition.body as { unknownIds: string[] }).unknownIds).toContain(id);
    });

    it('⛔ add-by-name does NOT dedup against an authored row — a stranger asking for the same name gets a NEW catalog food', async () => {
        const { id } = await createAuthored();
        const added = await call('POST', '/api/v1/foods', { token: 'stranger', body: { name: 'My Protein Blend' } });

        expect(added.status).toBe(202);
        expect((added.body as { id: string }).id).not.toBe(id);
    });
});

/**
 * U18 — the voluntary DELETE flow over the booted app, against a STUB recipe reference server the test
 * controls. Separate describe: it needs `RECIPE_SERVICE_URL` set BEFORE the app boots (the reference
 * check is constructed from it at module init), so it boots its own app instance.
 */
describe.skipIf(!DATABASE_URL)('authored food DELETE — tombstone-first + reference check (integration, U18)', () => {
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;
    let stub: import('node:http').Server;
    /** The stub's next answer; a test may swap it, or replace it with a gate that blocks. */
    let referencesHandler: (respond: (status: number, body: unknown) => void) => void;

    async function call(
        method: string,
        path: string,
        opts: { token?: string; body?: unknown } = {},
    ): Promise<{ status: number; body: unknown }> {
        const headers: Record<string, string> = {};

        if (opts.token !== undefined) {
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

        return { status: response.status, body: text ? JSON.parse(text) : undefined };
    }

    beforeAll(async () => {
        const { createServer } = await import('node:http');

        referencesHandler = (respond) => respond(200, { total: 0, ownRecipeIds: [] });
        stub = createServer((_req, res) => {
            referencesHandler((status, body) => {
                res.statusCode = status;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify(body));
            });
        });
        await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
        const stubPort = (stub.address() as AddressInfo).port;

        pool = new pg.Pool({ connectionString: DATABASE_URL });
        process.env['DATABASE_URL'] = DATABASE_URL;
        process.env['USDA_API_KEY'] = 'integration-dummy-key';
        process.env['CLERK_JWT_KEY'] = 'PEM';
        process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://app.example.com';
        process.env['NODE_ENV'] = 'test';
        process.env['RECIPE_SERVICE_URL'] = `http://127.0.0.1:${String(stubPort)}`;

        const { AppModule } = await import('../src/app.module.js');
        app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
        await app.listen(0);
        baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        delete process.env['RECIPE_SERVICE_URL'];
        await app?.close();
        await pool?.end();
        await new Promise<void>((resolve) => stub.close(() => resolve()));
    });

    beforeEach(async () => {
        await pool.query(`
            TRUNCATE food, food_sources, nutrient, food_nutrients, food_portions, food_field_provenance,
                     food_category, food_category_assignment, food_candidates, fetch_queue, fetch_requesters,
                     source_call_log, source_sync_metadata, food_versions RESTART IDENTITY CASCADE
        `);
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
        referencesHandler = (respond) => respond(200, { total: 0, ownRecipeIds: [] });
    });

    async function createOwn(): Promise<string> {
        const res = await call('POST', '/api/v1/foods/authored', { token: 'author', body: CREATE_BODY });

        expect(res.status).toBe(201);

        return (res.body as { id: string }).id;
    }

    it('unreferenced → 204, the row and its versions are gone', async () => {
        const id = await createOwn();

        expect((await call('DELETE', `/api/v1/foods/${id}`, { token: 'author' })).status).toBe(204);
        expect((await pool.query(`SELECT 1 FROM food WHERE id = $1`, [id])).rows).toHaveLength(0);
        expect((await pool.query(`SELECT 1 FROM food_versions WHERE food_id = $1`, [id])).rows).toHaveLength(0);
    });

    it('referenced → 409 FOOD_REFERENCED with the count + own ids, and the food is back to RESOLVED', async () => {
        const id = await createOwn();
        referencesHandler = (respond) =>
            respond(200, { total: 3, ownRecipeIds: ['11111111-1111-4111-8111-111111111111'] });

        const res = await call('DELETE', `/api/v1/foods/${id}`, { token: 'author' });

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({
            code: 'FOOD_REFERENCED',
            details: { referencingRecipeCount: 3, ownRecipeIds: ['11111111-1111-4111-8111-111111111111'] },
        });

        const row = await pool.query(`SELECT status FROM food WHERE id = $1`, [id]);

        expect(row.rows[0]).toEqual({ status: 'RESOLVED' });
    });

    it('⛔ THE RACE: while the reference check is in flight the food is UNBINDABLE (404), and it recovers after the revert', async () => {
        const id = await createOwn();

        // A gate the test controls: the stub HOLDS the reference response open until told to answer.
        let releaseCheck: () => void = () => undefined;
        const checkStarted = new Promise<void>((resolveStarted) => {
            referencesHandler = (respond) => {
                resolveStarted();
                void new Promise<void>((resolveGate) => {
                    releaseCheck = resolveGate;
                }).then(() => respond(200, { total: 1, ownRecipeIds: [] }));
            };
        });

        const deleting = call('DELETE', `/api/v1/foods/${id}`, { token: 'author' });

        await checkStarted;

        // Mid-check: the tombstone-first flip makes the food invisible to admission — the by-food path
        // reads the golden record, and DELETING answers 404. THIS is the window that closes the TOCTOU.
        expect((await call('GET', `/api/v1/foods/${id}`, { token: 'author' })).status).toBe(404);

        releaseCheck();

        expect((await deleting).status).toBe(409);
        // Referenced → reverted: bindable again.
        expect((await call('GET', `/api/v1/foods/${id}`, { token: 'author' })).status).toBe(200);
    });

    it('⛔ an unreachable reference check FAILS CLOSED: 503, and the food is reverted, not deleted', async () => {
        const id = await createOwn();
        referencesHandler = (respond) => respond(500, { code: 'INTERNAL_ERROR', message: 'boom' });

        const res = await call('DELETE', `/api/v1/foods/${id}`, { token: 'author' });

        expect(res.status).toBe(503);
        expect((res.body as { code: string }).code).toBe('REFERENCE_CHECK_UNAVAILABLE');

        const row = await pool.query(`SELECT status FROM food WHERE id = $1`, [id]);

        expect(row.rows[0]).toEqual({ status: 'RESOLVED' });
    });

    it("the author's own private nutrition rides the authenticated authored route; the shared route still disowns it", async () => {
        const id = await createOwn();

        const shared = await call('GET', `/api/v1/foods/nutrition?ids=${id}`, { token: 'author' });

        expect((shared.body as { unknownIds: string[] }).unknownIds).toContain(id);

        const authored = await call('GET', `/api/v1/foods/authored-nutrition?ids=${id}`, { token: 'author' });
        const foods = (authored.body as { foods: { id: string; caloriesPer100g?: number }[] }).foods;

        expect(foods).toHaveLength(1);
        expect(foods[0]).toMatchObject({ id, caloriesPer100g: 380 });

        // …and a STRANGER asking the authored route for it gets unknownIds — ownership is the filter.
        const stranger = await call('GET', `/api/v1/foods/authored-nutrition?ids=${id}`, { token: 'stranger' });

        expect((stranger.body as { unknownIds: string[] }).unknownIds).toContain(id);
    });
});
