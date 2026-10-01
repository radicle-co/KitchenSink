/**
 * The catalog snapshot DAO's mapping (curated catalog plan U5, KTD-8, KTD-11, KTD-12): stored rows to the
 * `CatalogSnapshot` port, by natural key, in the port's one spelling and order.
 *
 * The mapping is tested through `assembleSnapshot` over row fixtures, and the read's own row mapping through
 * `CatalogSnapshotDao.read()` over an unconnected client whose `query` answers each table's select with positional rows,
 * as node-postgres does under Drizzle's `rowMode: 'array'`. That the SQL selects the right rows on the caller's
 * connection and leaves its transaction open is asserted against a real database in
 * `tests/e2e/catalogSnapshot.e2e.test.ts`.
 */
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { assembleSnapshot, CatalogSnapshotDao, type SnapshotRows } from '../catalogSnapshot.dao.js';
import { isCatalogSnapshotUnreadableError } from '../catalogSnapshot.errors.js';
import { EMPTY_SNAPSHOT } from '../catalogSnapshot.js';

/** No rows at all. */
const NO_ROWS: SnapshotRows = {
    items: [],
    roots: [],
    variants: [],
    parts: [],
    sources: [],
    portions: [],
    categories: [],
    popularity: [],
    headers: [],
    citations: [],
    values: [],
    forwards: [],
    liveNames: [],
    liveSources: [],
};

/** A source-item citation row on a header. */
function sourceCitation(id: string, nutritionId: string, externalKey: string): SnapshotRows['citations'][number] {
    return {
        id,
        nutritionId,
        dataset: 'usdaSrFoundation',
        externalKey,
        match: 'exact',
        densityGPerMl: null,
        kcalFromKj: false,
        url: null,
        retrievedOn: null,
        manufacturer: null,
        servingLabel: null,
        servingGrams: null,
    };
}

/** The live root's row. */
const LIVE_ROOT: SnapshotRows['roots'][number] = {
    id: 'r-100',
    seedKey: 'fdc:100',
    name: 'beef brisket',
    aliases: 'brisket; beef breast',
    retired: false,
    itemKey: 'fdc:100',
};

/** The retired root's row. */
const RETIRED_ROOT: SnapshotRows['roots'][number] = {
    id: 'r-200',
    seedKey: 'curated:old-thing',
    name: 'old thing',
    aliases: null,
    retired: true,
    itemKey: 'curated:old-thing',
};

