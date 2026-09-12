/**
 * ⛔ The verifier over the real committed seed, as the seed transaction applies it (curated catalog plan U6, session V5;
 * KTD-2, KTD-3, KTD-8, KTD-12, R36, R39, AE5, AE6).
 *
 * LOCAL target. `runCatalogSeed` applies the committed seed as the seeder, with this verifier as its check, so the first
 * case is the two N-version implementations meeting on every row of the real seed. The rest corrupt that catalog:
 *
 * - The matrix: for every column `verifiedColumns.ts` lists covered, one cell of a live seed row is changed, and
 *   `verify` fails naming the table, or the schema refuses the change, so no catalog can differ there. The matrix is
 *   held to `COVERED` exactly, so a column cannot be claimed without a cell, nor a cell kept for a column not claimed.
 * - Per table: one live row deleted, and one extra live seed-owned row added.
 * - AE6: an apply whose writes collapse two variants into one fails inside its transaction, and nothing is recorded.
 * - History (KTD-3's one-way checks): rows a past apply or the live path left, written by the owner, committed, and
 *   removed after each case.
 *
 * Each matrix case runs inside one transaction on a prepared seeder session, switched to READ ONLY before `verify`, and
 * rolled back. Each corrupting statement must change at least one row, so a cell whose row is missing cannot pass by
 * changing nothing.
 */
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { MAX_FORWARD_HOPS } from '../../src/foods/dao/foodForward.dao.js';
import { runCatalogSeed, type CatalogSeedResult } from '../../src/foods/seed/catalog/catalogSeedTransaction.js';
import {
    createCatalogVerifier,
    prepareCatalogVerifier,
    type VerifyCatalog,
} from '../../src/foods/seed/verify/catalogVerifier.js';
import { isCatalogVerificationError } from '../../src/foods/seed/verify/catalogVerifier.errors.js';
import { COVERED, OWED } from '../../src/foods/seed/verify/verifiedColumns.js';
import { foodDb } from '../support/roleDb.js';

const DATA_DIR = join(import.meta.dirname, '../../src/foods/seed/data');
const SQL_DIR = join(import.meta.dirname, '../../src/foods/seed/verify/sql');

/** The digest the first apply records, and the one a later apply of the same bytes under a new seeder carries. */
const FIRST_SHA = 'a'.repeat(64);
const SECOND_SHA = 'b'.repeat(64);

/** A root with synonyms and three variants, and two of its variants. */
const MILK = 'fdc:746772';
const MILK_VARIANT = 'fdc:171268';
const OTHER_MILK_VARIANT = 'fdc:173441';

/** What a corruption must produce: `verify` naming a table, or the schema refusing the change with a code. */
type Outcome = { readonly fails: string } | { readonly refused: string };

/** One corruption of the seeded catalog. */
interface Cell {
    readonly name: string;
    /** The statements, in order; each must change at least one row. */
    readonly sql: readonly string[];
    readonly outcome: Outcome;
}

/** The id of a live seed root, by seed key. */
const root = (key: string): string => `(SELECT id FROM food WHERE seed_key = '${key}')`;

/** The id of a live variant, by its item's key. */
const variant = (key: string): string =>
    `(SELECT v.id FROM food_variant v JOIN food_item i ON i.id = v.item_id WHERE i.natural_key = '${key}')`;

/** The id of an item, by natural key. */
const item = (key: string): string => `(SELECT id FROM food_item WHERE natural_key = '${key}')`;

/** The id of a root's or a variant's citation, by its owner. */
const citationOf = (owner: string, arm: 'food_id' | 'food_variant_id'): string =>
    `(SELECT c.id FROM food_nutrition_citation c JOIN food_nutrition h ON h.id = c.nutrition_id WHERE h.${arm} = ${owner})`;

/** A source row no portion, food group or field provenance cites, so it can move or go alone. */
const LONE_SOURCE = `(SELECT s.id FROM food_sources s
     WHERE NOT EXISTS (SELECT 1 FROM food_portions p WHERE p.source_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM food_category_assignment a WHERE a.source_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM food_field_provenance f WHERE f.source_id = s.id)
     ORDER BY s.source, s.external_key LIMIT 1)`;

/** A portion a citation states (OQ-1), and the root whose citation it is. */
const CITED_PORTION = '(SELECT id FROM food_portions WHERE citation_id IS NOT NULL ORDER BY id LIMIT 1)';

/** A root whose seed says `nutrition: null`, which therefore has no header. */
const BARE_ROOT = `(SELECT f.id FROM food f WHERE f.seed_key LIKE 'curated:%'
     AND NOT EXISTS (SELECT 1 FROM food_nutrition h WHERE h.food_id = f.id) ORDER BY f.seed_key LIMIT 1)`;

/** The header of a root that cites a Branded product: few values, so most nutrients are absent from it. */
const BRANDED_HEADER = `(SELECT c.nutrition_id FROM food_nutrition_citation c WHERE c.dataset = 'usdaBranded'
     ORDER BY c.nutrition_id LIMIT 1)`;

