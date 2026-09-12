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

import { makePool } from './support/db.js';
import { foodDb, hasTestDatabase } from './support/roleDb.js';

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

describe.skipIf(!hasTestDatabase)('authored foods HTTP API (booted Nest + real Postgres, U10)', () => {
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
        pool = makePool();
        await foodDb().truncate();

        // The app reads this at boot: the SUBJECT connects as `food_app`, exactly as a deployed task does.
        foodDb().applySubjectEnv();
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
        // As the OWNER: `food_app` holds DML and no TRUNCATE, which is precisely the difference this tier
        // now proves. The table list comes from the catalogue, so it cannot drift from the schema.
        await foodDb().truncate();
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
 * The voluntary DELETE flow — a WITHDRAWAL — over the booted app (owner rulings 1, 2, 5, 6, 2026-09-07).
 *
 * ## Where the previous coverage went
 *
 * This block used to prove the tombstone-first flow: `204` + a physical delete, `409 FOOD_REFERENCED`,
 * `503 REFERENCE_CHECK_UNAVAILABLE` on an unreachable check, and the mid-check TOCTOU window in which the
 * food answered `404` to a bind. All five are DELETED, not weakened, because the behaviour they proved no
 * longer exists — there is no reference check, no refusal, and no physical delete. The window test in
 * particular proved a property of a race that cannot occur when a single guarded transition is the whole
 * flow.
 *
 * What replaces them proves the new contract, and two of the cases below are things the old flow could not
 * have had: that the row SURVIVES, and that the author can re-use the name.
 *
 * ## ⛔ The assertion that carries the owner's first ruling
 *
 * "The recipe service needs to handle when it detects that a food item has been deleted — the food service
 * should not be updating recipes." A test that stubs a recipe client and asserts it was not called proves
 * nothing about whether some OTHER outbound call was added. So `fetch` itself is the tripwire: the DELETE
 * runs with `globalThis.fetch` wrapped, and any request to an origin other than this app's own fails the
 * test. `RECIPE_SERVICE_URL` is deliberately NOT set — it no longer exists in the env schema — so this is
 * belt and braces over a config that cannot point anywhere.
 */
describe.skipIf(!hasTestDatabase)('authored food DELETE — the withdrawal (integration)', () => {
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

    /**
     * Run `body` with every outbound `fetch` to an origin OTHER than this app recorded, and return them.
     *
     * ⚠️ Wrapping the global is deliberate rather than injecting a port: the claim under test is "this
     * service makes no cross-service call on this path", and a port can only observe calls that go through
     * the port. The suite's own requests are excluded by origin, not by allow-listing a client.
     */
    async function outboundOriginsDuring(body: () => Promise<void>): Promise<string[]> {
        const original = globalThis.fetch;
        const origins: string[] = [];

        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

            if (url.origin !== baseUrl) {
                origins.push(url.origin);
            }

            return original(input as RequestInfo, init);
        }) as typeof globalThis.fetch;

        try {
            await body();
        } finally {
            globalThis.fetch = original;
        }

        return origins;
    }

    beforeAll(async () => {
        pool = makePool();
        foodDb().applySubjectEnv();
        process.env['USDA_API_KEY'] = 'integration-dummy-key';
        process.env['CLERK_JWT_KEY'] = 'PEM';
        process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://app.example.com';
        process.env['NODE_ENV'] = 'test';

        const { AppModule } = await import('../src/app.module.js');
        app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
        await app.listen(0);
        baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await app?.close();
        await pool?.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    async function createOwn(): Promise<string> {
        const res = await call('POST', '/api/v1/foods/authored', { token: 'author', body: CREATE_BODY });

        expect(res.status).toBe(201);

        return (res.body as { id: string }).id;
    }

    it('⛔ answers 204 having made NO outbound call to any other service', async () => {
        const id = await createOwn();
        let status = 0;

        const origins = await outboundOriginsDuring(async () => {
            status = (await call('DELETE', `/api/v1/foods/${id}`, { token: 'author' })).status;
        });

        expect(status).toBe(204);
        expect(origins).toStrictEqual([]);
    });

    it('⛔ RETAINS the row — status WITHDRAWN, withdrawn_at stamped, versions intact', async () => {
        // Ruling 5: "we should soft delete for now so that we can provide information about what was
        // deleted." The previous flow asserted the exact opposite (`rows` empty), which is why that case is
        // deleted rather than adjusted.
        const id = await createOwn();

        expect((await call('DELETE', `/api/v1/foods/${id}`, { token: 'author' })).status).toBe(204);

        const row = await pool.query<{ status: string; withdrawn_at: Date | null; tombstoned_at: Date | null }>(
            `SELECT status, withdrawn_at, tombstoned_at FROM food WHERE id = $1`,
            [id],
        );

        expect(row.rows).toHaveLength(1);
        expect(row.rows[0]?.status).toBe('WITHDRAWN');
        expect(row.rows[0]?.withdrawn_at).toBeInstanceOf(Date);
        // ⛔ NOT `tombstoned_at`: that column anchors the NOT_FOUND TTL reactivation, and a withdrawal
        // written into it would let the TTL path resurrect an author's deleted food.
        expect(row.rows[0]?.tombstoned_at).toBeNull();
        expect((await pool.query(`SELECT 1 FROM food_versions WHERE food_id = $1`, [id])).rows.length).toBeGreaterThan(
            0,
        );
    });

    it('⛔ lets the author re-add the SAME name — the retained row must not block them', async () => {
        // THE regression a soft delete creates, and the only thing 0017's index predicate exists for. A
        // unit test cannot see this: the uniqueness lives in a partial index, so only a real database can
        // say whether "delete it and add it again" works or answers 409 DUPLICATE_AUTHORED_NAME forever.
        const id = await createOwn();

        expect((await call('DELETE', `/api/v1/foods/${id}`, { token: 'author' })).status).toBe(204);

        const readded = await call('POST', '/api/v1/foods/authored', { token: 'author', body: CREATE_BODY });

        expect(readded.status).toBe(201);
        expect((readded.body as { id: string }).id).not.toBe(id);
    });

    it('a SECOND delete is 404 — the guarded transition matches no row', async () => {
        const id = await createOwn();

        expect((await call('DELETE', `/api/v1/foods/${id}`, { token: 'author' })).status).toBe(204);
        expect((await call('DELETE', `/api/v1/foods/${id}`, { token: 'author' })).status).toBe(404);
    });

    it('a withdrawn food is no longer readable or editable by its own author', async () => {
        const id = await createOwn();

        await call('DELETE', `/api/v1/foods/${id}`, { token: 'author' });

        expect((await call('GET', `/api/v1/foods/${id}`, { token: 'author' })).status).toBe(404);
        expect((await call('PUT', `/api/v1/foods/${id}`, { token: 'author', body: CREATE_BODY })).status).toBe(404);
    });

    it('⛔ still REPORTS the food on the nutrition route, with its status and NO macros (ruling 6)', async () => {
        // The whole point of retaining the row. If the entry were omitted the id would land in
        // `unknownIds`, which already means "no such row" and "not yours" — and recipe-service would have
        // no way to tell a cook their ingredient was withdrawn rather than mistyped.
        const id = await createOwn();

        await call('DELETE', `/api/v1/foods/${id}`, { token: 'author' });

        const authored = await call('GET', `/api/v1/foods/authored-nutrition?ids=${id}`, { token: 'author' });
        const body = authored.body as {
            foods: { id: string; status: string; caloriesPer100g?: number; portions: unknown[] }[];
            unknownIds: string[];
        };

        expect(body.unknownIds).not.toContain(id);
        expect(body.foods).toHaveLength(1);
        expect(body.foods[0]).toMatchObject({ id, status: 'WITHDRAWN', portions: [] });
        expect(body.foods[0]?.caloriesPer100g).toBeUndefined();
    });

    it('⛔ answers GET /{id}/status with 200 and the status — the ONE door a reader learns this through', async () => {
        const id = await createOwn();

        await call('DELETE', `/api/v1/foods/${id}`, { token: 'author' });

        const res = await call('GET', `/api/v1/foods/${id}/status`, { token: 'author' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id, status: 'WITHDRAWN' });
        // ⛔ No `food` body: ruling 6 for free. A withdrawn food publishes the FACT, never the figures.
        expect((res.body as { food?: unknown }).food).toBeUndefined();
    });

    it("the author's own private nutrition rides the authenticated authored route; the shared route disowns it", async () => {
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
