/**
 * LOCAL e2e — the split food search's privacy, against a REAL migrated Postgres (plan 002 R40, S3). Boots the real app
 * as `food_app` (ADR-0039) behind the real `FoodAuthGuard` over genuinely signed tokens. Target: LOCAL
 * (`docs/CODING_STANDARDS.md` §7.1a): it proves the code and the schema, never a deploy.
 *
 * ⛔ It never skips. With no database it fails, because a skipped privacy suite reports nothing and reads as a pass.
 *
 * The production edge shares the catalog route's answer across every caller on its URL (ADR-0020), so the SQL behind
 * it must return the same rows whoever asks. Every hostile row is written straight into the table and shares the query
 * words, so only the statement's own predicate can keep it out:
 *
 * | Hostile row (all named "saffron rice …")         | Catalog route              | Authored route            |
 * | ------------------------------------------------ | -------------------------- | ------------------------- |
 * | A's and B's private authored foods               | never                      | each to its own author    |
 * | A's authored food carrying a barcode             | never, even by the barcode | to A, by name only        |
 * | A's WITHDRAWN and DELETING foods                 | never                      | never                     |
 * | a retired catalog root, a PENDING catalog row    | never, by name or barcode  | never                     |
 * | `fetch_requesters` rows for A                    | cannot move rank or score  | —                         |
 * | A's authored food whose item holds a USDA key    | never, by that key         | never, by that key        |
 * | a catalog root that left RESOLVED, keeping a key | never, by that key         | —                         |
 *
 * Positive controls: a resolved catalog root that every caller must receive, a catalog barcode that resolves, and a
 * catalog USDA key that resolves.
 */
import 'reflect-metadata';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import {
    authoredFoodSearchResponseSchema,
    catalogSearchResponseSchema,
    foodErrorSchema,
} from '@kitchensink/schema-food';
import pg from 'pg';
import { ulid } from 'ulidx';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Hermetic: search never dials a source, and stubbing the adapter means it cannot.
vi.mock('../../src/sources/usda/usda.adapter.js', async () => {
    const { StubSourceAdapter } = await import('../support/StubSourceAdapter.js');

    return { UsdaSourceAdapter: StubSourceAdapter };
});

import { makeCatalogFood, makeSeededRoot } from '../__fixtures__/catalogFood.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { foodDb } from '../support/roleDb.js';
import { bootFoodApp, callFoodApi, type FoodApiResponse } from './harness.js';

const APP_AZP = 'https://app.example.com';
const M2M_AZP = 'svc-catalog-search-client';
const A_ULID = '01J9ZK8N7QF3B2X4M6T0V5CAAA';
const B_ULID = '01J9ZK8N7QF3B2X4M6T0V5CBBB';
const keypair = generateClerkKeypair();
const TOKENS = {
    a: mintToken(keypair.privateKeyPem, { sub: 'user_split_a', externalId: A_ULID, azp: APP_AZP }),
    b: mintToken(keypair.privateKeyPem, { sub: 'user_split_b', externalId: B_ULID, azp: APP_AZP }),
    service: mintToken(keypair.privateKeyPem, { sub: 'svc_split_e2e', azp: M2M_AZP }),
} as const;

const QUERY = 'saffron rice';
/** Digits only, so no name can match and only the crosswalk can return a row. */
const BARCODES = {
    authored: '0049000028911',
    catalog: '0012000161155',
    pending: '0012000161162',
    retired: '0012000161179',
} as const;
/** USDA item keys, as the adapter spells them (bare digits): only the key crosswalk can return a row for these. */
const USDA_KEYS = { authored: '9990022', catalog: '9990011', pending: '9990033' } as const;