/** One cell per covered column. */
const COLUMN_CELLS: Readonly<Record<string, Cell>> = {
    'food.name': {
        name: "a root's name",
        sql: [`UPDATE food SET name = name || ' (corrupt)' WHERE id = ${root(MILK)}`],
        outcome: { fails: 'food' },
    },
    'food.normalized_name': {
        name: "a root's name key",
        sql: [`UPDATE food SET normalized_name = normalized_name || ' corrupt' WHERE id = ${root(MILK)}`],
        outcome: { fails: 'food' },
    },
    'food.aliases': {
        name: "a root's synonyms",
        sql: [`UPDATE food SET aliases = aliases || '; corrupt' WHERE id = ${root(MILK)}`],
        outcome: { fails: 'food' },
    },
    'food.status': {
        name: "a root's status",
        sql: [`UPDATE food SET status = 'PENDING' WHERE id = ${root(MILK)}`],
        outcome: { fails: 'food' },
    },
    'food.item_id': {
        name: "a root's item",
        sql: [
            "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ('matrix-item', 'curated:matrix-item', 'root')",
            `UPDATE food SET item_id = 'matrix-item' WHERE id = ${BARE_ROOT}`,
        ],
        outcome: { fails: 'food' },
    },
    'food.item_owner_kind': {
        name: "a root's item owner kind",
        sql: [`UPDATE food SET item_owner_kind = 'variant' WHERE id = ${root(MILK)}`],
        outcome: { refused: '23514' },
    },
    'food.seed_key': {
        name: "a root's seed key",
        sql: [`UPDATE food SET seed_key = 'curated:corrupt' WHERE id = ${root(MILK)}`],
        outcome: { refused: '23000' },
    },
    'food.retired_at': {
        name: 'a retired root the seed holds',
        sql: [`UPDATE food SET retired_at = now() WHERE id = ${BARE_ROOT}`],
        outcome: { fails: 'food' },
    },
    'food.user_id': {
        name: 'an author on a seed root',
        sql: [`UPDATE food SET user_id = 'user-1' WHERE id = ${root(MILK)}`],
        outcome: { refused: '23000' },
    },
    'food.visibility': {
        name: "a seed root's visibility",
        sql: [`UPDATE food SET visibility = 'private' WHERE id = ${root(MILK)}`],
        outcome: { refused: '23514' },
    },
    'food.tombstoned_at': {
        name: 'a lookup tombstone on a root',
        sql: [`UPDATE food SET tombstoned_at = now() WHERE id = ${root(MILK)}`],
        outcome: { fails: 'food' },
    },
    'food.withdrawn_at': {
        name: 'a withdrawal on a root',
        sql: [`UPDATE food SET withdrawn_at = now() WHERE id = ${root(MILK)}`],
        outcome: { fails: 'food' },
    },
    'food.description': {
        name: "a root's description",
        sql: [`UPDATE food SET description = 'corrupt' WHERE id = ${root(MILK)}`],
        outcome: { fails: 'food' },
    },
    'food.kind': {
        name: "a root's kind",
        sql: [`UPDATE food SET kind = 'branded' WHERE id = ${root(MILK)}`],
        outcome: { fails: 'food' },
    },
    'food.brand_owner': {
        name: "a root's brand owner",
        sql: [`UPDATE food SET brand_owner = 'corrupt' WHERE id = ${root(MILK)}`],
        outcome: { fails: 'food' },
    },
    'food.brand_name': {
        name: "a root's brand name",
        sql: [`UPDATE food SET brand_name = 'corrupt' WHERE id = ${root(MILK)}`],
        outcome: { fails: 'food' },
    },
    'food.barcode': {
        name: "a root's barcode",
        sql: [`UPDATE food SET barcode = '012345678905' WHERE id = ${root(MILK)}`],
        outcome: { fails: 'food' },
    },
    'food_sources.fetch_state': {
        name: "a source row's fetch state",
        sql: [`UPDATE food_sources SET fetch_state = 'error' WHERE id = ${LONE_SOURCE}`],
        outcome: { fails: 'food_sources' },
    },
    'food_sources.item_version': {
        name: "a source row's version",
        sql: [`UPDATE food_sources SET item_version = 'bulk:corrupt' WHERE id = ${LONE_SOURCE}`],
        outcome: { fails: 'food_sources' },
    },
    'food_field_provenance.item_id': {
        name: 'a field provenance row on a seed item',
        sql: [
            `INSERT INTO food_field_provenance (item_id, field, source_id)
             SELECT item_id, 'name', id FROM food_sources WHERE item_id = ${item(MILK)} ORDER BY id LIMIT 1`,
        ],
        outcome: { fails: 'food_field_provenance' },
    },
    'food_field_provenance.field': {
        name: "a field provenance row for a root's description",
        sql: [
            `INSERT INTO food_field_provenance (item_id, field, source_id)
             SELECT item_id, 'description', id FROM food_sources WHERE item_id = ${item(MILK)} ORDER BY id LIMIT 1`,
        ],
        outcome: { fails: 'food_field_provenance' },
    },
    'food_field_provenance.source_id': {
        name: "a field provenance row citing a variant's own source row",
        sql: [
            `INSERT INTO food_field_provenance (item_id, field, source_id)
             SELECT item_id, 'kind', id FROM food_sources WHERE item_id = ${item(MILK_VARIANT)} ORDER BY id LIMIT 1`,
        ],
        outcome: { fails: 'food_field_provenance' },
    },
    'food_item.natural_key': {
        name: "an item's natural key",
        sql: [`UPDATE food_item SET natural_key = 'fdc:999999998' WHERE id = ${item(MILK)}`],
        outcome: { refused: '23000' },
    },
    'food_item.owner_kind': {
        name: "an owned item's owner kind",
        sql: [`UPDATE food_item SET owner_kind = 'variant' WHERE id = ${item(MILK)}`],
        outcome: { refused: '23503' },
    },
    'food_variant.food_id': {
        name: 'a variant moved to another root',
        sql: [`UPDATE food_variant SET food_id = ${root('fdc:746778')} WHERE id = ${variant(MILK_VARIANT)}`],
        outcome: { fails: 'food_variant' },
    },
    'food_variant.item_id': {
        name: "a variant's item",
        sql: [
            "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ('matrix-item', 'fdc:999999999', 'variant')",
            `UPDATE food_variant SET item_id = 'matrix-item' WHERE id = ${variant(MILK_VARIANT)}`,
        ],
        outcome: { fails: 'food_variant' },
    },
    'food_variant.item_owner_kind': {
        name: "a variant's item owner kind",
        sql: [`UPDATE food_variant SET item_owner_kind = 'root' WHERE id = ${variant(MILK_VARIANT)}`],
        outcome: { refused: '23514' },
    },
    'food_variant.retired_at': {
        name: 'a retired variant the seed holds',
        sql: [`UPDATE food_variant SET retired_at = now() WHERE id = ${variant(MILK_VARIANT)}`],
        outcome: { fails: 'food_variant' },
    },
    'food_variant_part.variant_id': {
        name: 'a part moved to another variant',
        sql: [
            `UPDATE food_variant_part SET variant_id = ${variant(OTHER_MILK_VARIANT)}
              WHERE variant_id = ${variant(MILK_VARIANT)} AND attribute = 'addedNutrients'
                AND ordinal = (SELECT max(ordinal) FROM food_variant_part WHERE variant_id = ${variant(MILK_VARIANT)})`,
        ],
        outcome: { fails: 'food_variant_part' },
    },
    'food_variant_part.attribute': {
        name: "a part's attribute",
        sql: [
            `UPDATE food_variant_part SET attribute = 'origin'
              WHERE variant_id = ${variant(MILK_VARIANT)}
                AND ordinal = (SELECT min(ordinal) FROM food_variant_part WHERE variant_id = ${variant(MILK_VARIANT)})`,
        ],
        outcome: { fails: 'food_variant_part' },
    },
    'food_variant_part.ordinal': {
        name: "a part's place among its attribute's parts",
        sql: [
            `UPDATE food_variant_part SET ordinal = 99
              WHERE variant_id = ${variant(MILK_VARIANT)}
                AND ordinal = (SELECT min(ordinal) FROM food_variant_part WHERE variant_id = ${variant(MILK_VARIANT)})`,
        ],
        outcome: { fails: 'food_variant_part' },
    },
    'food_variant_part.text': {
        name: "a part's text",
        sql: [`UPDATE food_variant_part SET text = text || ' corrupt' WHERE variant_id = ${variant(MILK_VARIANT)}`],
        outcome: { fails: 'food_variant_part' },
    },
    'food_sources.item_id': {
        name: 'a source row moved to another item',
        sql: [`UPDATE food_sources SET item_id = ${item(MILK)} WHERE id = ${LONE_SOURCE}`],
        outcome: { fails: 'food_sources' },
    },
    'food_sources.source': {
        name: "a source row's source",
        sql: [`UPDATE food_sources SET source = 'ciqual' WHERE id = ${LONE_SOURCE}`],
        outcome: { fails: 'food_sources' },
    },
    'food_sources.external_key': {
        name: "a source row's key",
        sql: [`UPDATE food_sources SET external_key = external_key || '0' WHERE id = ${LONE_SOURCE}`],
        outcome: { fails: 'food_sources' },
    },
    'food_sources.lineage_key': {
        name: 'a lineage key on an SR Legacy row',
        sql: [
            `UPDATE food_sources SET lineage_key = 'foundation:1'
              WHERE id = (SELECT id FROM food_sources WHERE lineage_key IS NULL ORDER BY external_key LIMIT 1)`,
        ],
        outcome: { fails: 'food_sources' },
    },
    'food_category_assignment.item_id': {
        name: 'a food group moved to another item, away from the source row that states it',
        sql: [
            `UPDATE food_category_assignment SET item_id = ${item(MILK)}
              WHERE (item_id, category_id) = (
                  SELECT item_id, category_id FROM food_category_assignment
                   WHERE item_id <> ${item(MILK)}
                     AND category_id NOT IN (SELECT category_id FROM food_category_assignment WHERE item_id = ${item(MILK)})
                   ORDER BY item_id, category_id LIMIT 1)`,
        ],
        outcome: { refused: '23503' },
    },
    'food_category_assignment.category_id': {
        name: "an item's food group",
        sql: [
            `UPDATE food_category_assignment
                SET category_id = (SELECT id FROM food_category
                                    WHERE id NOT IN (SELECT category_id FROM food_category_assignment WHERE item_id = ${item(MILK)})
                                    ORDER BY name LIMIT 1)
              WHERE item_id = ${item(MILK)}`,
        ],
        outcome: { fails: 'food_category_assignment' },
    },
    'food_category_assignment.source_id': {
        name: 'a food group with no source row',
        sql: [`UPDATE food_category_assignment SET source_id = NULL WHERE item_id = ${item(MILK)}`],
        outcome: { fails: 'food_category_assignment' },
    },
    'food_portions.item_id': {
        name: 'a cited serving moved to another item',
        sql: [`UPDATE food_portions SET item_id = ${item(MILK)} WHERE id = ${CITED_PORTION}`],
        outcome: { fails: 'food_portions' },
    },
    'food_portions.label': {
        name: "a portion's label",
        sql: [`UPDATE food_portions SET label = label || ' corrupt' WHERE id = (SELECT min(id) FROM food_portions)`],
        outcome: { fails: 'food_portions' },
    },
    'food_portions.gram_weight': {
        name: "a portion's grams",
        sql: [`UPDATE food_portions SET gram_weight = gram_weight + 1 WHERE id = (SELECT min(id) FROM food_portions)`],
        outcome: { fails: 'food_portions' },
    },
    'food_portions.source_id': {
        name: 'a portion credited to another source row of its item',
        sql: [
            `UPDATE food_portions portion
                SET source_id = (SELECT other.id FROM food_sources other
                                  WHERE other.item_id = portion.item_id AND other.id <> portion.source_id
                                  ORDER BY other.id LIMIT 1)
              WHERE portion.id = (SELECT p.id FROM food_portions p
                                   WHERE p.source_id IS NOT NULL
                                     AND (SELECT count(*) FROM food_sources s WHERE s.item_id = p.item_id) > 1
                                   ORDER BY p.id LIMIT 1)`,
        ],
        outcome: { fails: 'food_portions' },
    },
    'food_portions.citation_id': {
        name: "a cited serving citing another root's citation",
        sql: [
            `UPDATE food_portions SET citation_id = ${citationOf(root(MILK), 'food_id')} WHERE id = ${CITED_PORTION}`,
        ],
        outcome: { fails: 'food_portions' },
    },
    'food_nutrition.food_id': {
        name: "a root header's owner",
        sql: [`UPDATE food_nutrition SET food_id = ${BARE_ROOT} WHERE food_id = ${root(MILK)}`],
        outcome: { refused: '23000' },
    },
    'food_nutrition.food_variant_id': {
        name: "a variant header's owner",
        sql: [
            `UPDATE food_nutrition SET food_variant_id = ${variant(OTHER_MILK_VARIANT)}
              WHERE food_variant_id = ${variant(MILK_VARIANT)}`,
        ],
        outcome: { refused: '23000' },
    },
    'food_nutrition_citation.nutrition_id': {
        name: 'a citation moved to another header, away from the values that cite it',
        sql: [
            `UPDATE food_nutrition_citation
                SET nutrition_id = (SELECT id FROM food_nutrition WHERE food_variant_id = ${variant(MILK_VARIANT)})
              WHERE id = ${citationOf(root(MILK), 'food_id')}`,
        ],
        outcome: { refused: '23503' },
    },
    'food_nutrition_citation.dataset': {
        name: "a citation's dataset",
        sql: [
            `UPDATE food_nutrition_citation SET dataset = 'usdaFndds' WHERE id = ${citationOf(root(MILK), 'food_id')}`,
        ],
        outcome: { fails: 'food_nutrition_citation' },
    },
    'food_nutrition_citation.external_key': {
        name: 'a citation naming a different FDC id',
        sql: [
            `UPDATE food_nutrition_citation SET external_key = external_key || '0'
              WHERE id = ${citationOf(root(MILK), 'food_id')}`,
        ],
        outcome: { fails: 'food_nutrition_citation' },
    },
    'food_nutrition_citation.match': {
        name: "a citation's match",
        sql: [`UPDATE food_nutrition_citation SET match = 'close' WHERE id = ${citationOf(root(MILK), 'food_id')}`],
        outcome: { fails: 'food_nutrition_citation' },
    },
    'food_nutrition_citation.density_g_per_ml': {
        name: 'a density on a citation that converted nothing (R54)',
        sql: [
            `UPDATE food_nutrition_citation SET density_g_per_ml = 1.5 WHERE id = ${citationOf(root(MILK), 'food_id')}`,
        ],
        outcome: { fails: 'food_nutrition_citation' },
    },
    'food_nutrition_citation.kcal_from_kj': {
        name: 'a kJ conversion on a citation that made none (R54)',
        sql: [
            `UPDATE food_nutrition_citation SET kcal_from_kj = NOT kcal_from_kj
              WHERE id = ${citationOf(root(MILK), 'food_id')}`,
        ],
        outcome: { fails: 'food_nutrition_citation' },
    },
    'food_nutrition_citation.url': {
        name: 'a label URL on a source-item citation',
        sql: [
            `UPDATE food_nutrition_citation SET url = 'https://example.com' WHERE id = ${citationOf(root(MILK), 'food_id')}`,
        ],
        outcome: { refused: '23514' },
    },
    'food_nutrition_citation.retrieved_on': {
        name: 'a label date on a source-item citation',
        sql: [
            `UPDATE food_nutrition_citation SET retrieved_on = '2026-10-01'
              WHERE id = ${citationOf(root(MILK), 'food_id')}`,
        ],
        outcome: { refused: '23514' },
    },
    'food_nutrition_citation.manufacturer': {
        name: 'a manufacturer on a source-item citation',
        sql: [`UPDATE food_nutrition_citation SET manufacturer = 'x' WHERE id = ${citationOf(root(MILK), 'food_id')}`],
        outcome: { refused: '23514' },
    },
    'food_nutrition_citation.serving_label': {
        name: 'a label serving on a source-item citation',
        sql: [`UPDATE food_nutrition_citation SET serving_label = 'x' WHERE id = ${citationOf(root(MILK), 'food_id')}`],
        outcome: { refused: '23514' },
    },
    'food_nutrition_citation.serving_grams': {
        name: 'label serving grams on a source-item citation',
        sql: [`UPDATE food_nutrition_citation SET serving_grams = 1 WHERE id = ${citationOf(root(MILK), 'food_id')}`],
        outcome: { refused: '23514' },
    },
    'food_nutrition_value.nutrition_id': {
        name: 'a value moved to another header, away from its citation',
        sql: [
            `UPDATE food_nutrition_value
                SET nutrition_id = ${BRANDED_HEADER}
              WHERE citation_id = ${citationOf(root(MILK), 'food_id')}
                AND nutrient_id = (SELECT min(nutrient_id) FROM food_nutrition_value
                                    WHERE citation_id = ${citationOf(root(MILK), 'food_id')}
                                      AND nutrient_id NOT IN (SELECT nutrient_id FROM food_nutrition_value
                                                               WHERE nutrition_id = ${BRANDED_HEADER}))`,
        ],
        outcome: { refused: '23503' },
    },
    'food_nutrition_value.nutrient_id': {
        name: "a value's nutrient",
        sql: [
            `UPDATE food_nutrition_value
                SET nutrient_id = (SELECT n.id FROM nutrient n
                                    WHERE n.id NOT IN (SELECT nutrient_id FROM food_nutrition_value
                                                        WHERE citation_id = ${citationOf(root(MILK), 'food_id')})
                                    ORDER BY n.id LIMIT 1)
              WHERE citation_id = ${citationOf(root(MILK), 'food_id')}
                AND nutrient_id = (SELECT min(nutrient_id) FROM food_nutrition_value WHERE citation_id = ${citationOf(root(MILK), 'food_id')})`,
        ],
        outcome: { fails: 'food_nutrition_value' },
    },
    'food_nutrition_value.amount': {
        name: "a value's amount",
        sql: [
            `UPDATE food_nutrition_value SET amount = amount + 1
              WHERE citation_id = ${citationOf(variant(MILK_VARIANT), 'food_variant_id')} AND amount IS NOT NULL
                AND nutrient_id = (SELECT min(nutrient_id) FROM food_nutrition_value
                                    WHERE citation_id = ${citationOf(variant(MILK_VARIANT), 'food_variant_id')} AND amount IS NOT NULL)`,
        ],
        outcome: { fails: 'food_nutrition_value' },
    },
    'food_nutrition_value.trace': {
        name: 'a trace beside an amount',
        sql: [
            `UPDATE food_nutrition_value SET trace = true
              WHERE citation_id = ${citationOf(root(MILK), 'food_id')} AND amount IS NOT NULL`,
        ],
        outcome: { refused: '23514' },
    },
    'food_nutrition_value.basis': {
        name: "a value's basis",
        sql: [
            `UPDATE food_nutrition_value SET basis = 'per_serving'
              WHERE citation_id = ${citationOf(root(MILK), 'food_id')}
                AND nutrient_id = (SELECT min(nutrient_id) FROM food_nutrition_value WHERE citation_id = ${citationOf(root(MILK), 'food_id')})`,
        ],
        outcome: { fails: 'food_nutrition_value' },
    },
    'food_nutrition_value.citation_id': {
        name: 'an uncited value under a seed root',
        sql: [
            `UPDATE food_nutrition_value SET citation_id = NULL WHERE citation_id = ${citationOf(root(MILK), 'food_id')}`,
        ],
        outcome: { refused: '23000' },
    },
};

