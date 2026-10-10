/**
 * LOCAL e2e: the catalog snapshot DAO on a food database migrated by food's own runner, read as `food_seeder` inside a
 * transaction the test opens (curated catalog plan U5, KTD-8, KTD-11, KTD-12; ADR-0051).
 *
 * Rows are written as the owner, whom the ownership trigger admits, so the catalog exists before the seeder reads it.
 * Every read runs in REPEATABLE READ, READ ONLY: the DAO must read on the caller's connection, write nothing, and leave
 * the caller's transaction open.
 *
 * The two properties the planner rests on (KTD-11): a snapshot of an empty catalog plans the committed seed exactly as
 * the empty snapshot does, and a snapshot of a catalog holding some content plans that same content as nothing to do.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { normalizeName } from '../../src/foods/foodName.js';
import { makeCatalogChanges } from '../../src/foods/seed/catalog/__fixtures__/curatedSeed.fixtures.js';
import {
    makeContent,
    makeContentItem,
    makeContentRoot,
    makeContentVariant,
    makeNutrition,
} from '../../src/foods/seed/catalog/__fixtures__/catalogContent.fixtures.js';
import { buildCatalogPlan, isEmptyPlan } from '../../src/foods/seed/catalog/catalogPlanBuilder.js';
import { CatalogSnapshotDao } from '../../src/foods/seed/catalog/catalogSnapshot.dao.js';
import {
    EMPTY_SNAPSHOT,
    type CatalogContent,
    type CatalogSnapshot,
    type ContentItem,
    type ContentNutrition,
    type LabelCitation,
} from '../../src/foods/seed/catalog/catalogSnapshot.js';
import { composeSeedImage } from '../../src/foods/seed/catalog/seedImage.js';
import { projectSeed } from '../../src/foods/seed/catalog/seedProjection.js';
import { loadSeedSources } from '../../src/foods/seed/catalog/seedSources.js';
import { ALIAS_DELIMITER } from '../../src/foods/foodAliases.js';
import { makeCatalogFood } from '../__fixtures__/catalogFood.js';
import { foodDb } from '../support/roleDb.js';

const DATA_DIR = fileURLToPath(new URL('../../src/foods/seed/data/', import.meta.url));

const NO_CHANGES = makeCatalogChanges({ merges: [], aliases: [], exclusions: [], splits: [] });

/** The salt blend's label, whose serving is a portion of the root's item citing it (OQ-1). */
const SALT_BLEND_LABEL: LabelCitation = {
    dataset: 'label',
    url: 'https://example.com/salt-blend',
    retrievedOn: '2026-09-30',
    manufacturer: 'Acme',
    servingLabel: '1/4 tsp',
    servingGrams: '0.8',
};

/** A seed catalog with every shape the port holds: synonyms, a label with a cited serving, a trace, parts, a bare root. */
const LIVE: CatalogContent = makeContent(
    [
        makeContentRoot({
            synonyms: ['brisket', 'beef breast'],
            nutrition: {
                ...makeNutrition('fdc:100'),
                values: [
                    { name: 'Fiber, total dietary', unit: 'g', amount: null },
                    { name: 'Protein', unit: 'g', amount: '21.5' },
                ],
            },
        }),
        makeContentRoot({
            seedKey: 'curated:salt-blend',
            name: 'salt blend',
            item: 'curated:salt-blend',
            nutrition: {
                citation: SALT_BLEND_LABEL,
                values: [
                    { name: 'Energy', unit: 'kcal', amount: '0.5' },
                    { name: 'Sodium, na', unit: 'mg', amount: '23750' },
                ],
            },
        }),
        makeContentRoot({ seedKey: 'curated:mystery', name: 'mystery', item: 'curated:mystery', nutrition: null }),
    ],
    [
        makeContentVariant({
            parts: [
                { attribute: 'cut', text: 'flat' },
                { attribute: 'cookingMethod', text: 'braised' },
            ],
        }),
    ],
    [
        makeContentItem('curated:salt-blend', {
            portions: [{ label: '1/4 tsp', gramWeight: '0.8', citation: SALT_BLEND_LABEL }],
        }),
        makeContentItem('fdc:100', {
            sources: [
                { source: 'usda', externalKey: '100', lineageKey: 'foundation:13023' },
                { source: 'usda', externalKey: '17', lineageKey: null },
            ],
            portions: [
                { label: 'oz', gramWeight: '28.35', source: { source: 'usda', externalKey: '100' } },
                { label: 'cup', gramWeight: '120', source: { source: 'usda', externalKey: '17' } },
            ],
            categories: [
                { name: 'Beef Products', source: { source: 'usda', externalKey: '100' } },
                { name: 'Meats', source: null },
            ],
        }),
    ],
);

