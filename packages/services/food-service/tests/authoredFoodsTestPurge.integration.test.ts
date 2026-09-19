/**
 * ADR-0040's food half — `POST /api/v1/foods/authored/test-purge` over the booted Nest app and a REAL Postgres,
 * with both the app and this suite's pool connected as `food_app` (ADR-0039), so a privilege the deployed service
 * lacks fails here rather than in a stage.
 *
 * What only this tier can prove:
 *
 *  - the purge's predicate against real rows — a test principal's PRIVATE authored foods go (withdrawn ones
 *    included, which are the rows that pile up under a fixed pool slot), while its PROMOTED food, its mid-erasure
 *    (`DELETING`) food, another cook's authored foods and the catalog all survive;
 *  - the `ON DELETE CASCADE` from 0000/0014 really takes the purged foods' nutrients, portions and versions;
 *  - 0017's per-author dedup slot is free afterwards, which a partial unique index alone decides;
 *  - the refusal is byte-for-byte what this app answers for a path it does not route — compared against a REAL
 *    unrouted request rather than a hardcoded envelope, so a Nest upgrade that changes its not-found message
 *    fails here instead of silently making the door distinguishable.
 *
 * Auth follows `authoredFoodsApi.integration.test.ts`: the real `FoodAuthGuard`, `verifyClerkToken` mocked at the
 * module seam with a deterministic token → principal matrix.
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

const POOL_ULID = '01J9ZK8N7QF3B2X4M6T0V5C3AA';
const REAL_ULID = '01J9ZK8N7QF3B2X4M6T0V5C3AB';

const PURGE_PATH = '/api/v1/foods/authored/test-purge';
/** A sibling path no route matches: POST's only two-segment routes are `:id/corroborated` and `:id/refetch`. */
const UNROUTED_PATH = '/api/v1/foods/authored/test-purgo';

function principalFor(token: string): {
    sub: string;
    userId?: string;
    scopes: string[];
    permissions: string[];
    testPrincipal: boolean;
} {
    switch (token) {
        case 'pool':
            return { sub: 'user_pool_1', userId: POOL_ULID, scopes: [], permissions: [], testPrincipal: true };
        case 'poolUnsynced':
            return { sub: 'user_pool_2', scopes: [], permissions: [], testPrincipal: true };
        case 'poolService':
            return { sub: 'svc_pool', userId: POOL_ULID, scopes: [], permissions: [], testPrincipal: true };
        case 'real':
            return { sub: 'user_real', userId: REAL_ULID, scopes: [], permissions: [], testPrincipal: false };
        case 'm2m':
            return { sub: 'svc_import', scopes: ['food:admin'], permissions: [], testPrincipal: false };
        default:
            throw new ClerkVerificationError();
    }
}

function authoredBody(name: string): Record<string, unknown> {
    return {
        name,
        macros: { calories: 380, proteinG: 70, carbsG: 12, fatG: 6 },
        portions: [{ label: '1 scoop', gramWeight: 30 }],
    };
}

