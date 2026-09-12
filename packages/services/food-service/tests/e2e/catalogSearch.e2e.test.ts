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
 * | R45 | a root ranks by the summed weight of its item and its LIVE variants' items |
 * | R45 parity | the SQL fraction equals `normalizePriorFraction(sumPopularityWeights(…))` |
 * | R19 crosswalk to a variant | a variant item's key unshifts its root carrying the variant (S4's owner reader) |
 */
import 'reflect-metadata';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { searchResponseSchema as publishedSearchResponseSchema } from '@kitchensink/schema-food';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Hermetic: search never dials a source, and stubbing the adapter means it cannot.
vi.mock('../../src/sources/usda/usda.adapter.js', async () => {
    const { StubSourceAdapter } = await import('../support/StubSourceAdapter.js');

    return { UsdaSourceAdapter: StubSourceAdapter };
});

import { rootPriorFractionSql } from '../../src/foods/dao/foodRelevance.js';
import { normalizePriorFraction, sumPopularityWeights } from '../../src/foods/seed/fnddsPrior.js';
import { makeSeededRoot, type SeededRootSpec } from '../__fixtures__/catalogFood.js';
import { makeDb } from '../support/db.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { foodE2eDb, hasTestDatabase } from '../support/roleDb.js';
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

describe.skipIf(!hasTestDatabase)('catalog search — LOCAL e2e (booted app + real Postgres)', () => {
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
        pool = new pg.Pool({ connectionString: foodE2eDb().appUrl });
        booted = await bootFoodApp({ clerkJwtKey: keypair.publicKeyPem, authorizedParties: [APP_AZP] });
    });

    afterAll(async () => {
        await booted?.close();
        await pool?.end();
    });

    beforeEach(async () => {
        await foodE2eDb().truncate();
    });

    it('AE2: a synonym returns its one root, carrying no variant', async () => {
        const brisket = await makeSeededRoot(foodE2eDb(), BRISKET);
        await makeSeededRoot(foodE2eDb(), { name: 'pork shoulder' });

        const { results } = await search('first cut brisket');

        expect(results.map((result) => result.id)).toStrictEqual([brisket.id]);
        expect(results[0]?.name).toBe('beef brisket');
        expect(results[0]).not.toHaveProperty('variant');
    });

    it('AE3: a query naming one variant returns the root carrying that variant', async () => {
        const brisket = await makeSeededRoot(foodE2eDb(), BRISKET);
        const [flat] = brisket.variants;

        const [hit] = (await search('beef brisket flat')).results;

        expect(hit?.id).toBe(brisket.id);
        expect(hit?.name).toBe('beef brisket');
        expect(hit?.variant).toStrictEqual({ id: flat!.id, parts: [{ attribute: 'cut', text: 'flat' }] });
    });

    it('AE3: naming both variants, or neither, returns the root alone', async () => {
        const brisket = await makeSeededRoot(foodE2eDb(), BRISKET);

        for (const query of ['beef brisket flat point', 'beef brisket']) {
            const hit = (await search(query)).results.find((result) => result.id === brisket.id);

            expect(hit, query).toBeDefined();
            expect(hit, query).not.toHaveProperty('variant');
        }
    });

    it('never lists a retired root', async () => {
        const live = await makeSeededRoot(foodE2eDb(), { name: 'beef brisket' });
        const retired = await makeSeededRoot(foodE2eDb(), { name: 'beef brisket, whole', retired: true });

        const ids = (await search('beef brisket')).results.map((result) => result.id);

        expect(ids).toContain(live.id);
        expect(ids).not.toContain(retired.id);
    });

    it('R45: a root ranks by its item’s weight PLUS its live variants’ weights, never a retired variant’s', async () => {
        // Equal names but for the last letter, so only the weight can order them. X's own item carries no weight;
        // its two live variants carry 1e8 each. Y's item carries 3e7. Counting only the root's own item would put Y
        // first; Z's huge weight sits on a RETIRED variant and must count for nothing.
        const x = await makeSeededRoot(foodE2eDb(), {
            name: 'beef brisket x',
            variants: [
                { parts: [{ attribute: 'cut', text: 'flat' }], weight: 1e8 },
                { parts: [{ attribute: 'cut', text: 'point' }], weight: 1e8 },
            ],
        });
        const y = await makeSeededRoot(foodE2eDb(), { name: 'beef brisket y', weight: 3e7 });
        const z = await makeSeededRoot(foodE2eDb(), {
            name: 'beef brisket z',
            variants: [{ parts: [{ attribute: 'cut', text: 'flat' }], weight: 5e8, retired: true }],
        });

        const ids = (await search('beef brisket')).results.map((result) => result.id);

        expect(ids.indexOf(x.id)).toBeLessThan(ids.indexOf(y.id));
        expect(ids.indexOf(y.id)).toBeLessThan(ids.indexOf(z.id));
    });

    it('R45 over a broad page: the order is the weight rule’s, root item plus live variants, ties by name', async () => {
        // db-arch-1 U8 review, finding 1: the weight moved from a per-row LATERAL to pre-aggregated joins, and this
        // pins the page to the rule rather than to either statement. Every name differs only in its last word, so the
        // base metric (0.8 for these names) and the tier tie. The prior stands in for the base only where it beats it
        // (U5 max-fusion), so every positive weight here sums past 1e7, whose fraction is 0.805; only the summed weight,
        // then the name, can order them. Counting only the root's own item, or a retired variant, reorders this page.
        const flat = { attribute: 'cut', text: 'flat' } as const;
        const point = { attribute: 'cut', text: 'point' } as const;
        const specs: readonly (SeededRootSpec & { readonly live: readonly number[] })[] = [
            { name: 'beef brisket qv', weight: 5e7, live: [5e7] },
            {
                name: 'beef brisket kc',
                weight: 3e7,
                live: [3e7, 3e7],
                variants: [{ parts: [flat], weight: 3e7 }],
            },
            {
                name: 'beef brisket fw',
                weight: 3e7,
                live: [3e7],
                variants: [{ parts: [flat], weight: 9e8, retired: true }],
            },
            { name: 'beef brisket gh', live: [] },
            { name: 'beef brisket hq', weight: 4e8, live: [4e8, 4e8], variants: [{ parts: [flat], weight: 4e8 }] },
            { name: 'beef brisket jb', live: [6e8], variants: [{ parts: [flat], weight: 6e8 }] },
            {
                name: 'beef brisket nk',
                live: [4e7, 4e7],
                variants: [
                    { parts: [flat], weight: 4e7 },
                    { parts: [point], weight: 4e7 },
                ],
            },
            { name: 'beef brisket bn', weight: 1e8, live: [1e8] },
            { name: 'beef brisket pr', weight: 7e7, live: [7e7] },
            {
                name: 'beef brisket cf',
                weight: 0,
                live: [0],
                variants: [{ parts: [flat], weight: 7e7, retired: true }],
            },
            { name: 'beef brisket rj', live: [], variants: [{ parts: [flat] }] },
            {
                name: 'beef brisket vp',
                weight: 7,
                live: [7, 123456789.123],
                variants: [{ parts: [point], weight: 123456789.123 }],
            },
        ];
        const seeded = new Map<string, string>();

        for (const { live: _live, ...spec } of specs) {
            seeded.set((await makeSeededRoot(foodE2eDb(), spec)).id, spec.name);
        }

        const fraction = (live: readonly number[]): number =>
            Number(normalizePriorFraction(sumPopularityWeights(live)));
        const expected = [...specs]
            .sort((a, b) => fraction(b.live) - fraction(a.live) || (a.name < b.name ? -1 : 1))
            .map((spec) => spec.name);
        const page = (await search('beef brisket')).results
            .filter((result) => seeded.has(result.id))
            .map((result) => seeded.get(result.id));

        expect(new Set(specs.map((spec) => fraction(spec.live))).size).toBeLessThan(specs.length);
        expect(page).toStrictEqual(expected);
    });

    // Rewritten for S4: the unshift reads through the owner reader, so a variant-owned key answers as its root.
    it('⛔ R19: a USDA key owned by a VARIANT unshifts its ROOT carrying the variant, at score 1', async () => {
        const brisket = await makeSeededRoot(foodE2eDb(), {
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

describe.skipIf(!hasTestDatabase)('R45 parity — the SQL fraction restates normalizePriorFraction', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: foodE2eDb().appUrl });
    });

    afterAll(async () => {
        await pool?.end();
    });

    it.each([
        { weights: [] },
        { weights: [0] },
        { weights: [1] },
        { weights: [0.1, 0.2] },
        { weights: [1234.5678, 98765.4321] },
        { weights: [3e7] },
        { weights: [1e8, 1e8] },
        { weights: [5e8] },
        { weights: [4e8, 4e8] },
        { weights: [4.6e8, 123456789.123, 7] },
    ])('agrees with the TypeScript for $weights', async ({ weights }) => {
        const expected = Number(normalizePriorFraction(sumPopularityWeights(weights)));
        const summed = sql`(SELECT sum(w) FROM unnest(${sql.param(weights.map(String))}::numeric[]) AS w)`;

        const result = await makeDb(pool).execute<{ fraction: number }>(
            sql`SELECT ${rootPriorFractionSql(summed)} AS fraction`,
        );

        expect(Number(result.rows[0]?.fraction)).toBe(expected);
    });
});
