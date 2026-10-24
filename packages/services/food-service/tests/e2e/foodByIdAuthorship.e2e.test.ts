/**
 * LOCAL e2e — `GET /api/v1/foods/{id}/status` and `GET /api/v1/foods/{id}/candidates` behind the SAME authorship
 * gate as `GET /{id}`, against a REAL Postgres. Boots the real app as `food_app` (ADR-0039) behind the REAL
 * `FoodAuthGuard` over genuinely-signed RS256 tokens. Target: LOCAL (§7.1a).
 *
 * ⛔ THE DEFECT: both routes ran no authorship check. `/status` returned a private food's golden record to any
 * authenticated caller; `/candidates` answered `200` for it (an empty set for a resolved food) where `GET /{id}`
 * answered `404` — so either route confirmed a private food existed. Now a caller the policy does not admit gets
 * exactly the `404` a missing id gets.
 *
 * | Requirement | Pinned here |
 * | --- | --- |
 * | a stranger's private food answers exactly as an unknown id | RAW 404 bodies byte-equal: same id, row present then deleted |
 * | `GET /{id}` and `/status` and `/candidates` agree | all three answer the stranger `404` |
 * | the author still reads it, and still learns it was WITHDRAWN | `200`, status, no `food` body |
 * | a catalog food stays readable to everyone | `200` |
 */
import 'reflect-metadata';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import pg from 'pg';
import { ulid } from 'ulidx';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/sources/usda/usda.adapter.js', async () => {
    const { StubSourceAdapter } = await import('../support/StubSourceAdapter.js');

    return { UsdaSourceAdapter: StubSourceAdapter };
});

import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { makeCatalogFood } from '../__fixtures__/catalogFood.js';
import { foodDb } from '../support/roleDb.js';
import { bootFoodApp, callFoodApi, type FoodApiResponse } from './harness.js';

const APP_AZP = 'https://app.example.com';
const AUTHOR_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
const STRANGER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AC';

const keypair = generateClerkKeypair();
const authorToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_byid_author',
    externalId: AUTHOR_ULID,
    azp: APP_AZP,
});
const strangerToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_byid_stranger',
    externalId: STRANGER_ULID,
    azp: APP_AZP,
});

describe('GET /{id}/status and /{id}/candidates — the GET /{id} authorship gate, LOCAL e2e', () => {
    let booted: BootedServiceApp;
    let pool: pg.Pool;

    /** GET `path` as the holder of `token`. */
    function get(token: string, path: string): Promise<FoodApiResponse> {
        return callFoodApi(booted.baseUrl, 'GET', path, { token });
    }

    /** Seed one `food` row as `food_app`, with one candidate row beside it. */
    async function seedFood(options: {
        name: string;
        status?: string;
        userId?: string | null;
        visibility?: 'public' | 'private' | 'promoted';
    }): Promise<string> {
        const { id } = await makeCatalogFood(pool, {
            id: ulid(),
            name: options.name,
            normalizedName: options.name.toLowerCase(),
            status: options.status ?? 'RESOLVED',
            userId: options.userId ?? null,
            visibility: options.visibility ?? 'public',
        });
        await pool.query(
            `INSERT INTO food_candidates (id, food_id, source, external_key, name, summary)
             VALUES ($1, $2, 'usda', '171688', 'Broccoli, raw', '34 kcal/100g')`,
            [ulid(), id],
        );

        return id;
    }

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: foodDb().appUrl });
        booted = await bootFoodApp({ clerkJwtKey: keypair.publicKeyPem, authorizedParties: [APP_AZP] });
    });

    afterAll(async () => {
        await booted?.close();
        await pool?.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    it.each(['status', 'candidates'])(
        '⛔ /%s answers a stranger’s private food BYTE-EQUAL to the same id once the row is gone',
        async (route) => {
            const id = await seedFood({ name: 'Grandma’s spice mix', userId: AUTHOR_ULID, visibility: 'private' });
            const path = `/api/v1/foods/${id}/${route}`;

            const concealed = await get(strangerToken, path);
            await pool.query('DELETE FROM food_candidates WHERE food_id = $1', [id]);
            await pool.query('DELETE FROM food WHERE id = $1', [id]);
            const unknown = await get(strangerToken, path);

            expect(concealed.status).toBe(404);
            expect(concealed.text).toBe(unknown.text);
        },
    );

    it('⛔ GET /{id}, /status and /candidates AGREE: all three conceal a stranger’s private food', async () => {
        const id = await seedFood({ name: 'Grandma’s spice mix', userId: AUTHOR_ULID, visibility: 'private' });

        const statuses = await Promise.all(
            [`/api/v1/foods/${id}`, `/api/v1/foods/${id}/status`, `/api/v1/foods/${id}/candidates`].map(
                async (path) => (await get(strangerToken, path)).status,
            ),
        );

        expect(statuses).toStrictEqual([404, 404, 404]);
    });

    it('the author reads their own private food on /status (golden record) and /candidates', async () => {
        const id = await seedFood({ name: 'Grandma’s spice mix', userId: AUTHOR_ULID, visibility: 'private' });

        const status = await get(authorToken, `/api/v1/foods/${id}/status`);
        const candidates = await get(authorToken, `/api/v1/foods/${id}/candidates`);

        expect(status.status).toBe(200);
        expect(status.body).toMatchObject({ id, status: 'RESOLVED', food: { name: 'Grandma’s spice mix' } });
        // A RESOLVED food is not awaiting disambiguation: an empty set, as for any caller who may read it.
        expect(candidates.status).toBe(200);
        expect(candidates.body).toStrictEqual({ id, candidates: [] });
    });

    it('the author still learns their food was WITHDRAWN — 200, the status, and no food body', async () => {
        const id = await seedFood({
            name: 'Old rub',
            status: 'WITHDRAWN',
            userId: AUTHOR_ULID,
            visibility: 'private',
        });

        const res = await get(authorToken, `/api/v1/foods/${id}/status`);

        expect(res.status).toBe(200);
        expect(res.body).toStrictEqual({ id, status: 'WITHDRAWN' });
    });

    it('a stranger still reads a catalog food’s status and an UNRESOLVED catalog food’s candidates', async () => {
        const resolved = await seedFood({ name: 'Broccoli, raw' });
        const unresolved = await seedFood({ name: 'Broccoli', status: 'UNRESOLVED' });

        const status = await get(strangerToken, `/api/v1/foods/${resolved}/status`);
        const candidates = await get(strangerToken, `/api/v1/foods/${unresolved}/candidates`);

        expect(status.status).toBe(200);
        expect(candidates.status).toBe(200);
        expect((candidates.body as { candidates: unknown[] }).candidates).toHaveLength(1);
    });
});