describe.skipIf(!hasTestDatabase)('authored-food test purge (booted Nest + real Postgres, ADR-0040)', () => {
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;

    interface Reply {
        status: number;
        contentType: string | null;
        body: unknown;
    }

    async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<Reply> {
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

        return {
            status: response.status,
            contentType: response.headers.get('content-type'),
            body: text ? JSON.parse(text) : undefined,
        };
    }

    async function createAuthored(token: string, name: string): Promise<string> {
        const res = await call('POST', '/api/v1/foods/authored', { token, body: authoredBody(name) });

        expect(res.status).toBe(201);

        return (res.body as { id: string }).id;
    }

    /** Every row of every table the purge could touch, keyed so a before/after comparison names what moved. */
    async function snapshot(): Promise<Record<string, unknown[]>> {
        const tables = ['food', 'food_nutrients', 'food_portions', 'food_versions'];
        const entries = await Promise.all(
            tables.map(async (table) => {
                const rows = await pool.query(`SELECT * FROM ${table} ORDER BY 1`);

                return [table, rows.rows] as const;
            }),
        );

        return Object.fromEntries(entries);
    }

    async function rowsFor(table: string, foodIds: readonly string[]): Promise<number> {
        const column = table === 'food' ? 'id' : 'food_id';
        const result = await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM ${table} WHERE ${column} = ANY($1)`,
            [foodIds],
        );

        return result.rows[0]?.n ?? 0;
    }

    beforeAll(async () => {
        pool = makePool();
        await foodDb().truncate();

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
        await foodDb().truncate();
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    it('deletes the test principal`s PRIVATE authored foods with their nutrients, portions and versions — and nothing else', async () => {
        const privateLive = await createAuthored('pool', 'Pool Shake');
        const privateWithdrawn = await createAuthored('pool', 'Pool Bar');
        expect((await call('DELETE', `/api/v1/foods/${privateWithdrawn}`, { token: 'pool' })).status).toBe(204);
        const promoted = await createAuthored('pool', 'Pool Promoted');
        await pool.query(`UPDATE food SET visibility = 'promoted' WHERE id = $1`, [promoted]);
        const midErasure = await createAuthored('pool', 'Pool Erasing');
        await pool.query(`UPDATE food SET status = 'DELETING' WHERE id = $1`, [midErasure]);
        const realUsers = await createAuthored('real', 'Pool Shake');
        const catalog = ulid();
        await pool.query(
            `INSERT INTO food (id, name, normalized_name, status) VALUES ($1, 'Butter', 'butter', 'RESOLVED')`,
            [catalog],
        );

        const purged = [privateLive, privateWithdrawn];
        const survivors = [promoted, midErasure, realUsers, catalog];

        // Non-vacuity: the cascade has something to take, so "zero rows after" cannot pass on an empty table.
        for (const table of ['food_nutrients', 'food_portions', 'food_versions']) {
            expect(await rowsFor(table, purged), table).toBeGreaterThan(0);
        }

        const survivorsBefore = await Promise.all(
            ['food', 'food_nutrients', 'food_portions', 'food_versions'].map((table) => rowsFor(table, survivors)),
        );

        const res = await call('POST', PURGE_PATH, { token: 'pool' });

        expect(res.status).toBe(200);
        expect(res.body).toStrictEqual({ deletedAuthoredFoods: 2, retainedPromotedFoods: 1 });

        for (const table of ['food', 'food_nutrients', 'food_portions', 'food_versions']) {
            expect(await rowsFor(table, purged), table).toBe(0);
        }

        const survivorsAfter = await Promise.all(
            ['food', 'food_nutrients', 'food_portions', 'food_versions'].map((table) => rowsFor(table, survivors)),
        );

        expect(survivorsAfter).toStrictEqual(survivorsBefore);
        expect(await rowsFor('food', survivors)).toBe(survivors.length);
    });

    it('frees the per-author dedup slot, and a second purge deletes nothing (repeatable, idempotent)', async () => {
        await createAuthored('pool', 'Pool Shake');
        const promoted = await createAuthored('pool', 'Pool Promoted');
        await pool.query(`UPDATE food SET visibility = 'promoted' WHERE id = $1`, [promoted]);

        // Before the purge the name is taken: this is the 409 the purge must clear.
        expect(
            (await call('POST', '/api/v1/foods/authored', { token: 'pool', body: authoredBody('Pool Shake') })).status,
        ).toBe(409);

        expect((await call('POST', PURGE_PATH, { token: 'pool' })).body).toStrictEqual({
            deletedAuthoredFoods: 1,
            retainedPromotedFoods: 1,
        });

        await createAuthored('pool', 'Pool Shake');

        expect((await call('POST', PURGE_PATH, { token: 'pool' })).body).toStrictEqual({
            deletedAuthoredFoods: 1,
            retainedPromotedFoods: 1,
        });
        expect((await call('POST', PURGE_PATH, { token: 'pool' })).body).toStrictEqual({
            deletedAuthoredFoods: 0,
            retainedPromotedFoods: 1,
        });
    });

    it.each([
        ['a real user', 'real'],
        ['a service principal', 'm2m'],
        ['a service principal carrying the claim', 'poolService'],
        ['a test principal whose external_id has not synced', 'poolUnsynced'],
    ])('refuses %s with exactly the unrouted 404 and deletes nothing', async (_name, token) => {
        await createAuthored('real', 'Real Shake');
        await createAuthored('pool', 'Pool Shake');
        const before = await snapshot();

        const refused = await call('POST', PURGE_PATH, { token });
        const unrouted = await call('POST', UNROUTED_PATH, { token });

        // The real unrouted answer, stated so a reader sees what "indistinguishable" means…
        expect(unrouted.status).toBe(404);
        expect(unrouted.body).toStrictEqual({ code: 'NOT_FOUND', message: `Cannot POST ${UNROUTED_PATH}` });
        // …and the refusal is that answer with only the path the caller already sent substituted.
        expect(refused.status).toBe(unrouted.status);
        expect(refused.contentType).toBe(unrouted.contentType);
        expect(refused.body).toStrictEqual(
            JSON.parse(JSON.stringify(unrouted.body).replaceAll(UNROUTED_PATH, PURGE_PATH)),
        );

        expect(await snapshot()).toStrictEqual(before);
    });
});