/** A catalog of one live root with a variant, one retired root, a live food, a live item and a forward. */
const ROWS: SnapshotRows = {
    items: [
        { id: 'i-100', naturalKey: 'fdc:100' },
        { id: 'i-101', naturalKey: 'fdc:101' },
        { id: 'i-200', naturalKey: 'curated:old-thing' },
        { id: 'i-300', naturalKey: 'fdc:300' },
    ],
    roots: [LIVE_ROOT, RETIRED_ROOT],
    variants: [{ id: 'v-101', itemKey: 'fdc:101', rootSeedKey: 'fdc:100', retired: false }],
    parts: [
        { variantId: 'v-101', attribute: 'cut', ordinal: 0, text: 'flat' },
        { variantId: 'v-101', attribute: 'cookingMethod', ordinal: 0, text: 'braised' },
    ],
    sources: [
        { id: 's-17', itemKey: 'fdc:100', source: 'usda', externalKey: '17' },
        { id: 's-100', itemKey: 'fdc:100', source: 'usda', externalKey: '100' },
        { id: 's-101', itemKey: 'fdc:101', source: 'usda', externalKey: '101' },
    ],
    portions: [
        { itemKey: 'fdc:100', label: 'oz', gramWeight: '28.350', sourceId: 's-100', citationId: null },
        { itemKey: 'fdc:100', label: 'cup', gramWeight: '120', sourceId: 's-17', citationId: null },
        { itemKey: 'fdc:100', label: '1 ONZ', gramWeight: '28.0', sourceId: null, citationId: 'c-r100' },
    ],
    categories: [
        { itemKey: 'fdc:100', name: 'Meats', sourceId: null },
        { itemKey: 'fdc:100', name: 'Beef Products', sourceId: 's-100' },
    ],
    popularity: [{ itemKey: 'fdc:100', weight: '40000.10', priorFraction: '0.528103171', source: 'fndds-cycle' }],
    headers: [
        { id: 'n-r100', foodId: 'r-100', variantId: null },
        { id: 'n-v101', foodId: null, variantId: 'v-101' },
    ],
    citations: [
        {
            ...sourceCitation('c-r100', 'n-r100', '2096555'),
            dataset: 'usdaBranded',
        },
        sourceCitation('c-v101', 'n-v101', '101'),
    ],
    values: [
        { nutritionId: 'n-r100', name: 'Protein', unit: 'g', amount: '21.50', basis: 'per_100g' },
        { nutritionId: 'n-r100', name: 'Energy', unit: 'kcal', amount: '155', basis: 'per_100g' },
        { nutritionId: 'n-v101', name: 'Fiber, total dietary', unit: 'g', amount: null, basis: 'per_100g' },
    ],
    forwards: [
        { sourceId: 'r-gone', sourceKind: 'root', sourceKey: 'fdc:99', targetFoodId: 'r-100', targetVariantId: null },
        { sourceId: 'live-1', sourceKind: 'root', sourceKey: null, targetFoodId: null, targetVariantId: 'v-101' },
    ],
    liveNames: [{ id: 'live-2', normalizedName: 'salt' }],
    liveSources: [{ source: 'usda', externalKey: '555' }],
};