/** Per table: one live row deleted, and one extra live seed-owned row. */
const ROW_CELLS: readonly Cell[] = [
    {
        name: 'food: a deleted root',
        sql: [`DELETE FROM food WHERE id = ${BARE_ROOT}`],
        outcome: { fails: 'food' },
    },
    {
        name: 'food: an extra live seed root',
        sql: [
            "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ('matrix-item', 'curated:matrix-extra', 'root')",
            `INSERT INTO food (id, name, normalized_name, status, item_id, seed_key)
             VALUES ('matrix-root', 'matrix extra', 'matrix extra', 'RESOLVED', 'matrix-item', 'curated:matrix-extra')`,
        ],
        outcome: { fails: 'food' },
    },
    {
        name: 'food_item: a deleted owned item',
        sql: [`DELETE FROM food_item WHERE id = ${item(MILK)}`],
        outcome: { refused: '23503' },
    },
    {
        name: 'food_item: an extra item with a natural key and no owner',
        sql: [
            "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ('matrix-item', 'curated:matrix-orphan', 'root')",
        ],
        outcome: { fails: 'food_item' },
    },
    {
        name: 'food_variant: a deleted variant',
        sql: [`DELETE FROM food_variant WHERE id = ${variant(MILK_VARIANT)}`],
        outcome: { fails: 'food_variant' },
    },
    {
        name: 'food_variant: an extra live variant',
        sql: [
            "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ('matrix-item', 'fdc:999999997', 'variant')",
            `INSERT INTO food_variant (id, food_id, item_id) VALUES ('matrix-variant', ${root(MILK)}, 'matrix-item')`,
        ],
        outcome: { fails: 'food_variant' },
    },
    {
        name: 'food_variant_part: a deleted part',
        sql: [
            `DELETE FROM food_variant_part
              WHERE variant_id = ${variant(MILK_VARIANT)}
                AND ordinal = (SELECT min(ordinal) FROM food_variant_part WHERE variant_id = ${variant(MILK_VARIANT)})`,
        ],
        outcome: { fails: 'food_variant_part' },
    },
    {
        name: 'food_variant_part: an extra part',
        sql: [
            `INSERT INTO food_variant_part (variant_id, attribute, ordinal, text)
             VALUES (${variant(MILK_VARIANT)}, 'origin', 0, 'corrupt')`,
        ],
        outcome: { fails: 'food_variant_part' },
    },
    {
        name: 'food_sources: a deleted source row',
        sql: [`DELETE FROM food_sources WHERE id = ${LONE_SOURCE}`],
        outcome: { fails: 'food_sources' },
    },
    {
        name: 'food_sources: an extra source row',
        sql: [
            `INSERT INTO food_sources (id, item_id, source, external_key) VALUES ('matrix-source', ${item(MILK)}, 'usda', '999999996')`,
        ],
        outcome: { fails: 'food_sources' },
    },
    {
        name: 'food_category_assignment: a deleted food group',
        sql: [`DELETE FROM food_category_assignment WHERE item_id = ${item(MILK)}`],
        outcome: { fails: 'food_category_assignment' },
    },
    {
        name: 'food_category_assignment: an extra food group',
        sql: [
            `INSERT INTO food_category_assignment (item_id, category_id)
             SELECT ${item(MILK)}, id FROM food_category
              WHERE id NOT IN (SELECT category_id FROM food_category_assignment WHERE item_id = ${item(MILK)})
              ORDER BY name LIMIT 1`,
        ],
        outcome: { fails: 'food_category_assignment' },
    },
    {
        name: 'food_portions: a deleted portion',
        sql: ['DELETE FROM food_portions WHERE id = (SELECT min(id) FROM food_portions)'],
        outcome: { fails: 'food_portions' },
    },
    {
        name: 'food_portions: a duplicated portion row',
        sql: [
            `INSERT INTO food_portions (id, item_id, label, gram_weight, source_id, citation_id)
             SELECT 'matrix-portion', item_id, label, gram_weight, source_id, citation_id
               FROM food_portions WHERE id = (SELECT min(id) FROM food_portions)`,
        ],
        outcome: { fails: 'food_portions' },
    },
    {
        name: 'food_nutrition: a deleted variant header',
        sql: [`DELETE FROM food_nutrition WHERE food_variant_id = ${variant(MILK_VARIANT)}`],
        outcome: { fails: 'food_nutrition' },
    },
    {
        name: 'food_nutrition: a header on a root whose seed gives it no numbers',
        sql: [`INSERT INTO food_nutrition (id, food_id) VALUES ('matrix-header', ${BARE_ROOT})`],
        outcome: { fails: 'food_nutrition' },
    },
    {
        name: 'food_nutrition_citation: a deleted cited citation',
        sql: [`DELETE FROM food_nutrition_citation WHERE id = ${citationOf(root(MILK), 'food_id')}`],
        outcome: { refused: '23503' },
    },
    {
        name: 'food_nutrition_citation: a second citation under one header',
        sql: [
            `INSERT INTO food_nutrition_citation (id, nutrition_id, dataset, external_key, match)
             SELECT 'matrix-citation', nutrition_id, 'ciqual', '1000', 'close'
               FROM food_nutrition_citation WHERE id = ${citationOf(root(MILK), 'food_id')}`,
        ],
        outcome: { fails: 'food_nutrition_citation' },
    },
    {
        name: 'food_nutrition_value: a deleted value',
        sql: [
            `DELETE FROM food_nutrition_value
              WHERE citation_id = ${citationOf(root(MILK), 'food_id')}
                AND nutrient_id = (SELECT min(nutrient_id) FROM food_nutrition_value WHERE citation_id = ${citationOf(root(MILK), 'food_id')})`,
        ],
        outcome: { fails: 'food_nutrition_value' },
    },
    {
        name: 'food_nutrition_value: an extra value',
        sql: [
            `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, citation_id)
             SELECT c.nutrition_id, n.id, 1, c.id
               FROM food_nutrition_citation c, nutrient n
              WHERE c.id = ${citationOf(root(MILK), 'food_id')}
                AND n.id NOT IN (SELECT nutrient_id FROM food_nutrition_value WHERE citation_id = c.id)
              ORDER BY n.id LIMIT 1`,
        ],
        outcome: { fails: 'food_nutrition_value' },
    },
];

