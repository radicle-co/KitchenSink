/**
 * LOCAL e2e — the catalog owner reader over a REAL migrated Postgres (curated plan U8 S4, R19). The DAOs connect as
 * `food_app` (ADR-0039); the seeded rows are written as the owner (R47). Target: LOCAL (`docs/CODING_STANDARDS.md`
 * §7.1a) — it proves the code and the schema, never a deploy.
 *
 * Every key comes from the REAL USDA adapter over the real client's parse of a USDA search body, so a spelling
 * mismatch between the adapter (`String(fdcId)`) and what the crosswalk stores fails here.
 *
 * | Requirement | Pinned here |
 * | --- | --- |
 * | R19 owner | a root-owned and a variant-owned item resolve to their owners, under the root's name |
 * | R19 owner beats stand-in | an item that is owned AND cited returns its owner |
 * | stand-in | an unowned key cited by a seed root returns that root; two citing roots resolve by match, then name |
 * | ADR-0050 §4 forwards | a retired root follows its forward; a cycle and a chain past the bound answer nothing |
 */
import { UsdaApiClient } from '@kitchensink/usda-client';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { CatalogOwnerReader } from '../../src/foods/catalogOwnerReader.service.js';
import { MAX_FORWARD_HOPS } from '../../src/foods/dao/foodForward.dao.js';
import { LiveFoodSearchService } from '../../src/foods/liveSearch.service.js';
import { SourceAdapterRegistry } from '../../src/sources/SourceAdapterRegistry.js';
import { UsdaSourceAdapter } from '../../src/sources/usda/usda.adapter.js';
import { makeSeededRoot } from '../__fixtures__/catalogFood.js';
import { makeDb } from '../support/db.js';
import { makeCatalogOwnerReader } from '../support/ownerReader.js';
import { foodE2eDb, hasTestDatabase } from '../support/roleDb.js';

/**
 * The keys the real adapter produces for a USDA search body naming these FDC ids.
 *
 * @param fdcIds - The FDC ids USDA answers with.
 * @returns The adapter's external keys, in order.
 * @sideEffect None beyond the stubbed `fetch`; no network.
 */
async function adapterKeys(...fdcIds: number[]): Promise<string[]> {
    return (await usdaAdapterAnswering(...fdcIds).searchByName('brisket')).map((hit) => hit.externalKey);
}

/**
 * The real USDA adapter over the real client, whose `fetch` answers a search with these FDC ids.
 *
 * @param fdcIds - The FDC ids USDA answers with, each described as `USDA <id>`.
 * @returns The adapter.
 */
function usdaAdapterAnswering(...fdcIds: number[]): UsdaSourceAdapter {
    const body = { totalHits: fdcIds.length, foods: fdcIds.map((fdcId) => ({ fdcId, description: `USDA ${fdcId}` })) };

    return new UsdaSourceAdapter(
        new UsdaApiClient({
            apiKey: 'e2e-stub-key',
            fetchFn: async () =>
                new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
        }),
    );
}