describe('assembleSnapshot', () => {
    const snapshot = assembleSnapshot(ROWS);

    it('names a live root by its seed key, with its synonyms in stored order and its nutrition sorted and canonical', () => {
        expect(snapshot.content.roots.get('fdc:100')).toEqual({
            seedKey: 'fdc:100',
            name: 'beef brisket',
            synonyms: ['brisket', 'beef breast'],
            item: 'fdc:100',
            nutrition: {
                citation: {
                    dataset: 'usdaBranded',
                    externalKey: '2096555',
                    match: 'exact',
                    densityGPerMl: null,
                    kcalFromKj: false,
                },
                values: [
                    { name: 'Energy', unit: 'kcal', amount: '155' },
                    { name: 'Protein', unit: 'g', amount: '21.5' },
                ],
            },
        });
    });

    it('names a variant by its item, under its root, with its parts in stored order and a trace as no amount', () => {
        expect(snapshot.content.variants.get('fdc:101')).toEqual({
            item: 'fdc:101',
            root: 'fdc:100',
            parts: [
                { attribute: 'cut', text: 'flat' },
                { attribute: 'cookingMethod', text: 'braised' },
            ],
            nutrition: {
                citation: {
                    dataset: 'usdaSrFoundation',
                    externalKey: '101',
                    match: 'exact',
                    densityGPerMl: null,
                    kcalFromKj: false,
                },
                values: [{ name: 'Fiber, total dietary', unit: 'g', amount: null }],
            },
        });
    });

    it('sorts an item’s sources and source portions by natural key, holds a cited serving as a portion carrying its citation (OQ-1), and spells decimals canonically', () => {
        expect(snapshot.content.items.get('fdc:100')).toEqual({
            key: 'fdc:100',
            sources: [
                { source: 'usda', externalKey: '100' },
                { source: 'usda', externalKey: '17' },
            ],
            portions: [
                {
                    label: '1 ONZ',
                    gramWeight: '28',
                    citation: {
                        dataset: 'usdaBranded',
                        externalKey: '2096555',
                        match: 'exact',
                        densityGPerMl: null,
                        kcalFromKj: false,
                    },
                },
                { label: 'oz', gramWeight: '28.35', source: { source: 'usda', externalKey: '100' } },
                { label: 'cup', gramWeight: '120', source: { source: 'usda', externalKey: '17' } },
            ],
            categories: [
                { name: 'Beef Products', source: { source: 'usda', externalKey: '100' } },
                { name: 'Meats', source: null },
            ],
            popularity: { weight: '40000.1', priorFraction: '0.528103171', source: 'fndds-cycle' },
        });
        expect(snapshot.content.items.get('fdc:101')?.popularity).toBeNull();
    });

    it('puts a retired root and its item in `retired`, and no item of a live owner there', () => {
        expect([...snapshot.retired.roots.keys()]).toEqual(['curated:old-thing']);
        expect(snapshot.retired.roots.get('curated:old-thing')).toMatchObject({ synonyms: [], nutrition: null });
        expect([...snapshot.retired.items.keys()]).toEqual(['curated:old-thing']);
        expect([...snapshot.content.roots.keys()]).toEqual(['fdc:100']);
        expect([...snapshot.content.items.keys()].sort()).toEqual(['fdc:100', 'fdc:101']);
    });

    it('holds the id of every seed row by natural key, retired rows and an ownerless seed item included', () => {
        expect(snapshot.ids.roots).toEqual(
            new Map([
                ['fdc:100', 'r-100'],
                ['curated:old-thing', 'r-200'],
            ]),
        );
        expect(snapshot.ids.variants).toEqual(new Map([['fdc:101', 'v-101']]));
        expect(snapshot.ids.items.get('fdc:300')).toBe('i-300');
        expect(snapshot.ids.items.size).toBe(4);
    });

    it('reads every forward with its target’s kind, a live-path forward keeping no key', () => {
        expect(snapshot.forwards).toEqual([
            { sourceId: 'r-gone', sourceKind: 'root', sourceKey: 'fdc:99', target: { kind: 'root', id: 'r-100' } },
            { sourceId: 'live-1', sourceKind: 'root', sourceKey: null, target: { kind: 'variant', id: 'v-101' } },
        ]);
    });

    it('holds live names by normalized name and live source rows by their one comparison key', () => {
        expect(snapshot.liveNames).toEqual(new Map([['salt', 'live-2']]));
        expect(snapshot.liveSourceKeys).toEqual(new Set(['usda\u0000555']));
    });

    it('reads a label citation with its five fields, and the portion citing it as a portion of the owner’s item', () => {
        const labelled = assembleSnapshot({
            ...ROWS,
            citations: [
                {
                    ...sourceCitation('c-r100', 'n-r100', '0'),
                    dataset: 'label',
                    externalKey: null,
                    match: null,
                    url: 'https://example.com/label',
                    retrievedOn: '2026-09-30',
                    manufacturer: 'Acme',
                    servingLabel: '1/4 tsp',
                    servingGrams: '0.80',
                },
                sourceCitation('c-v101', 'n-v101', '101'),
            ],
            portions: [
                { itemKey: 'fdc:100', label: '1/4 tsp', gramWeight: '0.8', sourceId: null, citationId: 'c-r100' },
            ],
        });

        expect(labelled.content.roots.get('fdc:100')?.nutrition).toMatchObject({
            citation: {
                dataset: 'label',
                url: 'https://example.com/label',
                retrievedOn: '2026-09-30',
                manufacturer: 'Acme',
                servingLabel: '1/4 tsp',
                servingGrams: '0.8',
            },
        });
        expect(labelled.content.roots.get('fdc:100')?.nutrition).not.toHaveProperty('serving');
        expect(labelled.content.items.get('fdc:100')?.portions).toEqual([
            {
                label: '1/4 tsp',
                gramWeight: '0.8',
                citation: {
                    dataset: 'label',
                    url: 'https://example.com/label',
                    retrievedOn: '2026-09-30',
                    manufacturer: 'Acme',
                    servingLabel: '1/4 tsp',
                    servingGrams: '0.8',
                },
            },
        ]);
    });

    it('gives an empty catalog the empty snapshot', () => {
        expect(assembleSnapshot(NO_ROWS)).toEqual(EMPTY_SNAPSHOT);
    });
});