describe('the split food search keeps private foods private — LOCAL e2e (booted app + real Postgres)', () => {
    let booted: BootedServiceApp;
    let pool: pg.Pool;
    /** The ids every caller may receive. */
    const control = { root: '', barcodeRoot: '', keyRoot: '' };
    /** The ids no caller may receive from the catalog route. */
    const hostile: Record<string, string> = {};
    /** The catalog bodies taken BEFORE any hostile row existed. */
    const before: Partial<Record<keyof typeof TOKENS, string>> = {};

    /**
     * Write one food as the service role, then set what only the owner may set.
     *
     * @param fields - The food's name, author, status and visibility.
     * @param owner - An `UPDATE food SET … WHERE id = $1` tail to run as the owner (a barcode, a retirement).
     * @returns The food's id.
     */
    async function food(
        fields: Parameters<typeof makeCatalogFood>[1],
        owner?: { readonly set: string; readonly params: readonly unknown[] },
    ): Promise<string> {
        const { id } = await makeCatalogFood(pool, { id: ulid(), ...fields });

        if (owner !== undefined) {
            await foodDb().asOwner(async (client) => {
                await client.query(`UPDATE food SET ${owner.set} WHERE id = $1`, [id, ...owner.params]);
            });
        }

        return id;
    }

    /**
     * Write one food whose item holds a `usda` source row, the row written as the owner so no role grant can stand in
     * for a constraint.
     *
     * @param fields - The food's name, author and status.
     * @param key - The USDA key, as the adapter spells it.
     * @returns The food's id.
     */
    async function keyedFood(fields: Parameters<typeof makeCatalogFood>[1], key: string): Promise<string> {
        const { id, itemId } = await makeCatalogFood(pool, { id: ulid(), ...fields });

        await foodDb().asOwner(async (client) => {
            await client.query(
                "INSERT INTO food_sources (id, item_id, source, external_key) VALUES ($1, $2, 'usda', $3)",
                [`source-${ulid()}`, itemId, key],
            );
        });

        return id;
    }

    /**
     * Search one route as one caller.
     *
     * @param route - `catalog` or `authored`.
     * @param caller - Whose token.
     * @param query - The term.
     * @returns The response.
     */
    async function search(
        route: 'catalog' | 'authored',
        caller: keyof typeof TOKENS,
        query: string,
    ): Promise<FoodApiResponse> {
        const res = await callFoodApi(
            booted.baseUrl,
            'GET',
            `/api/v1/foods/${route}/search?query=${encodeURIComponent(query)}`,
            { token: TOKENS[caller] },
        );

        expect(res.status, res.text).toBe(200);

        return res;
    }

    /**
     * The ids in a catalog answer, parsed by the PUBLISHED schema.
     *
     * @param res - The response.
     * @returns The ids, in order.
     */
    function catalogIds(res: FoodApiResponse): string[] {
        return catalogSearchResponseSchema.parse(res.body).results.map((hit) => hit.id);
    }

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: foodDb().appUrl });
        booted = await bootFoodApp({ clerkJwtKey: keypair.publicKeyPem, authorizedParties: [APP_AZP, M2M_AZP] });
        await foodDb().truncate();

        control.root = await food({ name: QUERY });
        control.barcodeRoot = await food({ name: 'cereal bar' }, { set: 'barcode = $2', params: [BARCODES.catalog] });
        control.keyRoot = await keyedFood({ name: 'keyed lentils' }, USDA_KEYS.catalog);

        for (const caller of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
            before[caller] = (await search('catalog', caller, QUERY)).text;
        }

        hostile['aPrivate'] = await food({ name: `${QUERY} a`, userId: A_ULID });
        hostile['bPrivate'] = await food({ name: `${QUERY} b`, userId: B_ULID });
        hostile['aBarcode'] = await food(
            { name: `${QUERY} barcode`, userId: A_ULID },
            { set: 'barcode = $2', params: [BARCODES.authored] },
        );
        hostile['aWithdrawn'] = await food({ name: `${QUERY} withdrawn`, userId: A_ULID, status: 'WITHDRAWN' });
        hostile['aDeleting'] = await food({ name: `${QUERY} deleting`, userId: A_ULID, status: 'DELETING' });
        // A retired root is a seed-owned one (a live catalog row retires only with a forward, ADR-0050 §4).
        hostile['retired'] = (await makeSeededRoot(foodDb(), { name: `${QUERY} retired`, retired: true })).id;
        await foodDb().asOwner(async (client) => {
            await client.query('UPDATE food SET barcode = $2 WHERE id = $1', [hostile['retired'], BARCODES.retired]);
        });
        hostile['pending'] = await food(
            { name: `${QUERY} pending`, status: 'PENDING' },
            { set: 'barcode = $2', params: [BARCODES.pending] },
        );

        hostile['aKeyed'] = await keyedFood({ name: 'keyed lentils a', userId: A_ULID }, USDA_KEYS.authored);
        // Resolved when its key was written, then moved back: the row keeps the key it was resolved with.
        hostile['pendingKeyed'] = await keyedFood({ name: 'keyed lentils pending' }, USDA_KEYS.pending);
        await foodDb().asOwner(async (client) => {
            await client.query("UPDATE food SET status = 'PENDING' WHERE id = $1", [hostile['pendingKeyed']]);
        });

        // Demand A recorded against the catalog root and the pending row: ranking must not read it.
        await pool.query('INSERT INTO fetch_requesters (food_id, requester_id) VALUES ($1, $3), ($2, $3)', [
            control.root,
            hostile['pending'],
            A_ULID,
        ]);
    });

    afterAll(async () => {
        await booted?.close();
        await pool?.end();
    });

    it('⛔ answers A, B and a service the SAME bytes, holding the control and no hostile row', async () => {
        const answers = await Promise.all(
            (Object.keys(TOKENS) as (keyof typeof TOKENS)[]).map(async (caller) => search('catalog', caller, QUERY)),
        );

        expect(catalogIds(answers[0]!)).toStrictEqual([control.root]);

        for (const answer of answers) {
            expect(answer.text).toBe(answers[0]!.text);
        }
    });

    it('⛔ answers every caller exactly what it answered before any hostile row existed', async () => {
        for (const caller of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
            expect((await search('catalog', caller, QUERY)).text, caller).toBe(before[caller]);
        }
    });

    it('⛔ never returns an authored food by its barcode, not even to its own author', async () => {
        for (const caller of ['a', 'b'] as const) {
            expect(catalogIds(await search('catalog', caller, BARCODES.authored)), caller).toStrictEqual([]);
            expect(
                authoredFoodSearchResponseSchema.parse((await search('authored', caller, BARCODES.authored)).body)
                    .results,
                caller,
            ).toStrictEqual([]);
        }
    });

    it('never returns a PENDING or a retired catalog row by its barcode', async () => {
        expect(catalogIds(await search('catalog', 'a', BARCODES.pending))).toStrictEqual([]);
        expect(catalogIds(await search('catalog', 'a', BARCODES.retired))).toStrictEqual([]);
    });

    it('returns a live catalog food by its barcode to any caller, at score 1 (the positive control)', async () => {
        for (const caller of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
            expect(
                catalogSearchResponseSchema.parse((await search('catalog', caller, BARCODES.catalog)).body),
            ).toStrictEqual({ results: [{ id: control.barcodeRoot, name: 'cereal bar', score: 1 }] });
        }
    });

    it('returns a live catalog food by its USDA key to any caller, at score 1 (the positive control)', async () => {
        for (const caller of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
            expect(
                catalogSearchResponseSchema.parse((await search('catalog', caller, USDA_KEYS.catalog)).body),
                caller,
            ).toStrictEqual({ results: [{ id: control.keyRoot, name: 'keyed lentils', score: 1 }] });
        }
    });

    it('⛔ never returns an authored food by the USDA key its item holds, not even to its own author', async () => {
        for (const caller of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
            expect(catalogIds(await search('catalog', caller, USDA_KEYS.authored)), caller).toStrictEqual([]);
        }

        expect(
            authoredFoodSearchResponseSchema.parse((await search('authored', 'a', USDA_KEYS.authored)).body).results,
        ).toStrictEqual([]);
    });

    it('⛔ never returns a catalog root that left RESOLVED by the USDA key it kept', async () => {
        for (const caller of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
            expect(catalogIds(await search('catalog', caller, USDA_KEYS.pending)), caller).toStrictEqual([]);
        }
    });

    it('answers each author exactly their own RESOLVED foods on the authored route', async () => {
        const answerA = await search('authored', 'a', QUERY);
        const forA = authoredFoodSearchResponseSchema.parse(answerA.body).results;
        const forB = authoredFoodSearchResponseSchema.parse((await search('authored', 'b', QUERY)).body).results;

        expect(forA.map((hit) => hit.id).sort()).toStrictEqual([hostile['aPrivate'], hostile['aBarcode']].sort());
        expect(forB.map((hit) => hit.id)).toStrictEqual([hostile['bPrivate']]);
        // The route is what makes these the cook's own (S3 security review, I1), so the body never says it.
        expect(answerA.text).not.toContain('visibility');
    });

    // sec-aud-1 S3 review, F3: Postgres `text` cannot hold a NUL, so the term used to fail in the database as a 500.
    it('refuses a NUL byte in the term with 400 on both routes, before the database sees it', async () => {
        for (const route of ['catalog', 'authored'] as const) {
            const res = await callFoodApi(booted.baseUrl, 'GET', `/api/v1/foods/${route}/search?query=saffron%00rice`, {
                token: TOKENS.a,
            });

            expect(res.status, route).toBe(400);
            expect(foodErrorSchema.parse(res.body).code, route).toBe('VALIDATION_FAILED');
        }
    });

    it('answers a service principal an empty authored list', async () => {
        expect(authoredFoodSearchResponseSchema.parse((await search('authored', 'service', QUERY)).body)).toStrictEqual(
            {
                results: [],
            },
        );
    });

    it('scores an authored hit on the catalog route’s scale: one sort key for both routes', async () => {
        const [catalogHit] = catalogSearchResponseSchema.parse((await search('catalog', 'a', QUERY)).body).results;
        const authoredHits = authoredFoodSearchResponseSchema.parse(
            (await search('authored', 'a', QUERY)).body,
        ).results;

        // The exact-name catalog root outranks every longer authored name on the one sort key.
        expect(catalogHit?.score).toBeGreaterThan(0);
        expect(authoredHits.length).toBeGreaterThan(0);
        expect(authoredHits.every((hit) => hit.score > 0 && hit.score < (catalogHit?.score ?? 0))).toBe(true);
    });
});