describe.skipIf(!hasTestDatabase)('CatalogOwnerReader — LOCAL e2e (real Postgres)', () => {
    let pool: pg.Pool;
    let reader: CatalogOwnerReader;
    let unresolved: string[];

    /** Forward `sourceId` (a retired root) to a target, as the seed would. */
    async function forward(sourceId: string, target: { foodId: string } | { variantId: string }): Promise<void> {
        await foodE2eDb().asOwner((client) =>
            client.query(
                `INSERT INTO food_forward (source_id, source_kind, target_food_id, target_variant_id)
                 VALUES ($1, 'root', $2, $3)`,
                [sourceId, 'foodId' in target ? target.foodId : null, 'variantId' in target ? target.variantId : null],
            ),
        );
    }

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: foodE2eDb().appUrl });
        const db = makeDb(pool);
        reader = makeCatalogOwnerReader(db, (line) => {
            unresolved.push(line);
        });
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        unresolved = [];
        await foodE2eDb().truncate();
    });

    it('R19: a root-owned key resolves to its root, under the root’s name', async () => {
        const [key] = await adapterKeys(174531);
        const brisket = await makeSeededRoot(foodE2eDb(), { name: 'beef brisket', sourceKey: key });

        expect((await reader.ownersOfKeys('usda', [key!])).get(key!)).toStrictEqual({
            kind: 'root',
            id: brisket.id,
            rootId: brisket.id,
            rootName: 'beef brisket',
            seedOwned: true,
            parts: [],
        });
    });

    it('R19: a variant-owned key resolves to the variant, under its root, with its parts in order', async () => {
        const [key] = await adapterKeys(174532);
        const brisket = await makeSeededRoot(foodE2eDb(), {
            name: 'beef brisket',
            variants: [
                {
                    parts: [
                        { attribute: 'trim', text: 'separable lean' },
                        { attribute: 'cut', text: 'flat' },
                    ],
                    sourceKey: key,
                },
            ],
        });

        expect((await reader.ownersOfKeys('usda', [key!])).get(key!)).toStrictEqual({
            kind: 'variant',
            id: brisket.variants[0]!.id,
            rootId: brisket.id,
            rootName: 'beef brisket',
            seedOwned: true,
            parts: [
                { attribute: 'cut', ordinal: 0, text: 'flat' },
                { attribute: 'trim', ordinal: 0, text: 'separable lean' },
            ],
        });
    });

    it('⛔ R19: an item that is owned AND cited by a stand-in resolves to its OWNER', async () => {
        const [key] = await adapterKeys(174533);
        const brisket = await makeSeededRoot(foodE2eDb(), { name: 'beef brisket', sourceKey: key });
        await makeSeededRoot(foodE2eDb(), { name: 'pastrami', citation: { key: key!, match: 'exact' } });

        expect((await reader.ownersOfKeys('usda', [key!])).get(key!)?.id).toBe(brisket.id);
    });

    it('an unowned key resolves to the seed root that cites it; the closer match wins a tie', async () => {
        const [key] = await adapterKeys(174534);
        await makeSeededRoot(foodE2eDb(), { name: 'a close crust', citation: { key: key!, match: 'close' } });
        const crust = await makeSeededRoot(foodE2eDb(), {
            name: 'pizza crust',
            citation: { key: key!, match: 'exact' },
        });

        expect((await reader.ownersOfKeys('usda', [key!])).get(key!)?.id).toBe(crust.id);
    });

    // Rewritten for the db-arch-1 U8 review: the tie-break was the name, whose order is the database's collation. It is
    // now the unique seed key in byte order. The names order the other way, and `curated:ab` sorts before `curated:a-c`
    // under en_US (which ignores the hyphen) but after it in bytes, so a name or a collated key picks the other root.
    it('between two equal stand-ins, the seed key decides in byte order — never the name or the collation', async () => {
        const [key] = await adapterKeys(174535);
        const first = await makeSeededRoot(foodE2eDb(), {
            name: 'zeta crust',
            seedKey: 'curated:a-c',
            citation: { key: key!, match: 'exact' },
        });
        await makeSeededRoot(foodE2eDb(), {
            name: 'alpha crust',
            seedKey: 'curated:ab',
            citation: { key: key!, match: 'exact' },
        });

        expect((await reader.ownersOfKeys('usda', [key!])).get(key!)?.id).toBe(first.id);
    });

    it('follows a retired root’s forward to a live variant', async () => {
        const [key] = await adapterKeys(174536);
        const old = await makeSeededRoot(foodE2eDb(), { name: 'brisket, old', sourceKey: key, retired: true });
        const brisket = await makeSeededRoot(foodE2eDb(), {
            name: 'beef brisket',
            variants: [{ parts: [{ attribute: 'cut', text: 'flat' }] }],
        });
        await forward(old.id, { variantId: brisket.variants[0]!.id });

        expect((await reader.ownersOfKeys('usda', [key!])).get(key!)).toMatchObject({
            kind: 'variant',
            id: brisket.variants[0]!.id,
            rootId: brisket.id,
            rootName: 'beef brisket',
        });
    });

    it('⛔ a forward cycle answers nothing and records the metric — never a 500', async () => {
        const [key] = await adapterKeys(174537);
        const a = await makeSeededRoot(foodE2eDb(), { name: 'cycle a', sourceKey: key, retired: true });
        const b = await makeSeededRoot(foodE2eDb(), { name: 'cycle b', retired: true });
        await forward(a.id, { foodId: b.id });
        await forward(b.id, { foodId: a.id });

        expect(await reader.ownersOfKeys('usda', [key!])).toStrictEqual(new Map());
        expect(unresolved.join('\n')).toContain('food-forward-unresolved');
    });

    it(`⛔ a chain longer than ${MAX_FORWARD_HOPS} hops answers nothing and records the metric`, async () => {
        const [key] = await adapterKeys(174538);
        const chain = [await makeSeededRoot(foodE2eDb(), { name: 'hop 0', sourceKey: key, retired: true })];

        for (let hop = 1; hop <= MAX_FORWARD_HOPS + 1; hop += 1) {
            chain.push(await makeSeededRoot(foodE2eDb(), { name: `hop ${hop}`, retired: hop <= MAX_FORWARD_HOPS }));
        }

        for (let hop = 0; hop < chain.length - 1; hop += 1) {
            await forward(chain[hop]!.id, { foodId: chain[hop + 1]!.id });
        }

        expect(await reader.ownersOfKeys('usda', [key!])).toStrictEqual(new Map());
        expect(unresolved.join('\n')).toContain('food-forward-unresolved');
    });

    it(`resolves a chain of exactly ${MAX_FORWARD_HOPS} hops`, async () => {
        const [key] = await adapterKeys(174539);
        const chain = [await makeSeededRoot(foodE2eDb(), { name: 'hop 0', sourceKey: key, retired: true })];

        for (let hop = 1; hop <= MAX_FORWARD_HOPS; hop += 1) {
            chain.push(await makeSeededRoot(foodE2eDb(), { name: `hop ${hop}`, retired: hop < MAX_FORWARD_HOPS }));
        }

        for (let hop = 0; hop < chain.length - 1; hop += 1) {
            await forward(chain[hop]!.id, { foodId: chain[hop + 1]!.id });
        }

        expect((await reader.ownersOfKeys('usda', [key!])).get(key!)?.id).toBe(chain[MAX_FORWARD_HOPS]!.id);
        expect(unresolved).toStrictEqual([]);
    });

    it('⛔ R19 end to end: live search shows a seeded item under its root and variant, never the USDA description', async () => {
        const brisket = await makeSeededRoot(foodE2eDb(), {
            name: 'beef brisket',
            sourceKey: '174540',
            variants: [{ parts: [{ attribute: 'cut', text: 'flat' }], sourceKey: '174541' }],
        });
        const registry = new SourceAdapterRegistry();
        registry.register(usdaAdapterAnswering(174540, 174541, 999999));

        const { results } = await new LiveFoodSearchService(registry, reader).search('brisket');

        expect(results).toStrictEqual([
            { name: 'beef brisket', id: brisket.id },
            {
                name: 'beef brisket',
                id: brisket.id,
                variant: { id: brisket.variants[0]!.id, parts: [{ attribute: 'cut', text: 'flat' }] },
            },
            { name: 'USDA 999999' },
        ]);
    });
});
