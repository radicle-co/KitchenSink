/**
 * LOCAL e2e — catalog search over seeded roots and variants, against a REAL migrated Postgres (curated plan U8 S3).
 * Boots the real app as `food_app` (ADR-0039) behind the real `FoodAuthGuard`; the seeded roots are written as the
 * owner (R47). Target: LOCAL (`docs/CODING_STANDARDS.md` §7.1a) — it proves the code and the schema, never a deploy.
 *
 * | Requirement | Pinned here |
 * | --- | --- |
 * | AE2 | `first cut brisket` (a synonym) returns one result, `beef brisket`, with no variant |
 * | AE3 | a query naming one variant returns its root carrying it; two or none return the root alone |
 * | ADR-0050 §4 | a retired root is never listed, by name or by crosswalk |
 * | Text match only (owner, 2026-10-01) | `flour` lists `carob flour` above `all-purpose flour`; the wire carries no weight |
 * | R19 crosswalk to a variant | a variant item's key unshifts its root carrying the variant (S4's owner reader) |
 */
import 'reflect-metadata';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { searchResponseSchema as publishedSearchResponseSchema } from '@kitchensink/schema-food';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Hermetic: search never dials a source, and stubbing the adapter means it cannot.
vi.mock('../../src/sources/usda/usda.adapter.js', async () => {
    const { StubSourceAdapter } = await import('../support/StubSourceAdapter.js');

    return { UsdaSourceAdapter: StubSourceAdapter };
});

import { makeSeededRoot, type SeededRootSpec } from '../__fixtures__/catalogFood.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { foodDb } from '../support/roleDb.js';
import { bootFoodApp, callFoodApi } from './harness.js';

const APP_AZP = 'https://app.example.com';

const keypair = generateClerkKeypair();
const userToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_catalog_search',
    externalId: '01J9ZK8N7QF3B2X4M6T0V5C1AB',
    azp: APP_AZP,
});

const BRISKET: SeededRootSpec = {
    name: 'beef brisket',
    synonyms: ['first cut brisket'],
    variants: [{ parts: [{ attribute: 'cut', text: 'flat' }] }, { parts: [{ attribute: 'cut', text: 'point' }] }],
};

describe('catalog search — LOCAL e2e (booted app + real Postgres)', () => {
    let booted: BootedServiceApp;
    let pool: pg.Pool;

    /** Search as a user; the body parsed by the PUBLISHED schema. */
    async function search(query: string): Promise<ReturnType<typeof publishedSearchResponseSchema.parse>> {
        const res = await callFoodApi(
            booted.baseUrl,
            'GET',
            `/api/v1/foods/search?query=${encodeURIComponent(query)}`,
            {
                token: userToken,
            },
        );

        expect(res.status).toBe(200);

        return publishedSearchResponseSchema.parse(res.body);
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

    it('AE2: a synonym returns its one root, carrying no variant', async () => {
        const brisket = await makeSeededRoot(foodDb(), BRISKET);
        await makeSeededRoot(foodDb(), { name: 'pork shoulder' });

        const { results } = await search('first cut brisket');

        expect(results.map((result) => result.id)).toStrictEqual([brisket.id]);
        expect(results[0]?.name).toBe('beef brisket');
        expect(results[0]).not.toHaveProperty('variant');
    });

    it('AE3: a query naming one variant returns the root carrying that variant', async () => {
        const brisket = await makeSeededRoot(foodDb(), BRISKET);
        const [flat] = brisket.variants;

        const [hit] = (await search('beef brisket flat')).results;

        expect(hit?.id).toBe(brisket.id);
        expect(hit?.name).toBe('beef brisket');
        expect(hit?.variant).toStrictEqual({ id: flat!.id, parts: [{ attribute: 'cut', text: 'flat' }] });
    });

    it('AE3: naming both variants, or neither, returns the root alone', async () => {
        const brisket = await makeSeededRoot(foodDb(), BRISKET);

        for (const query of ['beef brisket flat point', 'beef brisket']) {
            const hit = (await search(query)).results.find((result) => result.id === brisket.id);

            expect(hit, query).toBeDefined();
            expect(hit, query).not.toHaveProperty('variant');
        }
    });

    it('never lists a retired root', async () => {
        const live = await makeSeededRoot(foodDb(), { name: 'beef brisket' });
        const retired = await makeSeededRoot(foodDb(), { name: 'beef brisket, whole', retired: true });

        const ids = (await search('beef brisket')).results.map((result) => result.id);

        expect(ids).toContain(live.id);
        expect(ids).not.toContain(retired.id);
    });

    it('ranks by text match alone: `flour` lists `carob flour` above `all-purpose flour`', async () => {
        // ⛔ Owner ruling, 2026-10-01: "Text match only for now. ... a proper additional sorting method would need
        // infrastructure on our end; we can't rely on USDA solely since we have multiple sources." Both names hold the
        // query word without heading it, so they share a rung, and the shorter name is the closer text match. This
        // order is the accepted consequence of the ruling, not a defect to repair with a weight.
        const allPurpose = await makeSeededRoot(foodDb(), { name: 'all-purpose flour' });
        const carob = await makeSeededRoot(foodDb(), { name: 'carob flour' });

        const ids = (await search('flour')).results.map((result) => result.id);

        expect(ids).toContain(allPurpose.id);
        expect(ids.indexOf(carob.id)).toBeLessThan(ids.indexOf(allPurpose.id));
    });

    it('carries no popularity figure on the wire, for a search hit or a food read', async () => {
        const root = await makeSeededRoot(foodDb(), { name: 'beef brisket' });

        const searched = await callFoodApi(booted.baseUrl, 'GET', '/api/v1/foods/search?query=beef%20brisket', {
            token: userToken,
        });
        const read = await callFoodApi(booted.baseUrl, 'GET', `/api/v1/foods/${root.id}`, { token: userToken });

        expect(searched.status).toBe(200);
        expect(read.status).toBe(200);
        expect(JSON.stringify(searched.body)).not.toMatch(/prior|popularity|weight/i);
        expect(read.body).not.toHaveProperty('priorFraction');
    });

    // Rewritten for S4: the unshift reads through the owner reader, so a variant-owned key answers as its root.
    it('⛔ R19: a USDA key owned by a VARIANT unshifts its ROOT carrying the variant, at score 1', async () => {
        const brisket = await makeSeededRoot(foodDb(), {
            ...BRISKET,
            variants: [{ parts: [{ attribute: 'cut', text: 'flat' }], sourceKey: '7770001' }],
        });

        expect((await search('7770001')).results).toStrictEqual([
            {
                id: brisket.id,
                name: 'beef brisket',
                score: 1,
                variant: { id: brisket.variants[0]!.id, parts: [{ attribute: 'cut', text: 'flat' }] },
            },
        ]);
    });
});
