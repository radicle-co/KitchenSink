/**
 * ⛔ The verifier passes exactly the catalog a committed seed implies, and names the table of any difference (curated
 * catalog plan U6, KTD-3, R39).
 *
 * LOCAL target, connected as the seeder. A miniature committed seed (`__fixtures__/miniSeedData.ts`) is prepared once;
 * each case writes the catalog the seeder's own projection of that seed implies, changes one thing, and verifies, all
 * inside one transaction it rolls back. The writer is not the applier (`__fixtures__/projectedCatalogWriter.ts`), so the
 * positive control is itself a parity test: the SQL derivation and the TypeScript projection of one seed must agree.
 *
 * Every case switches the transaction to READ ONLY before verifying, which Postgres allows after writes: `verify` then
 * proves it reads, as the empty-plan path needs (KTD-2).
 *
 * Each corruption changes one compared fact. A case asserts the exact set of tables that fail, so a check that
 * reports too much is caught as surely as one that reports nothing.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { CatalogContent } from '../../src/foods/seed/catalog/catalogSnapshot.js';
import { composeSeedImage } from '../../src/foods/seed/catalog/seedImage.js';
import { projectSeed } from '../../src/foods/seed/catalog/seedProjection.js';
import { loadSeedSources } from '../../src/foods/seed/catalog/seedSources.js';
import { runCatalogSeed, type CatalogSeedResult } from '../../src/foods/seed/catalog/catalogSeedTransaction.js';
import type { CuratedRoot } from '../../src/foods/seed/catalog/curatedSeedFormat.js';
import {
    createCatalogVerifier,
    prepareCatalogVerifier,
    type VerifyCatalog,
} from '../../src/foods/seed/verify/catalogVerifier.js';
import { isCatalogVerificationError } from '../../src/foods/seed/verify/catalogVerifier.errors.js';
import { MINI_CHANGES, MINI_ROOTS, writeMiniSeedData } from './__fixtures__/miniSeedData.js';
import { writeProjectedCatalog, type WrittenCatalog } from './__fixtures__/projectedCatalogWriter.js';
import { foodDb } from '../support/roleDb.js';

const SQL_DIR = join(import.meta.dirname, '../../src/foods/seed/verify/sql');

/** One change to a correct catalog, and the tables whose check must then fail. */
interface Corruption {
    readonly name: string;
    readonly tables: readonly string[];
    readonly apply: (client: pg.ClientBase, ids: WrittenCatalog) => Promise<unknown>;
}

/**
 * A row id the writer minted, or a failure naming the key.
 *
 * @param ids - The ids by natural key.
 * @param key - The natural key.
 * @returns The id.
 */
function idOf(ids: ReadonlyMap<string, string>, key: string): string {
    const id = ids.get(key);

    if (id === undefined) {
        throw new Error(`the written catalog holds no row for ${key}`);
    }

    return id;
}

/**
 * Insert a seed-owned item and a live root on it.
 *
 * @param client - The writing client.
 * @param key - The new root's seed key, also its item's natural key.
 * @param name - Its name.
 */
async function insertRoot(client: pg.ClientBase, key: string, name: string): Promise<void> {
    await client.query("INSERT INTO food_item (id, natural_key, owner_kind) VALUES ($1, $1, 'root')", [key]);
    await client.query(
        "INSERT INTO food (id, name, normalized_name, status, item_id, seed_key) VALUES ($1, $2, $2, 'RESOLVED', $1, $1)",
        [key, name],
    );
}

