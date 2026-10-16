/**
 * LOCAL e2e (`docs/CODING_STANDARDS.md` §7.1a): the test purge takes back the catalog roots a TEST PRINCIPAL's remote
 * pick created (ADR-0040 food half; owner ruling 2026-10-16, "Clean up test-picked foods"), through the booted food app
 * on a real Postgres, both the app and this suite connected as `food_app` (ADR-0039).
 *
 * | What only a real database shows                                            | Pinned here                                      |
 * | -------------------------------------------------------------------------- | ------------------------------------------------ |
 * | migration 0023 built the table the DAO writes                              | its columns, its key and its cascade             |
 * | a test pick's root hid the hit, and the purge makes the hit offered again  | the same phrase, empty then offered, then a new root |
 * | the root, its item and its crosswalk are all gone                          | no `food`, `food_item` or `food_sources` row     |
 * | a real cook's root, a seed root and another slot's root survive the purge  | their rows are untouched                         |
 * | a root a real cook has since been answered with is kept                    | the row stays, `held_by_real_user` is set        |
 * | a repeat purge deletes nothing                                             | `deletedPickedRoots: 0`                          |
 *
 * The source is a stub USDA (one fetch per pick) behind a stand-in for the search CDN, as `progressiveSearch.e2e.test.ts`
 * builds them.
 */
import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adoptRemoteFoodResponseSchema, authoredFoodTestPurgeResponseSchema } from '../../src/foods/foods.schema.js';
import { progressiveSearchFrameSchema, type ProgressiveSearchFrame } from '../../src/foods/progressiveSearch.schema.js';
import { makeCatalogFood } from '../__fixtures__/catalogFood.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { foodDb } from '../support/roleDb.js';
import { startSearchEdgeStandIn, type SearchEdgeStandIn } from '../support/searchEdgeStandIn.js';
import { searchFunctionDouble } from '../support/searchFunctionDouble.js';
import { startUsdaStubServer, type UsdaStubServer } from '../support/usdaStubServer.js';
import { bootFoodApp, callFoodApi } from './harness.js';

const APP_AZP = 'https://app.example.com';
const clerk = generateClerkKeypair();
const POOL_A = '01J9ZK8N7QF3B2X4M6T0V5C4AA';
const POOL_B = '01J9ZK8N7QF3B2X4M6T0V5C4BB';
const REAL = '01J9ZK8N7QF3B2X4M6T0V5C4CC';
const poolA = mintToken(clerk.privateKeyPem, {
    sub: 'user_pool_a',
    externalId: POOL_A,
    azp: APP_AZP,
    testPrincipal: true,
});
const poolB = mintToken(clerk.privateKeyPem, {
    sub: 'user_pool_b',
    externalId: POOL_B,
    azp: APP_AZP,
    testPrincipal: true,
});
const real = mintToken(clerk.privateKeyPem, { sub: 'user_real', externalId: REAL, azp: APP_AZP });
const KEY_PAIR_ID = 'K2JCJMDEHXQW5F';
const { privateKey: SIGNING_KEY, publicKey: PUBLIC_PEM } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const REMOTE_SEARCH_ENV = [
    'REMOTE_SEARCH_ORIGIN',
    'REMOTE_SEARCH_KEY_PAIR_ID',
    'REMOTE_SEARCH_SIGNING_KEY',
    'FOOD_REMOTE_REFERENCE_KEY',
];
const PURGE = '/api/v1/foods/authored/test-purge';
/** The phrase the Maestro flow searches. A fixed word, on purpose: that is what the purge makes repeatable. */
const PHRASE = 'halloumi';
const HIT = { externalKey: '910001', name: 'Halloumi cheese, halloumi', lineageKey: null };