/** A corruption of the history, by the owner, and the fact it must fail. */
interface HistoryCell {
    readonly name: string;
    readonly statements: (ids: {
        readonly milk: string;
        readonly otherRoot: string;
        readonly milkVariant: string;
    }) => readonly string[];
    readonly fact: string;
}

const UNRESOLVED = 'food_forward: a forward does not end at a catalog root or variant within 8 forwards';

/** One cell per covered `food_forward` column, each owned by the history checks. */
const HISTORY_CELLS: Readonly<Record<string, HistoryCell>> = {
    // Rewritten from "a forward ending at a retired root that forwards nowhere", which now ends its chain (ADR-0050 §4;
    // the passing case below).
    'food_forward.target_food_id': {
        name: 'a forward ending at a root that is gone',
        statements: () => ["UPDATE food_forward SET target_food_id = 'hist-nowhere' WHERE source_id = 'hist-live'"],
        fact: UNRESOLVED,
    },
    'food_forward.target_variant_id': {
        name: 'a forward ending at a row that is gone',
        statements: () => [
            "UPDATE food_forward SET target_variant_id = 'hist-nowhere' WHERE source_id = 'hist-variant'",
        ],
        fact: UNRESOLVED,
    },
    'food_forward.source_kind': {
        name: "a forward whose kind does not name its source's table",
        statements: () => ["UPDATE food_forward SET source_kind = 'root' WHERE source_id = 'hist-variant'"],
        fact: "food_forward: a forward's kind does not name the table its source is in",
    },
    'food_forward.source_key': {
        name: 'a forward whose source key is a root the seed holds live',
        statements: () => [`UPDATE food_forward SET source_key = '${MILK}' WHERE source_id = 'hist-gone'`],
        fact: "food_forward: a forward's source key is a row the seed holds live",
    },
};