/** A retired seed root, which keeps its item (KTD-8). */
const RETIRED: CatalogContent = makeContent([
    makeContentRoot({ seedKey: 'fdc:900', name: 'old veal', item: 'fdc:900', nutrition: makeNutrition('fdc:900') }),
]);

/**
 * A decimal with a trailing zero added, so a read must canonicalize it. Pure.
 *
 * @param value - A canonical decimal.
 * @returns The same number, spelled longer.
 */
function padded(value: string): string {
    return value.includes('.') ? `${value}0` : `${value}.00`;
}

/** The writer's handle on one write: the ids it has minted so far. */
interface Written {
    readonly client: pg.PoolClient;
    readonly rootIds: Map<string, string>;
}

/**
 * The id of a dictionary entry, inserted if absent.
 *
 * @sideEffect Inserts into and reads `nutrient`.
 */
async function nutrientIdOf(client: pg.PoolClient, name: string, unit: string): Promise<string> {
    await client.query(
        'INSERT INTO nutrient (id, name, unit) VALUES ($1, $2, $3) ON CONFLICT (name, unit) DO NOTHING',
        [`nutrient-${randomUUID()}`, name, unit],
    );
    const { rows } = await client.query<{ id: string }>('SELECT id FROM nutrient WHERE name = $1 AND unit = $2', [
        name,
        unit,
    ]);
    const [row] = rows;

    if (row === undefined) {
        throw new Error(`no nutrient ${name} ${unit}`);
    }

    return row.id;
}

/**
 * Write an item and its per-item rows, each list in reverse order and every decimal padded.
 *
 * @sideEffect Inserts into `food_item`, `food_sources`, `food_portions`, `food_category` and
 *   `food_category_assignment`.
 */
async function writeItem(client: pg.PoolClient, item: ContentItem, ownerKind: 'root' | 'variant'): Promise<string> {
    const id = `item-${randomUUID()}`;
    const sourceIds = new Map<string, string>();

    await client.query('INSERT INTO food_item (id, natural_key, owner_kind) VALUES ($1, $2, $3)', [
        id,
        item.key,
        ownerKind,
    ]);

    for (const source of [...item.sources].reverse()) {
        const sourceId = `source-${randomUUID()}`;

        sourceIds.set(`${source.source}:${source.externalKey}`, sourceId);
        await client.query(
            'INSERT INTO food_sources (id, item_id, source, external_key, lineage_key) VALUES ($1, $2, $3, $4, $5)',
            [sourceId, id, source.source, source.externalKey, source.lineageKey],
        );
    }

    for (const portion of [...item.portions].reverse()) {
        if ('citation' in portion) {
            // A cited portion is written with its owner's citation, which does not exist yet.
            continue;
        }

        await client.query(
            'INSERT INTO food_portions (id, item_id, label, gram_weight, source_id) VALUES ($1, $2, $3, $4, $5)',
            [
                `portion-${randomUUID()}`,
                id,
                portion.label,
                padded(portion.gramWeight),
                sourceIds.get(`${portion.source.source}:${portion.source.externalKey}`),
            ],
        );
    }

    for (const category of [...item.categories].reverse()) {
        const categoryId = `category-${randomUUID()}`;

        await client.query('INSERT INTO food_category (id, name) VALUES ($1, $2)', [categoryId, category.name]);
        await client.query(
            'INSERT INTO food_category_assignment (item_id, category_id, source_id) VALUES ($1, $2, $3)',
            [
                id,
                categoryId,
                category.source === null
                    ? null
                    : sourceIds.get(`${category.source.source}:${category.source.externalKey}`),
            ],
        );
    }

    return id;
}

/**
 * Write an owner's nutrition: its header, its one citation, its values (each citing it) and the item's portions that
 * cite it (OQ-1).
 *
 * @sideEffect Inserts into the three nutrition tables, `nutrient` and maybe `food_portions`.
 */
