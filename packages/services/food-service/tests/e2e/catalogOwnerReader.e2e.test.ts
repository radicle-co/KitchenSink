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
 * | stand-in | an unowned key cited EXACTLY by a seed root returns that root; any other grade returns none |
 * | ADR-0050 §4 forwards | a retired root follows its forward; a cycle and a chain past the bound answer nothing |
 * | R19 lineage | a Foundation hit with an FDC id the seed does not hold answers as the entry holding its NDB number |
 * | ADR-0055 point 4 | the progressive search's triage hides every hit the reader says the catalog holds |
 *
 * The last row's two cases drove the live search until plan 002 S7.9 deleted it; they now drive the progressive
 * search's rule (`remoteHitTriage.ts`), which hides a held hit where the live search showed it under its root.
 */
import type { RemoteSearchItem } from '@kitchensink/schema-remote-search';
import { UsdaApiClient } from '@kitchensink/usda-client';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { CatalogOwnerReader, SourceKeyRef } from '../../src/foods/catalogOwnerReader.service.js';
import { MAX_FORWARD_HOPS } from '../../src/foods/dao/foodForward.dao.js';
import { triageRemoteHits } from '../../src/foods/domain/remoteHitTriage.js';
import type { SourceCandidate } from '../../src/sources/foodSourceAdapter.js';
import { UsdaSourceAdapter } from '../../src/sources/usda/usda.adapter.js';
import { makeSeededRoot } from '../__fixtures__/catalogFood.js';
import { makeDb } from '../support/db.js';
import { makeCatalogOwnerReader } from '../support/ownerReader.js';
import { foodDb } from '../support/roleDb.js';

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
 * Source hits as the remote search service answers them: the same key and lineage mapping
 * (`@kitchensink/usda-client`'s `usdaSearchCandidate`), without the source tag.
 *
 * @param hits - The adapter's hits.
 * @returns The items.
 */
function asRemoteItems(hits: readonly SourceCandidate[]): RemoteSearchItem[] {
    return hits.map(({ externalKey, name, lineageKey }) => ({ externalKey, name, lineageKey }));
}

/**
 * Keys as a caller with no lineage passes them.
 *
 * @param externalKeys - The keys.
 * @returns Each key with a `null` lineage key.
 */
function keyRefs(...externalKeys: string[]): SourceKeyRef[] {
    return externalKeys.map((externalKey) => ({ externalKey, lineageKey: null }));
}

/** One USDA search hit as the live API sends it: `ndbNumber` is an integer there. */
interface UsdaHit {
    readonly fdcId: number;
    readonly dataType?: string;
    readonly ndbNumber?: number;
}

/**
 * The real USDA adapter over the real client, whose `fetch` answers a search with these FDC ids.
 *
 * @param fdcIds - The FDC ids USDA answers with, each described as `USDA <id>`.
 * @returns The adapter.
 */
function usdaAdapterAnswering(...fdcIds: number[]): UsdaSourceAdapter {
    return usdaAdapterAnsweringHits(fdcIds.map((fdcId) => ({ fdcId })));
}

/**
 * The real USDA adapter over the real client, whose `fetch` answers a search with these hits.
 *
 * @param hits - The hits, each described as `USDA <id>`.
 * @returns The adapter.
 */
function usdaAdapterAnsweringHits(hits: readonly UsdaHit[]): UsdaSourceAdapter {
    const body = { totalHits: hits.length, foods: hits.map((hit) => ({ ...hit, description: `USDA ${hit.fdcId}` })) };

    return new UsdaSourceAdapter(
        new UsdaApiClient({
            apiKey: 'e2e-stub-key',
            fetchFn: async () =>
                new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
        }),
    );
}

describe('CatalogOwnerReader — LOCAL e2e (real Postgres)', () => {
    let pool: pg.Pool;
    let reader: CatalogOwnerReader;
    let unresolved: string[];

    /** Forward `sourceId` (a retired root) to a target, as the seed would. */
    async function forward(sourceId: string, target: { foodId: string } | { variantId: string }): Promise<void> {
        await foodDb().asOwner((client) =>
            client.query(
                `INSERT INTO food_forward (source_id, source_kind, target_food_id, target_variant_id)
                 VALUES ($1, 'root', $2, $3)`,
                [sourceId, 'foodId' in target ? target.foodId : null, 'variantId' in target ? target.variantId : null],
            ),
        );
    }

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: foodDb().appUrl });
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
        await foodDb().truncate();
    });

    it('R19: a root-owned key resolves to its root, under the root’s name', async () => {
        const [key] = await adapterKeys(174531);
        const brisket = await makeSeededRoot(foodDb(), { name: 'beef brisket', sourceKey: key });

        expect((await reader.ownersOfKeys('usda', keyRefs(key!))).get(key!)).toStrictEqual({
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
        const brisket = await makeSeededRoot(foodDb(), {
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

        expect((await reader.ownersOfKeys('usda', keyRefs(key!))).get(key!)).toStrictEqual({
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
        const brisket = await makeSeededRoot(foodDb(), { name: 'beef brisket', sourceKey: key });
        await makeSeededRoot(foodDb(), { name: 'pastrami', citation: { key: key!, match: 'exact' } });

        expect((await reader.ownersOfKeys('usda', keyRefs(key!))).get(key!)?.id).toBe(brisket.id);
    });

    it('an unowned key resolves to the root that cites it exactly, not to one that cites it closely', async () => {
        const [key] = await adapterKeys(174534);
        await makeSeededRoot(foodDb(), { name: 'a close crust', citation: { key: key!, match: 'close' } });
        const crust = await makeSeededRoot(foodDb(), {
            name: 'pizza crust',
            citation: { key: key!, match: 'exact' },
        });

        expect((await reader.ownersOfKeys('usda', keyRefs(key!))).get(key!)?.id).toBe(crust.id);
    });

    // Rewritten for the owner's 2026-10-01 ruling: a citation has two jobs, numbers and identity, and only an exact one
    // does the second. A non-exact entry is shared (six liqueurs cite one FNDDS "Liqueur"), so it names no one root.
    it.each(['sameSubstance', 'close', 'generic'] as const)(
        '⛔ a %s citation lends numbers and names no root: the unowned key it cites resolves to nothing',
        async (match) => {
            const [key] = await adapterKeys(174542);
            await makeSeededRoot(foodDb(), { name: 'amaretto', citation: { key: key!, match } });

            expect((await reader.ownersOfKeys('usda', keyRefs(key!))).has(key!)).toBe(false);
        },
    );

    // Rewritten for the db-arch-1 U8 review: the tie-break was the name, whose order is the database's collation. It is
    // now the unique seed key in byte order. The names order the other way, and `curated:ab` sorts before `curated:a-c`
    // under en_US (which ignores the hyphen) but after it in bytes, so a name or a collated key picks the other root.
    // The seed refuses an entry graded exact for two roots (`candidateExactShared`), but `DISTINCT ON` still needs a
    // total order.
    it('between two exact stand-ins, the seed key decides in byte order, never the name or the collation', async () => {
        const [key] = await adapterKeys(174535);
        const first = await makeSeededRoot(foodDb(), {
            name: 'zeta crust',
            seedKey: 'curated:a-c',
            citation: { key: key!, match: 'exact' },
        });
        await makeSeededRoot(foodDb(), {
            name: 'alpha crust',
            seedKey: 'curated:ab',
            citation: { key: key!, match: 'exact' },
        });

        expect((await reader.ownersOfKeys('usda', keyRefs(key!))).get(key!)?.id).toBe(first.id);
    });

    it('follows a retired root’s forward to a live variant', async () => {
        const [key] = await adapterKeys(174536);
        const old = await makeSeededRoot(foodDb(), { name: 'brisket, old', sourceKey: key, retired: true });
        const brisket = await makeSeededRoot(foodDb(), {
            name: 'beef brisket',
            variants: [{ parts: [{ attribute: 'cut', text: 'flat' }] }],
        });
        await forward(old.id, { variantId: brisket.variants[0]!.id });

        expect((await reader.ownersOfKeys('usda', keyRefs(key!))).get(key!)).toMatchObject({
            kind: 'variant',
            id: brisket.variants[0]!.id,
            rootId: brisket.id,
            rootName: 'beef brisket',
        });
    });

    // A forward's target carries no foreign key (KTD-12): the seed may delete a root an earlier forward names, as a
    // merge does, and the chain continues through that root's own forward.
    it('follows a chain through a root the seed deleted, by the deleted root’s own forward', async () => {
        const [key] = await adapterKeys(174543);
        const old = await makeSeededRoot(foodDb(), { name: 'brisket, old', sourceKey: key, retired: true });
        const absorbed = await makeSeededRoot(foodDb(), { name: 'brisket, whole' });
        const brisket = await makeSeededRoot(foodDb(), { name: 'beef brisket' });
        await forward(old.id, { foodId: absorbed.id });

        await foodDb().asOwner(async (client) => {
            await client.query('BEGIN');
            await client.query('DELETE FROM food WHERE id = $1', [absorbed.id]);
            await client.query(
                "INSERT INTO food_forward (source_id, source_kind, target_food_id) VALUES ($1, 'root', $2)",
                [absorbed.id, brisket.id],
            );
            await client.query('COMMIT');
        });

        expect((await reader.ownersOfKeys('usda', keyRefs(key!))).get(key!)?.id).toBe(brisket.id);
    });

    it('⛔ a forward cycle answers nothing and records the metric — never a 500', async () => {
        const [key] = await adapterKeys(174537);
        const a = await makeSeededRoot(foodDb(), { name: 'cycle a', sourceKey: key, retired: true });
        const b = await makeSeededRoot(foodDb(), { name: 'cycle b', retired: true });
        await forward(a.id, { foodId: b.id });
        await forward(b.id, { foodId: a.id });

        expect(await reader.ownersOfKeys('usda', keyRefs(key!))).toStrictEqual(new Map());
        expect(unresolved.join('\n')).toContain('food-forward-unresolved');
    });

    it(`⛔ a chain longer than ${MAX_FORWARD_HOPS} hops answers nothing and records the metric`, async () => {
        const [key] = await adapterKeys(174538);
        const chain = [await makeSeededRoot(foodDb(), { name: 'hop 0', sourceKey: key, retired: true })];

        for (let hop = 1; hop <= MAX_FORWARD_HOPS + 1; hop += 1) {
            chain.push(await makeSeededRoot(foodDb(), { name: `hop ${hop}`, retired: hop <= MAX_FORWARD_HOPS }));
        }

        for (let hop = 0; hop < chain.length - 1; hop += 1) {
            await forward(chain[hop]!.id, { foodId: chain[hop + 1]!.id });
        }

        expect(await reader.ownersOfKeys('usda', keyRefs(key!))).toStrictEqual(new Map());
        expect(unresolved.join('\n')).toContain('food-forward-unresolved');
    });

    it(`resolves a chain of exactly ${MAX_FORWARD_HOPS} hops`, async () => {
        const [key] = await adapterKeys(174539);
        const chain = [await makeSeededRoot(foodDb(), { name: 'hop 0', sourceKey: key, retired: true })];

        for (let hop = 1; hop <= MAX_FORWARD_HOPS; hop += 1) {
            chain.push(await makeSeededRoot(foodDb(), { name: `hop ${hop}`, retired: hop < MAX_FORWARD_HOPS }));
        }

        for (let hop = 0; hop < chain.length - 1; hop += 1) {
            await forward(chain[hop]!.id, { foodId: chain[hop + 1]!.id });
        }

        expect((await reader.ownersOfKeys('usda', keyRefs(key!))).get(key!)?.id).toBe(chain[MAX_FORWARD_HOPS]!.id);
        expect(unresolved).toStrictEqual([]);
    });

    describe('R19 lineage: USDA re-keyed a Foundation food the seed pinned', () => {
        // Broccoli, raw is Foundation 747447 and SR Legacy 170379, and both carry NDB number 11090. 2709999 stands for
        // the FDC id a later Foundation release gives the same food.
        const REKEYED = { fdcId: 2709999, dataType: 'Foundation', ndbNumber: 11090 };

        /** The hits the real adapter yields for these USDA hits. */
        async function adapterHits(...hits: UsdaHit[]): Promise<SourceKeyRef[]> {
            return usdaAdapterAnsweringHits(hits).searchByName('broccoli');
        }

        it('answers a Foundation hit the seed does not hold as the root holding its NDB number', async () => {
            const broccoli = await makeSeededRoot(foodDb(), {
                name: 'broccoli',
                sourceKey: '747447',
                lineageKey: 'foundation:11090',
            });

            expect((await reader.ownersOfKeys('usda', await adapterHits(REKEYED))).get('2709999')?.id).toBe(
                broccoli.id,
            );
        });

        it('⛔ answers nothing for an SR Legacy hit with the same NDB number: a lineage never crosses datasets', async () => {
            await makeSeededRoot(foodDb(), {
                name: 'broccoli',
                sourceKey: '747447',
                lineageKey: 'foundation:11090',
            });

            expect(
                await reader.ownersOfKeys('usda', await adapterHits({ ...REKEYED, dataType: 'SR Legacy' })),
            ).toStrictEqual(new Map());
        });

        it('answers as the variant whose item holds the lineage, under its root', async () => {
            const broccoli = await makeSeededRoot(foodDb(), {
                name: 'broccoli',
                sourceKey: '170379',
                variants: [
                    {
                        parts: [{ attribute: 'cut', text: 'florets' }],
                        sourceKey: '747447',
                        lineageKey: 'foundation:11090',
                    },
                ],
            });

            expect((await reader.ownersOfKeys('usda', await adapterHits(REKEYED))).get('2709999')).toMatchObject({
                kind: 'variant',
                id: broccoli.variants[0]!.id,
                rootId: broccoli.id,
            });
        });

        it('answers the live root when an earlier version’s retired root holds the same lineage and forwards to it', async () => {
            const old = await makeSeededRoot(foodDb(), {
                name: 'broccoli, old',
                sourceKey: '169967',
                lineageKey: 'foundation:11090',
                retired: true,
            });
            const broccoli = await makeSeededRoot(foodDb(), {
                name: 'broccoli',
                sourceKey: '747447',
                lineageKey: 'foundation:11090',
            });
            await forward(old.id, { foodId: broccoli.id });

            expect((await reader.ownersOfKeys('usda', await adapterHits(REKEYED))).get('2709999')?.id).toBe(
                broccoli.id,
            );
            expect(unresolved.filter((line) => line.includes('food-forward-unresolved'))).toStrictEqual([]);
            expect(unresolved.filter((line) => line.includes('food-lineage-match'))).toHaveLength(1);
        });

        it('⛔ the progressive search hides the re-keyed hit the seed holds, and shows the one it does not', async () => {
            await makeSeededRoot(foodDb(), {
                name: 'broccoli',
                sourceKey: '747447',
                lineageKey: 'foundation:11090',
            });
            const hits = await usdaAdapterAnsweringHits([REKEYED, { fdcId: 999999 }]).searchByName('broccoli');

            const { shown } = triageRemoteHits({
                query: 'broccoli',
                source: 'usda',
                items: asRemoteItems(hits),
                standing: await reader.standingOfKeys('usda', hits),
                // No catalog root carries a hit's name: this suite is about the key's standing alone.
                namedRoots: new Map(),
                catalogRootIds: undefined,
            });

            expect(shown).toStrictEqual([{ externalKey: '999999', name: 'USDA 999999', lineageKey: null }]);
        });
    });

    it('⛔ end to end: the progressive search hides a seeded item held by its root or its variant, naming each gap', async () => {
        const brisket = await makeSeededRoot(foodDb(), {
            name: 'beef brisket',
            sourceKey: '174540',
            variants: [{ parts: [{ attribute: 'cut', text: 'flat' }], sourceKey: '174541' }],
        });
        const hits = await usdaAdapterAnswering(174540, 174541, 999999).searchByName('brisket');

        // No catalog result in this answer shows the root, so each held hit is a gap naming what holds it.
        const { shown, gaps } = triageRemoteHits({
            query: 'brisket',
            source: 'usda',
            items: asRemoteItems(hits),
            standing: await reader.standingOfKeys('usda', hits),
            namedRoots: new Map(),
            catalogRootIds: new Set(),
        });

        expect(shown).toStrictEqual([{ externalKey: '999999', name: 'USDA 999999', lineageKey: null }]);
        expect(
            gaps.map(({ externalKey, foodId, foodVariantId }) => ({ externalKey, foodId, foodVariantId })),
        ).toStrictEqual([
            { externalKey: '174540', foodId: brisket.id, foodVariantId: null },
            { externalKey: '174541', foodId: brisket.id, foodVariantId: brisket.variants[0]!.id },
        ]);
    });
});
