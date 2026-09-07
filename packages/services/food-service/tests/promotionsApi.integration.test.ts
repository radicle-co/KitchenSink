/**
 * U12 — the promotion funnel over the booted Nest app + REAL Postgres: trigger → moderation queue →
 * human decision → phase 1 publication.
 *
 * The plan's scenarios that only this tier can prove: two compatible tenured authors TRIGGER a queue
 * entry while NOTHING publishes (the stranger matrix still 404s), under-age authors do not trigger,
 * incompatible macros do not trigger, the decision routes are `food:admin`-gated, approval elects the
 * OLDEST contributing food and makes exactly it world-readable, a rejected candidacy's identical
 * resubmission never re-enters the queue, and the kill-between-phases intermediate state is safe on the
 * food side (the losers stay private and untouched).
 *
 * Author TENURE is the author's first appearance in this service (their earliest authored food —
 * `promotionPolicy.ts`'s documented proxy), so each corroborating author gets a BACKDATED "anchor" food
 * under an unrelated name before authoring the candidate.
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

const AUTHOR_A = '01J9ZK8N7QF3B2X4M6T0V5C3AA';
const AUTHOR_B = '01J9ZK8N7QF3B2X4M6T0V5C3AB';
const AUTHOR_NEW = '01J9ZK8N7QF3B2X4M6T0V5C3AC';
const STRANGER = '01J9ZK8N7QF3B2X4M6T0V5C3AD';

function principalFor(token: string): { sub: string; userId?: string; scopes: string[]; permissions: string[] } {
    switch (token) {
        case 'author-a':
            return { sub: 'user_a', userId: AUTHOR_A, scopes: [], permissions: [] };
        case 'author-b':
            return { sub: 'user_b', userId: AUTHOR_B, scopes: [], permissions: [] };
        case 'author-new':
            return { sub: 'user_new', userId: AUTHOR_NEW, scopes: [], permissions: [] };
        case 'stranger':
            return { sub: 'user_s', userId: STRANGER, scopes: [], permissions: [] };
        case 'admin':
            return { sub: 'user_admin', userId: STRANGER, scopes: ['food:admin'], permissions: [] };
        default:
            throw new ClerkVerificationError();
    }
}

/** The shared candidate name and its compatible macro profile. */
const SHARED_NAME = 'Shared Protein Blend';
const MACROS = { calories: 380, proteinG: 70, carbsG: 12, fatG: 6 };