const CORRUPTIONS: readonly Corruption[] = [
    {
        name: "a root's name",
        tables: ['food'],
        apply: async (client, ids) =>
            client.query("UPDATE food SET name = 'beef brisket, whole' WHERE id = $1", [idOf(ids.roots, 'fdc:100')]),
    },
    {
        name: "a root's normalized name",
        tables: ['food'],
        apply: async (client, ids) =>
            client.query("UPDATE food SET normalized_name = 'brisket' WHERE id = $1", [idOf(ids.roots, 'fdc:100')]),
    },
    {
        name: "the order of a root's synonyms",
        tables: ['food'],
        apply: async (client, ids) =>
            client.query("UPDATE food SET aliases = 'whole brisket; brisket' WHERE id = $1", [
                idOf(ids.roots, 'fdc:100'),
            ]),
    },
    {
        name: 'a synonym on a root that has none',
        tables: ['food'],
        apply: async (client, ids) =>
            client.query("UPDATE food SET aliases = 'wormwood spirit' WHERE id = $1", [
                idOf(ids.roots, 'curated:absinthe'),
            ]),
    },
    {
        name: "a root's status",
        tables: ['food'],
        apply: async (client, ids) =>
            client.query("UPDATE food SET status = 'PENDING' WHERE id = $1", [idOf(ids.roots, 'fdc:2646170')]),
    },
    {
        name: 'a lookup tombstone on a root',
        tables: ['food'],
        apply: async (client, ids) =>
            client.query('UPDATE food SET tombstoned_at = now() WHERE id = $1', [idOf(ids.roots, 'curated:absinthe')]),
    },
    {
        name: "an author's withdrawal on a root",
        tables: ['food'],
        apply: async (client, ids) =>
            client.query('UPDATE food SET withdrawn_at = now() WHERE id = $1', [idOf(ids.roots, 'curated:absinthe')]),
    },
    {
        name: 'a retired root the seed holds',
        tables: ['food', 'food_item'],
        apply: async (client, ids) =>
            client.query('UPDATE food SET retired_at = now() WHERE id = $1', [idOf(ids.roots, 'curated:absinthe')]),
    },
    {
        name: "a root's item",
        tables: ['food', 'food_item'],
        apply: async (client, ids) => {
            await client.query(
                "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ('stray', 'curated:wormwood', 'root')",
            );

            return client.query("UPDATE food SET item_id = 'stray' WHERE id = $1", [
                idOf(ids.roots, 'curated:absinthe'),
            ]);
        },
    },
    {
        name: 'a deleted root and its item',
        tables: ['food', 'food_item'],
        apply: async (client, ids) => {
            await client.query('DELETE FROM food WHERE id = $1', [idOf(ids.roots, 'curated:absinthe')]);

            return client.query('DELETE FROM food_item WHERE id = $1', [idOf(ids.items, 'curated:absinthe')]);
        },
    },
    {
        name: 'an extra live seed root',
        tables: ['food', 'food_item'],
        apply: async (client) => insertRoot(client, 'curated:wormwood', 'wormwood'),
    },
    {
        name: 'an item R51 excludes, present as a root',
        tables: ['food', 'food_item'],
        apply: async (client) => insertRoot(client, 'fdc:103', 'Restaurant, family style, brisket'),
    },
    {
        name: "a source row's external key",
        tables: ['food_sources'],
        apply: async (client) =>
            client.query(
                "UPDATE food_sources SET external_key = '999107' WHERE source = 'usda' AND external_key = '107'",
            ),
    },
    {
        name: "a source row's source",
        tables: ['food_sources'],
        apply: async (client) =>
            client.query("UPDATE food_sources SET source = 'ciqual' WHERE source = 'usda' AND external_key = '107'"),
    },
    {
        name: 'a lineage key on an SR Legacy row',
        tables: ['food_sources'],
        apply: async (client) =>
            client.query("UPDATE food_sources SET lineage_key = 'foundation:100' WHERE external_key = '100'"),
    },
    {
        name: "a Foundation row's lineage key cleared (KTD-27)",
        tables: ['food_sources'],
        apply: async (client) =>
            client.query("UPDATE food_sources SET lineage_key = NULL WHERE external_key = '2646170'"),
    },
    {
        name: 'a source row moved to another item',
        tables: ['food_sources'],
        apply: async (client, ids) =>
            client.query("UPDATE food_sources SET item_id = $1 WHERE source = 'usda' AND external_key = '107'", [
                idOf(ids.items, 'fdc:104'),
            ]),
    },
    {
        name: 'a deleted source row',
        tables: ['food_sources'],
        apply: async (client) =>
            client.query("DELETE FROM food_sources WHERE source = 'usda' AND external_key = '107'"),
    },
    {
        name: 'an extra source row',
        tables: ['food_sources'],
        apply: async (client, ids) =>
            client.query(
                "INSERT INTO food_sources (id, item_id, source, external_key) VALUES ('extra', $1, 'usda', '999')",
                [idOf(ids.items, 'fdc:748278')],
            ),
    },
    // ── The seed's own constants (`catalogWriteSet.ts`): what every seeded root and source row carries ────────
    ...(['description', 'brand_owner', 'brand_name', 'barcode'] as const).map((column): Corruption => ({
        name: `a root's ${column}`,
        tables: ['food'],
        apply: async (client, ids) =>
            client.query(`UPDATE food SET ${column} = 'corrupt' WHERE id = $1`, [idOf(ids.roots, 'fdc:100')]),
    })),
    {
        name: "a root's kind",
        tables: ['food'],
        apply: async (client, ids) =>
            client.query("UPDATE food SET kind = 'branded' WHERE id = $1", [
                idOf(ids.roots, 'curated:adobo-seasoning'),
            ]),
    },
    {
        name: "a source row's fetch state",
        tables: ['food_sources'],
        apply: async (client) =>
            client.query(
                "UPDATE food_sources SET fetch_state = 'error' WHERE source = 'usda' AND external_key = '107'",
            ),
    },
    {
        name: "a source row's version",
        tables: ['food_sources'],
        apply: async (client) =>
            client.query(
                "UPDATE food_sources SET item_version = 'bulk:x' WHERE source = 'usda' AND external_key = '107'",
            ),
    },
    {
        name: 'a field provenance row on a seed item, which the seed never writes',
        tables: ['food_field_provenance'],
        apply: async (client, ids) =>
            client.query(
                `INSERT INTO food_field_provenance (item_id, field, source_id)
                 SELECT item_id, 'name', id FROM food_sources WHERE item_id = $1 AND external_key = '100'`,
                [idOf(ids.items, 'fdc:100')],
            ),
    },
    // ── Session V3: variants, parts and food groups ────────────────────────────────────────────────────────
    {
        name: 'a variant moved to another root',
        tables: ['food_variant'],
        apply: async (client, ids) =>
            client.query('UPDATE food_variant SET food_id = $1 WHERE id = $2', [
                idOf(ids.roots, 'fdc:2646170'),
                idOf(ids.variants, 'fdc:101'),
            ]),
    },
    {
        name: 'a retired variant the seed holds',
        tables: [
            'food_variant',
            'food_item',
            'food_sources',
            'food_variant_part',
            'food_category_assignment',
            'food_nutrition',
            'food_nutrition_citation',
            'food_nutrition_value',
        ],
        apply: async (client, ids) =>
            client.query('UPDATE food_variant SET retired_at = now() WHERE id = $1', [idOf(ids.variants, 'fdc:101')]),
    },
    {
        name: "a variant's item",
        tables: [
            'food_variant',
            'food_item',
            'food_sources',
            'food_variant_part',
            'food_category_assignment',
            'food_nutrition',
            'food_nutrition_citation',
            'food_nutrition_value',
        ],
        apply: async (client, ids) => {
            await client.query(
                "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ('stray', 'fdc:998', 'variant')",
            );

            return client.query("UPDATE food_variant SET item_id = 'stray' WHERE id = $1", [
                idOf(ids.variants, 'fdc:101'),
            ]);
        },
    },
    {
        name: 'an extra live variant',
        tables: ['food_variant', 'food_item'],
        apply: async (client, ids) => {
            await client.query(
                "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ('extra-item', 'fdc:999', 'variant')",
            );

            return client.query("INSERT INTO food_variant (id, food_id, item_id) VALUES ('extra', $1, 'extra-item')", [
                idOf(ids.roots, 'fdc:100'),
            ]);
        },
    },
    {
        name: "a part's text",
        tables: ['food_variant_part'],
        apply: async (client) => client.query("UPDATE food_variant_part SET text = 'flat cut' WHERE text = 'flat'"),
    },
    {
        name: "a part's attribute",
        tables: ['food_variant_part'],
        apply: async (client) =>
            client.query("UPDATE food_variant_part SET attribute = 'grade' WHERE text = 'first cut'"),
    },
    {
        name: 'the order of two parts of one attribute',
        tables: ['food_variant_part'],
        apply: async (client) => {
            await client.query("UPDATE food_variant_part SET ordinal = 9 WHERE text = 'flat'");
            await client.query("UPDATE food_variant_part SET ordinal = 0 WHERE text = 'first cut'");

            return client.query("UPDATE food_variant_part SET ordinal = 1 WHERE text = 'flat'");
        },
    },
    {
        name: 'a deleted part',
        tables: ['food_variant_part'],
        apply: async (client) => client.query("DELETE FROM food_variant_part WHERE text = '1/4-inch trim'"),
    },
    {
        name: 'an extra part',
        tables: ['food_variant_part'],
        apply: async (client, ids) =>
            client.query(
                "INSERT INTO food_variant_part (variant_id, attribute, ordinal, text) VALUES ($1, 'salt', 0, 'salted')",
                [idOf(ids.variants, 'fdc:102')],
            ),
    },
    {
        name: 'a part moved to another variant',
        tables: ['food_variant_part'],
        apply: async (client, ids) =>
            client.query("UPDATE food_variant_part SET variant_id = $1 WHERE text = 'first cut'", [
                idOf(ids.variants, 'fdc:102'),
            ]),
    },
    {
        name: "an item's food group",
        tables: ['food_category_assignment'],
        apply: async (client, ids) =>
            client.query(
                `UPDATE food_category_assignment
                    SET category_id = (SELECT id FROM food_category WHERE name = 'Pork Products')
                  WHERE item_id = $1`,
                [idOf(ids.items, 'fdc:100')],
            ),
    },
    {
        name: 'a food group cited by another source row',
        tables: ['food_category_assignment'],
        apply: async (client, ids) =>
            client.query(
                `UPDATE food_category_assignment
                    SET source_id = (SELECT id FROM food_sources WHERE source = 'usda' AND external_key = '105')
                  WHERE item_id = $1`,
                [idOf(ids.items, 'fdc:100')],
            ),
    },
    {
        name: 'a food group with no source row',
        tables: ['food_category_assignment'],
        apply: async (client, ids) =>
            client.query('UPDATE food_category_assignment SET source_id = NULL WHERE item_id = $1', [
                idOf(ids.items, 'fdc:100'),
            ]),
    },
    {
        name: 'a deleted food group',
        tables: ['food_category_assignment'],
        apply: async (client, ids) =>
            client.query('DELETE FROM food_category_assignment WHERE item_id = $1', [idOf(ids.items, 'fdc:2646170')]),
    },
    {
        name: 'an extra food group',
        tables: ['food_category_assignment'],
        apply: async (client, ids) =>
            client.query(
                `INSERT INTO food_category_assignment (item_id, category_id)
                 SELECT $1, id FROM food_category WHERE name = 'Beef Products'`,
                [idOf(ids.items, 'fdc:2646170')],
            ),
    },
    {
        name: 'a food group moved to another item',
        tables: ['food_category_assignment'],
        apply: async (client, ids) =>
            client.query('UPDATE food_category_assignment SET item_id = $1, source_id = NULL WHERE item_id = $2', [
                idOf(ids.items, 'curated:absinthe'),
                idOf(ids.items, 'fdc:104'),
            ]),
    },
    // ── Session V4: nutrition headers, citations, values, and portions ──────────────────────────────────
    {
        name: 'a header on a root whose seed says nutrition: null',
        tables: ['food_nutrition'],
        apply: async (client, ids) =>
            client.query("INSERT INTO food_nutrition (id, food_id) VALUES ('extra-header', $1)", [
                idOf(ids.roots, 'curated:absinthe'),
            ]),
    },
    {
        name: 'a variant with no header',
        tables: ['food_nutrition', 'food_nutrition_citation', 'food_nutrition_value'],
        apply: async (client, ids) =>
            client.query('DELETE FROM food_nutrition WHERE food_variant_id = $1', [idOf(ids.variants, 'fdc:101')]),
    },
    {
        name: 'a seed header emptied of its values',
        tables: ['food_nutrition', 'food_nutrition_value'],
        apply: async (client, ids) =>
            client.query(
                'DELETE FROM food_nutrition_value WHERE nutrition_id = (SELECT id FROM food_nutrition WHERE food_id = $1)',
                [idOf(ids.roots, 'curated:sea-salt')],
            ),
    },
    {
        name: 'a citation naming a different FDC id',
        tables: ['food_nutrition_citation', 'food_nutrition_value'],
        apply: async (client, ids) =>
            client.query("UPDATE food_nutrition_citation SET external_key = '107' WHERE id = $1", [
                idOf(ids.citations, 'root:curated:sea-salt'),
            ]),
    },
    {
        name: "a citation's dataset",
        tables: ['food_nutrition_citation', 'food_nutrition_value'],
        apply: async (client, ids) =>
            client.query("UPDATE food_nutrition_citation SET dataset = 'usdaFndds' WHERE id = $1", [
                idOf(ids.citations, 'root:curated:sea-salt'),
            ]),
    },
    {
        name: "a citation's match",
        tables: ['food_nutrition_citation'],
        apply: async (client, ids) =>
            client.query("UPDATE food_nutrition_citation SET match = 'close' WHERE id = $1", [
                idOf(ids.citations, 'root:curated:sea-salt'),
            ]),
    },
    {
        name: 'the density a per-100 mL citation records (R54)',
        tables: ['food_nutrition_citation'],
        apply: async (client, ids) =>
            client.query('UPDATE food_nutrition_citation SET density_g_per_ml = 1.04 WHERE id = $1', [
                idOf(ids.citations, 'root:curated:port-wine'),
            ]),
    },
    {
        name: 'the kJ conversion a citation records (R54)',
        tables: ['food_nutrition_citation'],
        apply: async (client, ids) =>
            client.query('UPDATE food_nutrition_citation SET kcal_from_kj = false WHERE id = $1', [
                idOf(ids.citations, 'root:curated:miso'),
            ]),
    },
    {
        name: "a label's URL",
        tables: ['food_nutrition_citation', 'food_nutrition_value', 'food_portions'],
        apply: async (client, ids) =>
            client.query("UPDATE food_nutrition_citation SET url = 'https://example.com/other' WHERE id = $1", [
                idOf(ids.citations, 'root:curated:goya-sazon'),
            ]),
    },
    {
        name: "a label's retrieval date",
        tables: ['food_nutrition_citation'],
        apply: async (client, ids) =>
            client.query("UPDATE food_nutrition_citation SET retrieved_on = '2026-09-30' WHERE id = $1", [
                idOf(ids.citations, 'root:curated:goya-sazon'),
            ]),
    },
    {
        name: "a label's manufacturer",
        tables: ['food_nutrition_citation'],
        apply: async (client, ids) =>
            client.query("UPDATE food_nutrition_citation SET manufacturer = 'Goya' WHERE id = $1", [
                idOf(ids.citations, 'root:curated:goya-sazon'),
            ]),
    },
    {
        name: "a label's serving text",
        tables: ['food_nutrition_citation'],
        apply: async (client, ids) =>
            client.query("UPDATE food_nutrition_citation SET serving_label = '1 packet' WHERE id = $1", [
                idOf(ids.citations, 'root:curated:goya-sazon'),
            ]),
    },
    {
        name: "a label's serving grams",
        tables: ['food_nutrition_citation'],
        apply: async (client, ids) =>
            client.query('UPDATE food_nutrition_citation SET serving_grams = 0.9 WHERE id = $1', [
                idOf(ids.citations, 'root:curated:goya-sazon'),
            ]),
    },
    {
        name: 'a second citation under one header',
        tables: ['food_nutrition_citation'],
        apply: async (client, ids) =>
            client.query(
                `INSERT INTO food_nutrition_citation (id, nutrition_id, dataset, external_key, match)
                 SELECT 'second', nutrition_id, 'ciqual', '2076', 'close' FROM food_nutrition_citation WHERE id = $1`,
                [idOf(ids.citations, 'root:curated:adobo-seasoning')],
            ),
    },
    {
        name: "a variant's value",
        tables: ['food_nutrition_value'],
        apply: async (client, ids) =>
            client.query('UPDATE food_nutrition_value SET amount = amount + 1 WHERE citation_id = $1', [
                idOf(ids.citations, 'variant:fdc:102'),
            ]),
    },
    {
        name: "a stand-in's value that differs from the cited item's row",
        tables: ['food_nutrition_value'],
        apply: async (client, ids) =>
            client.query('UPDATE food_nutrition_value SET amount = 38759 WHERE citation_id = $1 AND amount = 38758', [
                idOf(ids.citations, 'root:curated:sea-salt'),
            ]),
    },
    {
        name: 'a mis-rounded label value',
        tables: ['food_nutrition_value'],
        apply: async (client, ids) =>
            client.query(
                'UPDATE food_nutrition_value SET amount = 23750.001 WHERE citation_id = $1 AND amount = 23750',
                [idOf(ids.citations, 'root:curated:goya-sazon')],
            ),
    },
    {
        name: 'a stored Branded zero (OQ-2)',
        tables: ['food_nutrition_value'],
        apply: async (client, ids) =>
            client.query(
                `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, citation_id)
                 SELECT citation.nutrition_id, nutrient.id, 0, citation.id
                   FROM food_nutrition_citation citation, nutrient
                  WHERE citation.id = $1 AND nutrient.name = 'Protein' AND nutrient.unit = 'g'`,
                [idOf(ids.citations, 'root:curated:adobo-seasoning')],
            ),
    },
    {
        name: 'a trace stored as a zero (R53)',
        tables: ['food_nutrition_value'],
        apply: async (client, ids) =>
            client.query('UPDATE food_nutrition_value SET amount = 0, trace = false WHERE citation_id = $1 AND trace', [
                idOf(ids.citations, 'root:curated:apple-nectar'),
            ]),
    },
    {
        name: "a value's nutrient",
        tables: ['food_nutrition_value'],
        apply: async (client, ids) => {
            await client.query("INSERT INTO nutrient (id, name, unit) VALUES ('crude', 'Protein, crude', 'g')");

            return client.query(
                `UPDATE food_nutrition_value SET nutrient_id = 'crude'
                  WHERE citation_id = $1 AND nutrient_id = (SELECT id FROM nutrient WHERE name = 'Protein' AND unit = 'g')`,
                [idOf(ids.citations, 'root:fdc:100')],
            );
        },
    },
    {
        name: "a value's basis",
        tables: ['food_nutrition_value'],
        apply: async (client, ids) =>
            client.query("UPDATE food_nutrition_value SET basis = 'per_serving' WHERE citation_id = $1", [
                idOf(ids.citations, 'root:curated:miso'),
            ]),
    },
    {
        name: 'a deleted value',
        tables: ['food_nutrition_value'],
        apply: async (client, ids) =>
            client.query(
                `DELETE FROM food_nutrition_value
                  WHERE citation_id = $1 AND nutrient_id = (SELECT id FROM nutrient WHERE name = 'Protein' AND unit = 'g')`,
                [idOf(ids.citations, 'root:fdc:100')],
            ),
    },
    {
        name: 'an extra value',
        tables: ['food_nutrition_value'],
        apply: async (client, ids) =>
            client.query(
                `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, citation_id)
                 SELECT citation.nutrition_id, nutrient.id, 3, citation.id
                   FROM food_nutrition_citation citation, nutrient
                  WHERE citation.id = $1 AND nutrient.name = 'Total lipid (fat)' AND nutrient.unit = 'g'`,
                [idOf(ids.citations, 'root:fdc:2646170')],
            ),
    },
    {
        name: 'a value moved to another header',
        tables: ['food_nutrition_value'],
        apply: async (client, ids) =>
            client.query(
                `UPDATE food_nutrition_value
                    SET nutrition_id = target.nutrition_id, citation_id = target.id
                   FROM food_nutrition_citation target
                  WHERE target.id = $1 AND food_nutrition_value.citation_id = $2
                    AND food_nutrition_value.nutrient_id = (SELECT id FROM nutrient WHERE name = 'Sodium, na' AND unit = 'mg')`,
                [idOf(ids.citations, 'root:fdc:2646170'), idOf(ids.citations, 'root:curated:sea-salt')],
            ),
    },
    {
        name: 'a value citing a second citation of its own header',
        tables: ['food_nutrition_citation', 'food_nutrition_value'],
        apply: async (client, ids) => {
            await client.query(
                `INSERT INTO food_nutrition_citation (id, nutrition_id, dataset, external_key, match)
                 SELECT 'second', nutrition_id, 'cnf', '501', 'close' FROM food_nutrition_citation WHERE id = $1`,
                [idOf(ids.citations, 'root:fdc:2646170')],
            );

            return client.query("UPDATE food_nutrition_value SET citation_id = 'second' WHERE citation_id = $1", [
                idOf(ids.citations, 'root:fdc:2646170'),
            ]);
        },
    },
    {
        name: "a portion's label",
        tables: ['food_portions'],
        apply: async (client) => client.query("UPDATE food_portions SET label = '3 ounces' WHERE label = '3 oz'"),
    },
    {
        name: "a portion's grams",
        tables: ['food_portions'],
        apply: async (client) => client.query("UPDATE food_portions SET gram_weight = 86 WHERE label = '3 oz'"),
    },
    {
        name: 'a duplicated portion row',
        tables: ['food_portions'],
        apply: async (client) =>
            client.query(
                `INSERT INTO food_portions (id, item_id, label, gram_weight, source_id)
                 SELECT 'twin', item_id, label, gram_weight, source_id FROM food_portions WHERE label = '3 oz'`,
            ),
    },
    {
        name: 'a deleted portion',
        tables: ['food_portions'],
        apply: async (client) => client.query("DELETE FROM food_portions WHERE label = '2 slice'"),
    },
    {
        name: 'an extra portion',
        tables: ['food_portions'],
        apply: async (client) =>
            client.query(
                `INSERT INTO food_portions (id, item_id, label, gram_weight, source_id)
                 SELECT 'extra', item_id, '1 steak', 300, source_id FROM food_portions WHERE label = '3 oz'`,
            ),
    },
    {
        name: 'a portion credited to another source row of its item',
        tables: ['food_portions'],
        apply: async (client) =>
            client.query(
                `UPDATE food_portions
                    SET source_id = (SELECT id FROM food_sources WHERE source = 'usda' AND external_key = '105')
                  WHERE label = '3 oz'`,
            ),
    },
    {
        name: "a cited serving citing another owner's citation (OQ-1)",
        tables: ['food_portions'],
        apply: async (client, ids) =>
            client.query('UPDATE food_portions SET citation_id = $1 WHERE citation_id = $2', [
                idOf(ids.citations, 'root:curated:goya-sazon'),
                idOf(ids.citations, 'root:curated:adobo-seasoning'),
            ]),
    },
    {
        name: 'a portion moved to another item',
        tables: ['food_portions'],
        apply: async (client, ids) =>
            client.query('UPDATE food_portions SET item_id = $1 WHERE citation_id = $2', [
                idOf(ids.items, 'curated:absinthe'),
                idOf(ids.citations, 'root:curated:adobo-seasoning'),
            ]),
    },
];