async function writeNutrition(
    client: pg.PoolClient,
    owner: { readonly foodId: string } | { readonly variantId: string },
    item: { readonly id: string; readonly content: ContentItem },
    nutrition: ContentNutrition,
): Promise<void> {
    const header = `nutrition-${randomUUID()}`;
    const citationId = `citation-${randomUUID()}`;
    const { citation } = nutrition;

    await client.query('INSERT INTO food_nutrition (id, food_id, food_variant_id) VALUES ($1, $2, $3)', [
        header,
        'foodId' in owner ? owner.foodId : null,
        'variantId' in owner ? owner.variantId : null,
    ]);
    await (citation.dataset === 'label'
        ? client.query(
              `INSERT INTO food_nutrition_citation
                   (id, nutrition_id, dataset, url, retrieved_on, manufacturer, serving_label, serving_grams)
               VALUES ($1, $2, 'label', $3, $4, $5, $6, $7)`,
              [
                  citationId,
                  header,
                  citation.url,
                  citation.retrievedOn,
                  citation.manufacturer,
                  citation.servingLabel,
                  padded(citation.servingGrams),
              ],
          )
        : client.query(
              `INSERT INTO food_nutrition_citation
                   (id, nutrition_id, dataset, external_key, match, density_g_per_ml, kcal_from_kj)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                  citationId,
                  header,
                  citation.dataset,
                  citation.externalKey,
                  citation.match,
                  citation.densityGPerMl,
                  citation.kcalFromKj,
              ],
          ));

    for (const value of [...nutrition.values].reverse()) {
        await client.query(
            `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, trace, citation_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [
                header,
                await nutrientIdOf(client, value.name, value.unit),
                value.amount === null ? null : padded(value.amount),
                value.amount === null,
                citationId,
            ],
        );
    }

    for (const portion of item.content.portions) {
        if (!('citation' in portion)) {
            continue;
        }

        await client.query(
            'INSERT INTO food_portions (id, item_id, label, gram_weight, citation_id) VALUES ($1, $2, $3, $4, $5)',
            [`portion-${randomUUID()}`, item.id, portion.label, padded(portion.gramWeight), citationId],
        );
    }
}

/**
 * Write a content's roots, then its variants, as the seed would hold them.
 *
 * @sideEffect Inserts into every catalog table.
 */
async function writeContent(written: Written, content: CatalogContent, retired: boolean): Promise<void> {
    const { client } = written;

    for (const root of [...content.roots.values()].reverse()) {
        const item = content.items.get(root.item);

        if (item === undefined) {
            throw new Error(`content holds no item ${root.item}`);
        }

        const itemId = await writeItem(client, item, 'root');
        const id = `food-${randomUUID()}`;

        await client.query(
            `INSERT INTO food (id, item_id, name, normalized_name, status, seed_key, aliases, retired_at)
             VALUES ($1, $2, $3, $4, 'RESOLVED', $5, $6, $7)`,
            [
                id,
                itemId,
                root.name,
                normalizeName(root.name),
                root.seedKey,
                root.synonyms.length === 0 ? null : root.synonyms.join(ALIAS_DELIMITER),
                retired ? new Date().toISOString() : null,
            ],
        );
        written.rootIds.set(root.seedKey, id);

        if (root.nutrition !== null) {
            await writeNutrition(client, { foodId: id }, { id: itemId, content: item }, root.nutrition);
        }
    }

    for (const variant of content.variants.values()) {
        const item = content.items.get(variant.item);
        const rootId = written.rootIds.get(variant.root);

        if (item === undefined || rootId === undefined) {
            throw new Error(`content holds no item or root for ${variant.item}`);
        }

        const itemId = await writeItem(client, item, 'variant');
        const id = `variant-${randomUUID()}`;
        const ordinals = new Map<string, number>();

        await client.query('INSERT INTO food_variant (id, food_id, item_id, retired_at) VALUES ($1, $2, $3, $4)', [
            id,
            rootId,
            itemId,
            retired ? new Date().toISOString() : null,
        ]);

        const numbered = variant.parts.map((part) => {
            const ordinal = ordinals.get(part.attribute) ?? 0;

            ordinals.set(part.attribute, ordinal + 1);

            return { ...part, ordinal };
        });

        for (const part of numbered.reverse()) {
            await client.query(
                'INSERT INTO food_variant_part (variant_id, attribute, ordinal, text) VALUES ($1, $2, $3, $4)',
                [id, part.attribute, part.ordinal, part.text],
            );
        }

        await writeNutrition(client, { variantId: id }, { id: itemId, content: item }, variant.nutrition);
    }
}

/**
 * A content's three maps as entry lists in key order, so a comparison reports a differing row, not a differing order.
 * Pure.
 *
 * @param content - A content.
 * @returns Its entries.
 */
function entriesOf(content: CatalogContent): Record<string, readonly (readonly [string, unknown])[]> {
    const sorted = (map: ReadonlyMap<string, unknown>): (readonly [string, unknown])[] =>
        [...map].sort(([left], [right]) => (left < right ? -1 : 1));

    return { roots: sorted(content.roots), variants: sorted(content.variants), items: sorted(content.items) };
}