describe.skipIf(!DATABASE_URL)('promotion funnel HTTP API (booted Nest + real Postgres, U12)', () => {
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
                     source_call_log, source_sync_metadata, food_versions, food_promotions
            RESTART IDENTITY CASCADE
        `);
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    /** Author a food. */
    async function author(token: string, name: string, macros: typeof MACROS = MACROS): Promise<{ id: string }> {
        const res = await call('POST', '/api/v1/foods/authored', { token, body: { name, macros } });

        expect(res.status).toBe(201);

        return res.body as { id: string };
    }

    /** Give `token`'s author a tenure anchor: an unrelated food, backdated past the minimum. */
    async function anchorTenure(token: string, label: string): Promise<void> {
        const anchor = await author(token, `tenure anchor ${label}`);

        await pool.query(`UPDATE food SET created_at = now() - interval '60 days' WHERE id = $1`, [anchor.id]);
    }

    /** The pending queue rows for the shared name, straight from the table. */
    async function pendingRows(): Promise<Array<{ id: string; candidate_food_ids: string[] }>> {
        const { rows } = await pool.query(
            `SELECT id, candidate_food_ids FROM food_promotions WHERE status = 'pending'`,
        );

        return rows as Array<{ id: string; candidate_food_ids: string[] }>;
    }

    it('two tenured, compatible authors TRIGGER a queue entry — and NOTHING publishes without approval', async () => {
        await anchorTenure('author-a', 'a');
        await anchorTenure('author-b', 'b');
        const first = await author('author-a', SHARED_NAME);
        const second = await author('author-b', SHARED_NAME);

        const rows = await pendingRows();

        expect(rows).toHaveLength(1);
        expect(new Set(rows[0]?.candidate_food_ids)).toEqual(new Set([first.id, second.id]));

        // The trigger published NOTHING: a stranger still cannot see either food, anywhere.
        expect((await call('GET', `/api/v1/foods/${first.id}`, { token: 'stranger' })).status).toBe(404);

        const search = (await call('GET', '/api/v1/foods/search?query=shared%20protein', { token: 'stranger' }))
            .body as { results: Array<{ id: string }> };

        expect(search.results.map((hit) => hit.id)).not.toContain(first.id);
    });

    it('an under-age corroborator does NOT trigger', async () => {
        await anchorTenure('author-a', 'a');
        await author('author-a', SHARED_NAME);
        // author-new has no anchor: their first appearance is NOW, under the minimum tenure.
        await author('author-new', SHARED_NAME);

        expect(await pendingRows()).toHaveLength(0);
    });

    it('incompatible macros do NOT trigger', async () => {
        await anchorTenure('author-a', 'a');
        await anchorTenure('author-b', 'b');
        await author('author-a', SHARED_NAME);
        await author('author-b', SHARED_NAME, { ...MACROS, calories: 700 });

        expect(await pendingRows()).toHaveLength(0);
    });

    it('the moderation routes refuse a caller without the food:admin scope', async () => {
        expect((await call('GET', '/api/v1/foods/admin/promotions/pending', { token: 'author-a' })).status).toBe(403);
        expect(
            (
                await call('POST', '/api/v1/foods/admin/promotions/00000000-0000-4000-8000-000000000001/approve', {
                    token: 'author-a',
                })
            ).status,
        ).toBe(403);
    });

    it('approval elects the OLDEST contributing food, publishes exactly it, and leaves the loser private', async () => {
        await anchorTenure('author-a', 'a');
        await anchorTenure('author-b', 'b');
        const first = await author('author-a', SHARED_NAME);
        const second = await author('author-b', SHARED_NAME);
        const [row] = await pendingRows();

        expect(row).toBeDefined();

        const approve = await call('POST', `/api/v1/foods/admin/promotions/${row!.id}/approve`, { token: 'admin' });

        expect(approve.status).toBe(201);
        expect((approve.body as { canonicalFoodId: string }).canonicalFoodId).toBe(first.id);

        // The canonical is now world-readable — a stranger reads it and finds it in search…
        expect((await call('GET', `/api/v1/foods/${first.id}`, { token: 'stranger' })).status).toBe(200);

        const search = (await call('GET', '/api/v1/foods/search?query=shared%20protein', { token: 'stranger' }))
            .body as { results: Array<{ id: string; visibility?: string }> };

        expect(search.results.find((hit) => hit.id === first.id)?.visibility).toBe('promoted');

        // …while the LOSER is untouched: still private, still its author's, invisible to the stranger.
        expect((await call('GET', `/api/v1/foods/${second.id}`, { token: 'stranger' })).status).toBe(404);
        expect((await call('GET', `/api/v1/foods/${second.id}`, { token: 'author-b' })).status).toBe(200);

        // And the batch (edge-cache) population now includes the canonical.
        const nutrition = (
            await call('GET', `/api/v1/foods/nutrition?ids=${first.id},${second.id}`, { token: 'stranger' })
        ).body as { foods: Array<{ id: string }>; unknownIds: string[] };

        expect(nutrition.foods.map((food) => food.id)).toContain(first.id);
        expect(nutrition.unknownIds).toContain(second.id);
    });

    it('a double-approve answers 409 PROMOTION_NOT_ACTIONABLE; an unknown id answers 404', async () => {
        await anchorTenure('author-a', 'a');
        await anchorTenure('author-b', 'b');
        await author('author-a', SHARED_NAME);
        await author('author-b', SHARED_NAME);
        const [row] = await pendingRows();

        expect(
            (await call('POST', `/api/v1/foods/admin/promotions/${row!.id}/approve`, { token: 'admin' })).status,
        ).toBe(201);

        const again = await call('POST', `/api/v1/foods/admin/promotions/${row!.id}/approve`, { token: 'admin' });

        expect(again.status).toBe(409);
        expect((again.body as { code: string }).code).toBe('PROMOTION_NOT_ACTIONABLE');

        const unknown = await call(
            'POST',
            '/api/v1/foods/admin/promotions/00000000-0000-4000-8000-00000000dead/approve',
            { token: 'admin' },
        );

        expect(unknown.status).toBe(404);
        expect((unknown.body as { code: string }).code).toBe('PROMOTION_NOT_FOUND');
    });

    it('a REJECTED candidacy does not re-enter the queue on identical data — new data re-opens it', async () => {
        await anchorTenure('author-a', 'a');
        await anchorTenure('author-b', 'b');
        const first = await author('author-a', SHARED_NAME);
        await author('author-b', SHARED_NAME);
        const [row] = await pendingRows();

        const reject = await call('POST', `/api/v1/foods/admin/promotions/${row!.id}/reject`, { token: 'admin' });

        expect(reject.status).toBe(201);

        // Identical data: re-detection rides an author's PUT with the same macros — no new queue row.
        const putSame = await call('PUT', `/api/v1/foods/${first.id}`, {
            token: 'author-a',
            body: { name: SHARED_NAME, macros: MACROS },
        });

        expect(putSame.status).toBe(200);
        expect(await pendingRows()).toHaveLength(0);

        // NEW data (a macro edit, still compatible with the corroborator): the fingerprint changes and the
        // candidacy re-enters the queue.
        const putChanged = await call('PUT', `/api/v1/foods/${first.id}`, {
            token: 'author-a',
            body: { name: SHARED_NAME, macros: { ...MACROS, calories: 385 } },
        });

        expect(putChanged.status).toBe(200);
        expect(await pendingRows()).toHaveLength(1);
    });
});