/** History rows that break a one-way check. */
const HISTORY_ROW_CELLS: readonly {
    readonly name: string;
    readonly statements: HistoryCell['statements'];
    readonly facts: readonly string[];
}[] = [
    {
        name: 'a retired root whose key the seed holds again',
        statements: (ids) => [`UPDATE food SET retired_at = now() WHERE id = '${ids.otherRoot}'`],
        facts: ["food: a retired root's seed key is a root the seed holds"],
    },
    {
        name: 'a retired root that no longer owns its item',
        statements: () => [
            "INSERT INTO food_item (id, owner_kind) VALUES ('hist-item-stray', 'root')",
            "UPDATE food SET item_id = 'hist-item-stray' WHERE id = 'hist-rub'",
        ],
        facts: [
            'food_item: an item with a natural key has no owner',
            "food_item: a retired seed row's item has no natural key",
        ],
    },
    {
        name: `a chain one forward past MAX_FORWARD_HOPS (${String(MAX_FORWARD_HOPS)})`,
        statements: () => [
            "INSERT INTO food_forward (source_id, source_kind, target_food_id) VALUES ('hist-hop-x', 'root', 'hist-hop-0')",
        ],
        facts: [UNRESOLVED],
    },
    {
        name: 'a forward cycle',
        statements: () => [
            "INSERT INTO food_forward (source_id, source_kind, target_food_id) VALUES ('hist-cycle-a', 'root', 'hist-cycle-b')",
            "INSERT INTO food_forward (source_id, source_kind, target_food_id) VALUES ('hist-cycle-b', 'root', 'hist-cycle-a')",
        ],
        facts: [UNRESOLVED],
    },
    {
        name: 'a live row that is forwarded',
        statements: (ids) => [
            `INSERT INTO food_forward (source_id, source_kind, target_food_id) VALUES ('${ids.milk}', 'root', '${ids.otherRoot}')`,
        ],
        facts: ['food_forward: a live row is forwarded'],
    },
];