describe('the verifier compares the catalog with a committed seed', () => {
    let dir: string;
    let client: pg.Client;
    let verify: VerifyCatalog;
    let content: CatalogContent;

    /**
     * Write the projected catalog, change it, and return what `verify` threw, in one transaction rolled back after.
     *
     * @param change - The change, after the write and before the verify.
     * @param beforeWrite - A change before the write, for a dictionary entry the seed then finds and keeps.
     * @returns The thrown value, or `undefined` when `verify` passed.
     */
    async function verdictAfter(
        change: (client: pg.ClientBase, ids: WrittenCatalog) => Promise<unknown> = async () => undefined,
        beforeWrite: (client: pg.ClientBase) => Promise<unknown> = async () => undefined,
    ): Promise<unknown> {
        await client.query('BEGIN');

        try {
            await beforeWrite(client);
            await change(client, await writeProjectedCatalog(client, content));
            await client.query('SET TRANSACTION READ ONLY');
            await verify(client);

            return undefined;
        } catch (error) {
            return error;
        } finally {
            await client.query('ROLLBACK');
        }
    }

    /** The tables a verdict names, or the verdict itself when it is not a verification failure. */
    function failingTables(verdict: unknown): unknown {
        return isCatalogVerificationError(verdict)
            ? [...new Set(verdict.failures.map((failure) => failure.table))].sort()
            : verdict;
    }

    beforeAll(async () => {
        dir = mkdtempSync(join(tmpdir(), 'verifier-seed-'));
        await writeMiniSeedData(dir);
        content = projectSeed(composeSeedImage(await loadSeedSources(dir))).content;
        client = new pg.Client({ connectionString: foodDb().seederUrl });
        await client.connect();
        verify = await prepareCatalogVerifier(client, { dataDir: dir, sqlDir: SQL_DIR });
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    afterAll(async () => {
        await client.end();
        rmSync(dir, { recursive: true, force: true });
        // The apply cases commit: leave the tier's shared database empty for the next suite, as the others do.
        await foodDb().truncate();
    });

    it('holds a seed with every shape the checks compare, so a pass is not over an empty catalog', () => {
        expect(content.roots.size).toBe(12);
        expect(content.variants.size).toBe(2);
        expect([...content.items.values()].flatMap((item) => item.sources)).toHaveLength(9);
    });

    it('passes the catalog the seed implies, in a READ ONLY transaction', async () => {
        expect(await verdictAfter()).toBeUndefined();
    });

    it('passes with an authored food and a live food beside the seed', async () => {
        await foodDb().asOwner(async (owner) => {
            await owner.query(
                "INSERT INTO food_item (id, owner_kind) VALUES ('authored-item', 'root'), ('live-item', 'root')",
            );
            await owner.query(
                `INSERT INTO food (id, name, normalized_name, status, item_id, user_id, visibility)
                 VALUES ('authored', 'my brisket rub', 'my brisket rub', 'RESOLVED', 'authored-item', 'user-1', 'private')`,
            );
            await owner.query(
                `INSERT INTO food (id, name, normalized_name, status, item_id)
                 VALUES ('live', 'Beef, brisket, whole, raw', 'beef, brisket, whole, raw', 'RESOLVED', 'live-item')`,
            );
            await owner.query(
                "INSERT INTO food_sources (id, item_id, source, external_key) VALUES ('live-source', 'live-item', 'usda', '170000')",
            );
        });

        expect(await verdictAfter()).toBeUndefined();
    });

    // A compared column no write can make differ: the schema refuses the change, so the check never meets one. Each is
    // still compared (`verifiedColumns.ts` lists it covered), and this proves the claim that it cannot be corrupted.
    it.each<[string, string, string]>([
        [
            'a seed key, fixed at insert',
            "UPDATE food SET seed_key = 'curated:wormwood' WHERE seed_key = 'curated:absinthe'",
            '23000',
        ],
        ['an author on a seed root', "UPDATE food SET user_id = 'user-1' WHERE seed_key = 'curated:absinthe'", '23000'],
        [
            "a seed root's visibility",
            "UPDATE food SET visibility = 'private' WHERE seed_key = 'curated:absinthe'",
            '23514',
        ],
        [
            "a root's item owner kind",
            "UPDATE food SET item_owner_kind = 'variant' WHERE seed_key = 'curated:absinthe'",
            '23514',
        ],
        [
            "a variant's item owner kind",
            "UPDATE food_variant SET item_owner_kind = 'root' WHERE item_id = (SELECT id FROM food_item WHERE natural_key = 'fdc:101')",
            '23514',
        ],
        [
            "a header's owner",
            "UPDATE food_nutrition SET food_id = (SELECT id FROM food WHERE seed_key = 'curated:absinthe') WHERE food_id = (SELECT id FROM food WHERE seed_key = 'curated:miso')",
            '23000',
        ],
        [
            'an uncited value under a seed root',
            "UPDATE food_nutrition_value SET citation_id = NULL WHERE nutrition_id = (SELECT id FROM food_nutrition WHERE food_id = (SELECT id FROM food WHERE seed_key = 'curated:miso'))",
            '23000',
        ],
        [
            'a portion with neither a source row nor a citation',
            "UPDATE food_portions SET source_id = NULL WHERE label = '3 oz'",
            '23000',
        ],
        [
            "an item's natural key",
            "UPDATE food_item SET natural_key = 'curated:wormwood' WHERE natural_key = 'curated:absinthe'",
            '23000',
        ],
        [
            "an owned item's owner kind",
            "UPDATE food_item SET owner_kind = 'variant' WHERE natural_key = 'curated:absinthe'",
            '23503',
        ],
    ])('the schema refuses %s, so no catalog can differ there', async (_name, statement, code) => {
        const verdict = await verdictAfter(async (writer) => writer.query(statement));

        expect(verdict).toMatchObject({ code });
    });

    it("⛔ fails on a dictionary entry the seed names that lacks its definition's INFOODS tag (KTD-23)", async () => {
        const verdict = await verdictAfter(undefined, async (writer) =>
            writer.query("INSERT INTO nutrient (id, name, unit) VALUES ('untagged', 'Protein', 'g')"),
        );

        expect(failingTables(verdict)).toEqual(['nutrient']);
    });

    it("passes a part renumbered within its attribute that keeps its place: the ordinal's meaning is the order", async () => {
        expect(
            await verdictAfter(async (writer) =>
                writer.query("UPDATE food_variant_part SET ordinal = 7 WHERE text = '1/4-inch trim'"),
            ),
        ).toBeUndefined();
    });

    it.each(CORRUPTIONS.map((corruption) => [corruption.name, corruption] as const))(
        '⛔ fails on %s, naming its table',
        async (_name, corruption) => {
            expect(failingTables(await verdictAfter(corruption.apply))).toEqual([...corruption.tables].sort());
        },
    );

    describe('applied by the seed transaction: the forwards and restores it writes pass the history checks', () => {
        /** The directories a case wrote, removed after it. */
        const dirs: string[] = [];

        /**
         * Write a miniature seed directory with the given roots and changes.
         *
         * @param overrides - The roots and changes; the miniature seed's own by default.
         * @returns The directory.
         */
        async function seedDir(
            overrides: { readonly roots?: readonly CuratedRoot[]; readonly changes?: typeof MINI_CHANGES } = {},
        ): Promise<string> {
            const made = mkdtempSync(join(tmpdir(), 'verifier-apply-'));

            dirs.push(made);
            await writeMiniSeedData(made, overrides);

            return made;
        }

        /**
         * Apply a seed directory on a connection of its own, with this verifier as the check.
         *
         * @param dataDir - The directory.
         * @param seedSha - The digest the ledger records.
         * @returns What the apply did.
         */
        async function apply(dataDir: string, seedSha: string): Promise<CatalogSeedResult> {
            const seeder = new pg.Client({ connectionString: foodDb().seederUrl });

            await seeder.connect();

            try {
                return await runCatalogSeed({
                    client: seeder,
                    dataDir,
                    seedSha,
                    verify: createCatalogVerifier({ dataDir, sqlDir: SQL_DIR }),
                    log: () => undefined,
                });
            } finally {
                await seeder.end();
            }
        }

        /** Every forward, as `source_id, source_key -> target`. */
        async function forwards(): Promise<string[]> {
            const result = await client.query<{ row: string }>(
                `SELECT source_id || ' ' || coalesce(source_key, '-') || ' -> ' || coalesce(target_food_id, target_variant_id)
                            AS row
                   FROM food_forward ORDER BY source_id`,
            );

            return result.rows.map((row) => row.row);
        }

        /** The id of the live root with this seed key. */
        async function rootId(seedKey: string): Promise<string | undefined> {
            const result = await client.query<{ id: string }>(
                'SELECT id FROM food WHERE seed_key = $1 AND retired_at IS NULL',
                [seedKey],
            );

            return result.rows[0]?.id;
        }

        afterAll(() => {
            for (const made of dirs) {
                rmSync(made, { recursive: true, force: true });
            }
        });

        it("covers KTD-12's name claim: a live food a seed root names is retired and forwarded, and the next apply writes nothing", async () => {
            const before = await seedDir({ roots: MINI_ROOTS.filter((root) => root.seedKey !== 'curated:absinthe') });
            const after = await seedDir();

            expect((await apply(before, '1'.repeat(64))).outcome).toBe('applied');
            await foodDb().asOwner(async (owner) => {
                await owner.query("INSERT INTO food_item (id, owner_kind) VALUES ('live-item', 'root')");
                await owner.query(
                    `INSERT INTO food (id, name, normalized_name, status, item_id)
                     VALUES ('live-absinthe', 'Absinthe', 'absinthe', 'RESOLVED', 'live-item')`,
                );
            });

            expect((await apply(after, '2'.repeat(64))).outcome).toBe('applied');
            expect(await forwards()).toEqual([`live-absinthe - -> ${String(await rootId('curated:absinthe'))}`]);
            expect((await apply(after, '2'.repeat(64))).outcome).toBe('unchanged');
        });

        it("covers KTD-12's key claim: a live food holding a key the seed now wants is taken over and forwarded", async () => {
            const before = await seedDir({
                roots: MINI_ROOTS.filter((root) => root.seedKey !== 'fdc:2646170'),
                changes: { ...MINI_CHANGES, exclusions: [...MINI_CHANGES.exclusions, 'fdc:2646170'] },
            });
            const after = await seedDir();

            expect((await apply(before, '3'.repeat(64))).outcome).toBe('applied');
            await foodDb().asOwner(async (owner) => {
                await owner.query("INSERT INTO food_item (id, owner_kind) VALUES ('live-item', 'root')");
                await owner.query(
                    `INSERT INTO food (id, name, normalized_name, status, item_id)
                     VALUES ('live-chicken', 'Chicken breast, raw', 'chicken breast, raw', 'RESOLVED', 'live-item')`,
                );
                await owner.query(
                    "INSERT INTO food_sources (id, item_id, source, external_key) VALUES ('live-source', 'live-item', 'usda', '2646170')",
                );
            });

            expect((await apply(after, '4'.repeat(64))).outcome).toBe('applied');
            expect(await forwards()).toEqual([`live-chicken - -> ${String(await rootId('fdc:2646170'))}`]);
            expect((await apply(after, '4'.repeat(64))).outcome).toBe('unchanged');
        });

        it('covers a merge and its undoing: the absorbed root forwards to the survivor, then is restored under its own id', async () => {
            const merged = await seedDir({
                roots: MINI_ROOTS.map((root) =>
                    root.seedKey === 'fdc:100' && root.item !== null
                        ? {
                              ...root,
                              variants: [
                                  ...root.variants,
                                  { item: 'fdc:104', parts: [{ attribute: 'salt', text: 'salted' }] },
                              ],
                          }
                        : root,
                ),
                changes: { ...MINI_CHANGES, merges: [...MINI_CHANGES.merges, { from: 'fdc:104', into: 'fdc:100' }] },
            });
            const original = await seedDir();

            expect((await apply(original, '5'.repeat(64))).outcome).toBe('applied');

            const salt = await rootId('fdc:104');

            expect((await apply(merged, '6'.repeat(64))).outcome).toBe('applied');

            const saltVariant = await client.query<{ id: string }>(
                "SELECT v.id FROM food_variant v JOIN food_item i ON i.id = v.item_id WHERE i.natural_key = 'fdc:104'",
            );
            const variantId = saltVariant.rows[0]?.id;

            expect(await forwards()).toEqual([`${String(salt)} fdc:104 -> ${String(await rootId('fdc:100'))}`]);

            // Undone: the root comes back under its own id and its forward goes; the variant the merge made forwards
            // to the root that took its item back (KTD-8).
            expect((await apply(original, '7'.repeat(64))).outcome).toBe('applied');
            expect(await rootId('fdc:104')).toBe(salt);
            expect(await forwards()).toEqual([`${String(variantId)} fdc:104 -> ${String(salt)}`]);
            expect((await apply(original, '7'.repeat(64))).outcome).toBe('unchanged');
        });
    });
});