describe('assembleSnapshot refuses a shape the port cannot hold, rather than dropping it', () => {
    it.each<[string, Partial<SnapshotRows>, string]>([
        [
            'a header with two citations',
            { citations: [...ROWS.citations, sourceCitation('c-extra', 'n-r100', '9')] },
            'citationCount',
        ],
        [
            'a seed variant with no header',
            { headers: ROWS.headers.filter((header) => header.variantId === null) },
            'variantWithoutNutrition',
        ],
        [
            'a portion with neither a source row nor a citation',
            { portions: [{ itemKey: 'fdc:100', label: 'pinch', gramWeight: '1', sourceId: null, citationId: null }] },
            'portionWithoutProvenance',
        ],
        [
            'a portion citing another owner’s citation, which that owner’s rewrite would cascade away',
            {
                portions: [
                    { itemKey: 'fdc:100', label: 'slice', gramWeight: '1', sourceId: null, citationId: 'c-v101' },
                ],
            },
            'portionCitationUnknown',
        ],
        [
            'a portion citing no citation the snapshot read',
            {
                portions: [
                    { itemKey: 'fdc:100', label: 'slice', gramWeight: '1', sourceId: null, citationId: 'c-gone' },
                ],
            },
            'portionCitationUnknown',
        ],
        [
            'a category citing a source row its item does not hold',
            { categories: [{ itemKey: 'fdc:100', name: 'Meats', sourceId: 's-elsewhere' }] },
            'categorySourceUnknown',
        ],
        [
            'a per-serving value',
            { values: [{ nutritionId: 'n-r100', name: 'Protein', unit: 'g', amount: '3', basis: 'per_serving' }] },
            'valueNotPer100g',
        ],
        ['a root with no name', { roots: [{ ...LIVE_ROOT, name: null }, RETIRED_ROOT] }, 'rootWithoutName'],
        [
            'an owner whose item has no natural key',
            { roots: [{ ...LIVE_ROOT, itemKey: null }, RETIRED_ROOT] },
            'ownerItemUnkeyed',
        ],
    ])('%s', (_name, override, rule) => {
        let thrown: unknown;

        try {
            assembleSnapshot({ ...ROWS, ...override });
        } catch (error) {
            thrown = error;
        }

        expect(isCatalogSnapshotUnreadableError(thrown)).toBe(true);
        expect(isCatalogSnapshotUnreadableError(thrown) ? thrown.issues.map((issue) => issue.rule) : []).toContain(
            rule,
        );
    });
});