describe('the test purge and the roots a test pick created (booted app, real Postgres)', () => {
    let app: BootedServiceApp;
    let pool: pg.Pool;
    let edge: SearchEdgeStandIn;
    let usda: UsdaStubServer;
    const origin = searchFunctionDouble();

    /**
     * Search as a caller and read every frame.
     *
     * @param token - The caller's token.
     * @returns The frames.
     * @sideEffect One HTTP request.
     */
    async function search(token: string): Promise<ProgressiveSearchFrame[]> {
        const response = await fetch(
            `${app.baseUrl}/api/v1/foods/search/progressive?query=${encodeURIComponent(PHRASE)}`,
            { headers: { authorization: `Bearer ${token}` } },
        );

        expect(response.status).toBe(200);

        return (await response.text())
            .trimEnd()
            .split('\n')
            .map((line) => progressiveSearchFrameSchema.parse(JSON.parse(line)));
    }

    /**
     * The remote hits the answer offers, by name.
     *
     * @param token - The caller's token.
     * @returns The names of the source frame's items, and the first one's reference.
     * @sideEffect One HTTP request.
     */
    async function offered(token: string): Promise<{ names: string[]; reference: string }> {
        const frame = (await search(token)).find((candidate) => candidate.type === 'source');

        if (frame?.type !== 'source' || frame.outcome !== 'answered') {
            throw new Error('expected an answered source frame');
        }

        return { names: frame.items.map((item) => item.name), reference: frame.items[0]?.reference ?? '' };
    }

    /**
     * Pick the offered hit as a caller.
     *
     * @param token - The caller's token.
     * @param reference - The hit's reference.
     * @returns The root's id.
     * @sideEffect One HTTP request; may create a root.
     */
    async function pick(token: string, reference: string): Promise<string> {
        const res = await callFoodApi(app.baseUrl, 'POST', '/api/v1/foods/remote/adopt', {
            token,
            body: { reference },
        });

        expect(res.status).toBe(200);

        return adoptRemoteFoodResponseSchema.parse(res.body).id;
    }

    /**
     * Purge as a caller.
     *
     * @param token - The caller's token.
     * @returns The published counts.
     * @sideEffect One HTTP request; deletes.
     */
    async function purge(token: string): Promise<{ deletedPickedRoots: number }> {
        const res = await callFoodApi(app.baseUrl, 'POST', PURGE, { token });

        expect(res.status).toBe(200);

        return authoredFoodTestPurgeResponseSchema.parse(res.body);
    }

    /**
     * Whether a root, its item and its crosswalk still exist.
     *
     * @param foodId - The root.
     * @returns The three counts.
     * @sideEffect Reads `food`, `food_item` and `food_sources`.
     */
    async function rowsOf(foodId: string): Promise<{ food: number; item: number; sources: number; picked: number }> {
        const counted = await pool.query<{ food: number; item: number; sources: number; picked: number }>(
            `SELECT (SELECT count(*) FROM food WHERE id = $1)::int AS food,
                    (SELECT count(*) FROM food_item WHERE id = (SELECT item_id FROM food WHERE id = $1))::int AS item,
                    (SELECT count(*) FROM food_sources WHERE item_id = (SELECT item_id FROM food WHERE id = $1))::int AS sources,
                    (SELECT count(*) FROM test_picked_root WHERE food_id = $1)::int AS picked`,
            [foodId],
        );

        return counted.rows[0] ?? { food: 0, item: 0, sources: 0, picked: 0 };
    }

    beforeAll(async () => {
        usda = await startUsdaStubServer();
        edge = await startSearchEdgeStandIn({
            origin: async (event) => origin.origin(event),
            publicKey: createPublicKey(PUBLIC_PEM),
            keyPairId: KEY_PAIR_ID,
        });
        process.env['USDA_API_BASE_URL'] = usda.baseUrl;
        process.env['REMOTE_SEARCH_ORIGIN'] = edge.origin;
        process.env['REMOTE_SEARCH_KEY_PAIR_ID'] = KEY_PAIR_ID;
        process.env['REMOTE_SEARCH_SIGNING_KEY'] = SIGNING_KEY;
        process.env['FOOD_REMOTE_REFERENCE_KEY'] = randomBytes(32).toString('base64url');
        app = await bootFoodApp({ clerkJwtKey: clerk.publicKeyPem, authorizedParties: [APP_AZP] });
        pool = new pg.Pool({ connectionString: foodDb().appUrl, max: 4 });
    });

    afterAll(async () => {
        await app?.close();
        await pool?.end();
        await edge?.close();
        await usda?.close();

        for (const name of REMOTE_SEARCH_ENV) {
            Reflect.deleteProperty(process.env, name);
        }
    });

    beforeEach(async () => {
        await foodDb().truncate();
        edge.clear();
        usda.reset();
        usda.mode = 'hits';
        origin.mode = { kind: 'found', items: [HIT] };
        origin.sourceCalls.length = 0;
    });

    it('migration 0023 built the table the DAO writes: a key on the root, the creator, the hold, and a cascade', async () => {
        const columns = await pool.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
            `SELECT column_name, is_nullable, column_default FROM information_schema.columns
              WHERE table_name = 'test_picked_root' ORDER BY column_name`,
        );

        expect(columns.rows.map((column) => [column.column_name, column.is_nullable])).toStrictEqual([
            ['created_at', 'NO'],
            ['created_by', 'NO'],
            ['food_id', 'NO'],
            ['held_by_real_user', 'NO'],
        ]);
        expect(columns.rows.find((column) => column.column_name === 'held_by_real_user')?.column_default).toBe('false');

        const cascade = await pool.query<{ delete_rule: string }>(
            `SELECT rc.delete_rule FROM information_schema.referential_constraints rc
               JOIN information_schema.table_constraints tc ON tc.constraint_name = rc.constraint_name
              WHERE tc.table_name = 'test_picked_root'`,
        );

        expect(cascade.rows).toStrictEqual([{ delete_rule: 'CASCADE' }]);
    });

    it('⛔ a test pick hides the hit; its purge deletes the root, and the same phrase offers the hit again', async () => {
        const first = await offered(poolA);

        expect(first.names).toStrictEqual([HIT.name]);

        const rootId = await pick(poolA, first.reference);

        // The state the Maestro flow hit on its second run: the pick's root now hides the hit.
        expect((await offered(poolA)).names).toStrictEqual([]);
        expect(await rowsOf(rootId)).toStrictEqual({ food: 1, item: 1, sources: 1, picked: 1 });

        await expect(purge(poolA)).resolves.toMatchObject({ deletedPickedRoots: 1 });

        expect(await rowsOf(rootId)).toStrictEqual({ food: 0, item: 0, sources: 0, picked: 0 });

        const again = await offered(poolA);

        expect(again.names).toStrictEqual([HIT.name]);
        await expect(pick(poolA, again.reference)).resolves.not.toBe(rootId);
    });

    it('a repeat purge deletes nothing', async () => {
        const { reference } = await offered(poolA);

        await pick(poolA, reference);
        await purge(poolA);

        await expect(purge(poolA)).resolves.toMatchObject({ deletedPickedRoots: 0 });
    });

    it('⛔ keeps a root a real cook created, and never records it', async () => {
        const { reference } = await offered(real);
        const rootId = await pick(real, reference);

        await expect(purge(poolA)).resolves.toMatchObject({ deletedPickedRoots: 0 });

        expect(await rowsOf(rootId)).toStrictEqual({ food: 1, item: 1, sources: 1, picked: 0 });
    });

    it('⛔ keeps a root another test principal created', async () => {
        const { reference } = await offered(poolB);
        const rootId = await pick(poolB, reference);

        await expect(purge(poolA)).resolves.toMatchObject({ deletedPickedRoots: 0 });

        expect(await rowsOf(rootId)).toStrictEqual({ food: 1, item: 1, sources: 1, picked: 1 });
    });

    it('⛔ keeps a test-created root once a real cook is answered with it, and marks it held', async () => {
        const { reference } = await offered(poolA);
        const rootId = await pick(poolA, reference);

        // The real cook is offered nothing (the root hides the hit) but holds the reference the pool slot was shown.
        await expect(pick(real, reference)).resolves.toBe(rootId);

        const held = await pool.query<{ held_by_real_user: boolean }>(
            'SELECT held_by_real_user FROM test_picked_root WHERE food_id = $1',
            [rootId],
        );

        expect(held.rows).toStrictEqual([{ held_by_real_user: true }]);
        await expect(purge(poolA)).resolves.toMatchObject({ deletedPickedRoots: 0 });
        expect(await rowsOf(rootId)).toStrictEqual({ food: 1, item: 1, sources: 1, picked: 1 });
    });

    it('does not mark a root held when another test principal is answered with it, so its creator can still purge', async () => {
        const { reference } = await offered(poolA);
        const rootId = await pick(poolA, reference);

        await expect(pick(poolB, reference)).resolves.toBe(rootId);
        await expect(purge(poolA)).resolves.toMatchObject({ deletedPickedRoots: 1 });

        expect(await rowsOf(rootId)).toStrictEqual({ food: 0, item: 0, sources: 0, picked: 0 });
    });

    it('⛔ never reaches a catalog root the seed or a source pipeline made, whatever the pool slot has picked', async () => {
        const seeded = await makeCatalogFood(pool, { name: 'kale' });
        const { reference } = await offered(poolA);

        await pick(poolA, reference);
        await purge(poolA);

        const survivors = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM food WHERE id = $1', [
            seeded.id,
        ]);

        expect(survivors.rows).toStrictEqual([{ n: 1 }]);
    });
});