describe('the catalog snapshot DAO, read as food_seeder', () => {
    let seeder: pg.Client;

    /**
     * Read a snapshot in a REPEATABLE READ, READ ONLY transaction the test owns, and prove the DAO left it open.
     *
     * @sideEffect Opens and rolls back a transaction on the seeder's connection.
     */
    async function readAsSeeder(): Promise<CatalogSnapshot> {
        await seeder.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

        try {
            const snapshot = await new CatalogSnapshotDao(seeder).read();
            const { rows } = await seeder.query<{ level: string; readOnly: string }>(
                `SELECT current_setting('transaction_isolation') AS level,
                        current_setting('transaction_read_only') AS "readOnly"`,
            );

            expect(rows).toEqual([{ level: 'repeatable read', readOnly: 'on' }]);

            return snapshot;
        } finally {
            await seeder.query('ROLLBACK');
        }
    }

    beforeAll(async () => {
        seeder = new pg.Client({ connectionString: foodDb().seederUrl });
        await seeder.connect();
    });

    afterAll(async () => {
        await seeder.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    it('reads an empty catalog as the empty snapshot, which plans the committed seed as inserts only', async () => {
        const snapshot = await readAsSeeder();
        const inputs = await loadSeedSources(DATA_DIR);
        const projected = projectSeed(composeSeedImage(inputs));
        const plan = buildCatalogPlan(projected.content, snapshot, inputs.curated.changes);

        expect(snapshot).toEqual(EMPTY_SNAPSHOT);
        expect(plan).toEqual(buildCatalogPlan(projected.content, EMPTY_SNAPSHOT, inputs.curated.changes));
        expect(new Set(plan.changes.map((change) => change.kind))).toEqual(new Set(['rootAdded', 'variantAdded']));
        expect(plan.rows.roots.insert.length).toBe(projected.content.roots.size);
        expect(plan.rows.roots.insert.every((root) => root.id === null)).toBe(true);
        expect([
            plan.rows.roots.update,
            plan.rows.roots.retire,
            plan.rows.roots.delete,
            plan.rows.forwards.insert,
        ]).toEqual([[], [], [], []]);
    }, 120_000);

    describe('a catalog holding seed rows, a retired root, a forward and live foods', () => {
        let snapshot: CatalogSnapshot;
        let written: Written;
        let liveFood: { readonly id: string; readonly itemId: string };

        beforeEach(async () => {
            await foodDb().asOwner(async (client) => {
                written = { client, rootIds: new Map() };
                await writeContent(written, LIVE, false);
                await writeContent(written, RETIRED, true);
                await client.query(
                    "INSERT INTO food_forward (source_id, source_kind, source_key, target_food_id) VALUES ('gone-root', 'root', 'fdc:99', $1)",
                    [written.rootIds.get('fdc:100')],
                );
                liveFood = await makeCatalogFood(client, { name: 'table salt' });
                await makeCatalogFood(client, { name: 'my salt', userId: 'user-author' });
                await client.query(
                    "INSERT INTO food_sources (id, item_id, source, external_key) VALUES ($1, $2, 'usda', '555')",
                    [`source-${randomUUID()}`, liveFood.itemId],
                );
            });
            snapshot = await readAsSeeder();
        });

        it('reads the live and retired seed rows back as the content they were written from', () => {
            expect(entriesOf(snapshot.content)).toEqual(entriesOf(LIVE));
            expect(entriesOf(snapshot.retired)).toEqual(entriesOf(RETIRED));
        });

        it('holds every seed row’s id by natural key, the retired root’s included', () => {
            expect(new Map(snapshot.ids.roots)).toEqual(written.rootIds);
            expect([...snapshot.ids.variants.keys()]).toEqual(['fdc:101']);
            expect([...snapshot.ids.items.keys()].sort()).toEqual(
                ['curated:mystery', 'curated:salt-blend', 'fdc:100', 'fdc:101', 'fdc:900'].sort(),
            );
        });

        it('reads the forward, the live unauthored name and the live source row; never the authored food', () => {
            expect(snapshot.forwards).toEqual([
                {
                    sourceId: 'gone-root',
                    sourceKind: 'root',
                    sourceKey: 'fdc:99',
                    target: { kind: 'root', id: written.rootIds.get('fdc:100') },
                },
            ]);
            expect(snapshot.liveNames).toEqual(new Map([['table salt', liveFood.id]]));
            expect(snapshot.liveSourceHolders).toEqual(
                new Map([['usda\u0000555', { foodId: liveFood.id, authored: false, retired: false }]]),
            );
        });

        it('plans the same content against it as nothing to do', () => {
            expect(isEmptyPlan(buildCatalogPlan(LIVE, snapshot, NO_CHANGES))).toBe(true);
        });
    });
});