describe('CatalogSnapshotDao.read maps each select’s positional rows', () => {
    /** Each table's rows, in its select's column order, by the table the select reads FROM. */
    const ROWS_BY_TABLE: Readonly<Record<string, readonly (readonly unknown[])[]>> = {
        // id, natural_key
        food_item: [
            ['i-salt', 'curated:salt-blend'],
            ['i-old', 'curated:old-thing'],
            ['i-unkeyed', null],
        ],
        // id, seed_key, name, aliases, retired_at, item natural_key
        food: [
            ['r-salt', 'curated:salt-blend', 'salt blend', 'seasoned salt', null, 'curated:salt-blend'],
            ['r-old', 'curated:old-thing', 'old thing', null, '2026-09-01 00:00:00+00', 'curated:old-thing'],
            ['r-unseeded', null, 'never read', null, null, null],
        ],
        // item natural_key, label, gram_weight, source_id, citation_id
        food_portions: [
            ['curated:salt-blend', '1/4 tsp', '0.800', null, 'c-salt'],
            [null, 'orphan', '1', null, 'c-salt'],
        ],
        // id, food_id, food_variant_id
        food_nutrition: [['n-salt', 'r-salt', null]],
        // id, nutrition_id, dataset, external_key, match, density, kcal_from_kj, url, retrieved_on, manufacturer,
        // serving_label, serving_grams
        food_nutrition_citation: [
            [
                'c-salt',
                'n-salt',
                'label',
                null,
                null,
                null,
                false,
                'https://example.com/salt-blend',
                '2026-09-30',
                'Acme',
                '1/4 tsp',
                '0.80',
            ],
        ],
        // nutrition_id, nutrient name, unit, amount, basis
        food_nutrition_value: [['n-salt', 'Energy', 'kcal', '0.50', 'per_100g']],
    };
    /** The seed-owned-scoped reads of KTD-12's exception, told apart from the seed reads by their predicate. */
    const LIVE_ROWS_BY_TABLE: Readonly<Record<string, readonly (readonly unknown[])[]>> = {
        // id, normalized_name
        food: [['live-salt', 'table salt']],
        // source, external_key
        food_sources: [['usda', '555']],
    };

    /**
     * The rows a select reads, by the table its outermost FROM names. Pure.
     *
     * @param config - What Drizzle passes `query`.
     * @returns The rows.
     */
    function rowsFor(config: unknown): readonly (readonly unknown[])[] {
        const text = typeof config === 'object' && config !== null && 'text' in config ? config.text : undefined;

        if (typeof text !== 'string') {
            throw new Error('Drizzle passed query no text');
        }

        const table = / from "([a-z_]+)"/u.exec(text)?.[1] ?? '';
        const byTable = text.includes('"seed_owned"') ? LIVE_ROWS_BY_TABLE : ROWS_BY_TABLE;

        return byTable[table] ?? [];
    }

    /**
     * Read through an unconnected client whose `query` answers from the tables above.
     *
     * @returns The snapshot.
     * @sideEffect Spies on the client's `query`.
     */
    async function readSnapshot(): Promise<Awaited<ReturnType<CatalogSnapshotDao['read']>>> {
        const client = new pg.Client();

        // The spy takes `query`'s LAST overload, the callback form returning void, so it admits a fake returning the
        // result itself rather than a promise of it; Drizzle awaits the result either way.
        vi.spyOn(client, 'query').mockImplementation((config: unknown) => ({ rows: rowsFor(config) }));

        return new CatalogSnapshotDao(client).read();
    }

    it('reads a root, its label citation and the portion citing it, and drops rows whose key is null', async () => {
        const snapshot = await readSnapshot();
        const citation = {
            dataset: 'label',
            url: 'https://example.com/salt-blend',
            retrievedOn: '2026-09-30',
            manufacturer: 'Acme',
            servingLabel: '1/4 tsp',
            servingGrams: '0.8',
        };

        expect(snapshot.content.roots.get('curated:salt-blend')).toEqual({
            seedKey: 'curated:salt-blend',
            name: 'salt blend',
            synonyms: ['seasoned salt'],
            item: 'curated:salt-blend',
            nutrition: { citation, values: [{ name: 'Energy', unit: 'kcal', amount: '0.5' }] },
        });
        expect(snapshot.content.items.get('curated:salt-blend')?.portions).toEqual([
            { label: '1/4 tsp', gramWeight: '0.8', citation },
        ]);
        expect(snapshot.ids.items).toEqual(
            new Map([
                ['curated:salt-blend', 'i-salt'],
                ['curated:old-thing', 'i-old'],
            ]),
        );
        expect([...snapshot.ids.roots.keys()]).toEqual(['curated:salt-blend', 'curated:old-thing']);
    });

    it('reads a root with a retired_at as retired, and KTD-12’s live names and live source rows', async () => {
        const snapshot = await readSnapshot();

        expect([...snapshot.retired.roots.keys()]).toEqual(['curated:old-thing']);
        expect([...snapshot.content.roots.keys()]).toEqual(['curated:salt-blend']);
        expect(snapshot.liveNames).toEqual(new Map([['table salt', 'live-salt']]));
        expect(snapshot.liveSourceKeys).toEqual(new Set(['usda\u0000555']));
    });
});