/**
 * The tables a verdict names, or the verdict itself when it is not a verification failure.
 *
 * @param verdict - What `verify` threw, or `undefined`.
 * @returns The tables, sorted, or the verdict.
 */
function failingTables(verdict: unknown): unknown {
    return isCatalogVerificationError(verdict)
        ? [...new Set(verdict.failures.map((failure) => failure.table))].sort()
        : verdict;
}

/**
 * Assert a verdict is the outcome a cell expects.
 *
 * @param verdict - What `verify` or a statement threw, or `undefined`.
 * @param outcome - The cell's outcome.
 */
function expectOutcome(verdict: unknown, outcome: Outcome): void {
    if ('fails' in outcome) {
        expect(failingTables(verdict)).toEqual(expect.arrayContaining([outcome.fails]));
    } else {
        expect(isCatalogVerificationError(verdict)).toBe(false);
        expect(verdict).toMatchObject({ code: outcome.refused });
    }
}

describe('the verifier over the real committed seed, applied by the seed transaction', () => {
    let checker: pg.Client;
    let verify: VerifyCatalog;
    let first: CatalogSeedResult;

    /**
     * Apply the committed seed on a connection of its own, as the deployed seed does.
     *
     * @param seedSha - The digest the apply records.
     * @param check - A check to run instead of the verifier's own, wrapping it.
     * @returns What the apply did.
     */
    async function applySeed(
        seedSha: string,
        check?: (client: pg.ClientBase, real: (client: pg.ClientBase) => Promise<void>) => Promise<void>,
    ): Promise<CatalogSeedResult> {
        const client = new pg.Client({ connectionString: foodDb().seederUrl });
        const verifier = createCatalogVerifier({ dataDir: DATA_DIR, sqlDir: SQL_DIR });

        await client.connect();

        try {
            return await runCatalogSeed({
                client,
                dataDir: DATA_DIR,
                seedSha,
                verify:
                    check === undefined
                        ? verifier
                        : { prepare: verifier.prepare, check: async (on) => check(on, verifier.check) },
                log: () => undefined,
            });
        } finally {
            await client.end();
        }
    }

    /** The digest of the newest ledger row. */
    async function ledgerHead(): Promise<string | undefined> {
        const result = await checker.query<{ seed_sha: string }>(
            'SELECT seed_sha FROM catalog_seed_ledger ORDER BY id DESC LIMIT 1',
        );

        return result.rows[0]?.seed_sha;
    }

    /**
     * Run statements and `verify` in one transaction on the prepared session, rolled back after.
     *
     * @param statements - Each must change at least one row.
     * @returns What was thrown, or `undefined` when `verify` passed.
     */
    async function verdictAfter(statements: readonly string[]): Promise<unknown> {
        await checker.query('BEGIN');

        try {
            for (const statement of statements) {
                const result = await checker.query(statement);

                expect(result.rowCount ?? 0, statement).toBeGreaterThan(0);
            }

            await checker.query('SET TRANSACTION READ ONLY');
            await verify(checker);

            return undefined;
        } catch (error) {
            return error;
        } finally {
            await checker.query('ROLLBACK');
        }
    }

    beforeAll(async () => {
        await foodDb().truncate();
        first = await applySeed(FIRST_SHA);
        checker = new pg.Client({ connectionString: foodDb().seederUrl });
        await checker.connect();
        verify = await prepareCatalogVerifier(checker, { dataDir: DATA_DIR, sqlDir: SQL_DIR });
    }, 300_000);

    afterAll(async () => {
        await checker.end();
        // The tier's database is shared by the next suite: leave it as the others do, empty.
        await foodDb().truncate();
    });

    it('applies the committed seed, and the verifier passes it inside the apply: two readings of one seed agree', async () => {
        expect(first.outcome).toBe('applied');
        expect(first.counts['rootInsert']).toBeGreaterThan(2000);
        expect(first.counts['valueInsert']).toBeGreaterThan(500_000);
        expect(await ledgerHead()).toBe(FIRST_SHA);
    });

    it('passes the applied catalog on a prepared session, in a READ ONLY transaction', async () => {
        expect(await verdictAfter([])).toBeUndefined();
    });

    it('covers AE5: an apply of an unchanged seed writes nothing, and verifies in its READ ONLY transaction', async () => {
        const modes: string[] = [];
        const again = await applySeed(FIRST_SHA, async (client, real) => {
            const mode = await client.query<{ transaction_read_only: string }>('SHOW transaction_read_only');

            modes.push(mode.rows[0]?.transaction_read_only ?? '');
            await real(client);
        });

        expect(again.outcome).toBe('unchanged');
        expect(modes).toEqual(['on']);
        expect(await ledgerHead()).toBe(FIRST_SHA);
    }, 300_000);

    it('covers AE6: an apply that collapses two variants into one fails its check and records nothing', async () => {
        const collapsed = applySeed(SECOND_SHA, async (client, real) => {
            await client.query(`DELETE FROM food_variant WHERE id = ${variant(OTHER_MILK_VARIANT)}`);
            await client.query(`DELETE FROM food_item WHERE id = ${item(OTHER_MILK_VARIANT)}`);
            await real(client);
        });

        await expect(collapsed).rejects.toSatisfy(
            (error) => isCatalogVerificationError(error) && error.failures.some((f) => f.table === 'food_variant'),
        );
        expect(await ledgerHead()).toBe(FIRST_SHA);
        expect(await verdictAfter([])).toBeUndefined();
    }, 300_000);

    it('holds the matrix to exactly the covered columns, and the verifier owes none', () => {
        expect(Object.keys(COLUMN_CELLS).concat(Object.keys(HISTORY_CELLS)).sort()).toEqual([...COVERED].sort());
        expect(OWED).toEqual([]);
    });

    it.each(Object.entries(COLUMN_CELLS).map(([column, cell]) => [column, cell.name, cell] as const))(
        '⛔ %s: %s',
        async (_column, _name, cell) => {
            expectOutcome(await verdictAfter(cell.sql), cell.outcome);
        },
    );

    it.each(ROW_CELLS.map((cell) => [cell.name, cell] as const))('⛔ %s', async (_name, cell) => {
        expectOutcome(await verdictAfter(cell.sql), cell.outcome);
    });

    describe('history (KTD-3, KTD-8, KTD-12): rows a past apply or the live path left', () => {
        /** The ids the history rows point at. */
        let ids: { readonly milk: string; readonly otherRoot: string; readonly milkVariant: string };

        /**
         * Write rows as the owner, committed, so the prepared seeder session sees them.
         *
         * @param statements - The statements.
         */
        async function asOwner(statements: readonly string[]): Promise<void> {
            await foodDb().asOwner(async (owner) => {
                await owner.query('BEGIN');

                try {
                    for (const statement of statements) {
                        await owner.query(statement);
                    }

                    await owner.query('COMMIT');
                } catch (error) {
                    await owner.query('ROLLBACK');

                    throw error;
                }
            });
        }

        /** The history every case starts from: a valid one, which the verifier passes. */
        function validHistory(): string[] {
            return [
                // A root the seed retired: its key and item left the seed, and it keeps its item.
                "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ('hist-item-rub', 'curated:hist-old-rub', 'root')",
                `INSERT INTO food (id, name, normalized_name, status, item_id, seed_key, retired_at)
                 VALUES ('hist-rub', 'old rub', 'old rub', 'RESOLVED', 'hist-item-rub', 'curated:hist-old-rub', now())`,
                // A variant the seed retired, which forwards to a live variant.
                "INSERT INTO food_item (id, natural_key, owner_kind) VALUES ('hist-item-variant', 'fdc:999999990', 'variant')",
                `INSERT INTO food_variant (id, food_id, item_id, retired_at)
                 VALUES ('hist-variant', '${ids.milk}', 'hist-item-variant', now())`,
                `INSERT INTO food_forward (source_id, source_kind, source_key, target_variant_id)
                 VALUES ('hist-variant', 'variant', 'fdc:999999990', '${ids.milkVariant}')`,
                // A root the seed deleted (a merge), which forwards through the retired variant: two forwards.
                `INSERT INTO food_forward (source_id, source_kind, source_key, target_variant_id)
                 VALUES ('hist-gone', 'root', 'fdc:999999991', 'hist-variant')`,
                // A live food the live path retired, forwarded to a seed root by food_app (KTD-12).
                "INSERT INTO food_item (id, owner_kind) VALUES ('hist-item-live', 'root')",
                `INSERT INTO food (id, name, normalized_name, status, item_id, retired_at)
                 VALUES ('hist-live', 'Milk, lowfat', 'milk, lowfat', 'RESOLVED', 'hist-item-live', now())`,
                `INSERT INTO food_forward (source_id, source_kind, target_food_id)
                 VALUES ('hist-live', 'root', '${ids.otherRoot}')`,
                // A chain of exactly MAX_FORWARD_HOPS forwards, through deleted rows, to a live root.
                ...Array.from({ length: MAX_FORWARD_HOPS }, (_unused, hop) =>
                    hop === MAX_FORWARD_HOPS - 1
                        ? `INSERT INTO food_forward (source_id, source_kind, target_food_id)
                           VALUES ('hist-hop-${String(hop)}', 'root', '${ids.milk}')`
                        : `INSERT INTO food_forward (source_id, source_kind, target_food_id)
                           VALUES ('hist-hop-${String(hop)}', 'root', 'hist-hop-${String(hop + 1)}')`,
                ),
            ];
        }

        /** The facts a verdict names, or the verdict itself when it is not a verification failure. */
        function failingFacts(verdict: unknown): unknown {
            return isCatalogVerificationError(verdict)
                ? verdict.failures.map((failure) => `${failure.table}: ${failure.fact}`).sort()
                : verdict;
        }

        beforeAll(async () => {
            const found = await checker.query<{ milk: string; other_root: string; milk_variant: string }>(
                `SELECT ${root(MILK)} AS milk, ${root('fdc:746778')} AS other_root, ${variant(MILK_VARIANT)} AS milk_variant`,
            );
            const [row] = found.rows;

            if (row === undefined) {
                throw new Error('the seeded catalog holds none of the rows the history points at');
            }

            ids = { milk: row.milk, otherRoot: row.other_root, milkVariant: row.milk_variant };
        });

        afterEach(async () => {
            await asOwner([
                // Every forward: the applied seed wrote none, and a case may forward a seed row's own id.
                'DELETE FROM food_forward',
                "DELETE FROM food_variant WHERE id LIKE 'hist-%'",
                "DELETE FROM food WHERE id LIKE 'hist-%'",
                "DELETE FROM food_item WHERE id LIKE 'hist-%'",
                `UPDATE food SET retired_at = NULL WHERE id = '${ids.otherRoot}'`,
            ]);
        });

        it('passes a valid history: a retired root and variant, seed and live-path forwards, a chain of the full bound', async () => {
            await asOwner(validHistory());

            expect(await verdictAfter([])).toBeUndefined();
        });

        it('passes a forward ending at a root the seed retired with no successor, which answers as itself (ADR-0050 §4)', async () => {
            await asOwner([
                ...validHistory(),
                "UPDATE food_forward SET target_food_id = 'hist-rub' WHERE source_id = 'hist-live'",
            ]);

            expect(await verdictAfter([])).toBeUndefined();
        });

        it.each(Object.entries(HISTORY_CELLS).map(([column, cell]) => [column, cell.name, cell] as const))(
            '⛔ %s: %s',
            async (_column, _name, cell) => {
                await asOwner([...validHistory(), ...cell.statements(ids)]);

                expect(failingFacts(await verdictAfter([]))).toEqual(expect.arrayContaining([cell.fact]));
            },
        );

        it("⛔ nutrient: a dictionary entry the seed names, stripped of its definition's INFOODS tag (KTD-23)", async () => {
            await asOwner(["UPDATE nutrient SET infoods_tag = NULL WHERE name = 'Protein' AND unit = 'g'"]);

            try {
                expect(failingFacts(await verdictAfter([]))).toEqual([
                    "nutrient: a dictionary entry the seed names lacks its definition's INFOODS tag",
                ]);
            } finally {
                await asOwner(["UPDATE nutrient SET infoods_tag = 'PROCNT' WHERE name = 'Protein' AND unit = 'g'"]);
            }
        });

        it.each(HISTORY_ROW_CELLS.map((cell) => [cell.name, cell] as const))('⛔ %s', async (_name, cell) => {
            await asOwner([...validHistory(), ...cell.statements(ids)]);

            expect(failingFacts(await verdictAfter([]))).toEqual(expect.arrayContaining([...cell.facts]));
        });
    });
});
