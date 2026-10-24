/**
 * ⛔ The verifier's restated rules equal the seeder's, over the real committed inputs (curated catalog plan U6, KTD-3).
 *
 * LOCAL target, connected as the seeder. The verifier derives the expected catalog in SQL and imports nothing of the
 * seeder, so each rule it restates exists twice. This suite runs both over the same committed bytes and asserts equal
 * output, so the two cannot drift silently:
 *
 * - rule by rule: the description key (R48), the energy test and the election, the CSV reader's trimming, the bulk
 *   nutrient and portion mapping (KTD-28's label), the name key;
 * - and whole: every expected table the SQL builds equals `projectSeed(composeSeedImage(loadSeedSources(…)))`, row for
 *   row, because the faults that matter most live between the rules (which order categories are cited in, which order
 *   portions are ranked in).
 *
 * The seeder's TypeScript is the reference here only because the two must agree. Which one is right is decided by the
 * plan, and a disagreement is a finding either way.
 */
import { join } from 'node:path';

import Decimal from 'decimal.js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';

import { normalizeName } from '../../src/foods/foodName.js';
import {
    buildBaselineSeed,
    normalizeUsdaDescription,
    statesEnergy,
} from '../../src/foods/seed/catalog/baselineSeed.js';
import { brandedPer100g, labelPer100g, toPer100g } from '../../src/foods/seed/catalog/basisConversion.js';
import { composeSeedImage, type SeedImage, type SeedInputs } from '../../src/foods/seed/catalog/seedImage.js';
import { projectSeed } from '../../src/foods/seed/catalog/seedProjection.js';
import { loadSeedSources } from '../../src/foods/seed/catalog/seedSources.js';
import type { CatalogSnapshot, ContentNutrition } from '../../src/foods/seed/catalog/catalogSnapshot.js';
import { DATASET_SOURCE } from '../../src/foods/seed/citationDatasets.js';
import { NUTRIENT_DEFINITIONS } from '../../src/foods/nutrition/nutrientIdentity.js';
import { makeBrandedProduct, makeLabel } from '../../src/foods/seed/catalog/__fixtures__/curatedSeed.fixtures.js';
import { prepareCatalogVerifier } from '../../src/foods/seed/verify/catalogVerifier.js';
import { canonicalizeBulkUnit } from '../../src/sources/usda/bulk/usdaBulk.parser.js';
import { canonicalizeNutrientName } from '../../src/sources/usda/usda.adapter.js';
import { usdaPortionLabel } from '../../src/sources/usda/usdaPortionLabel.js';
import { foodDb } from '../support/roleDb.js';

const DATA_DIR = join(import.meta.dirname, '../../src/foods/seed/data');
const SQL_DIR = join(import.meta.dirname, '../../src/foods/seed/verify/sql');

/** The multiset difference of two lists of rendered rows, both ways, the first few of each. Pure. */
function differences(
    sql: readonly string[],
    ts: readonly string[],
): { readonly onlySql: readonly string[]; readonly onlyTs: readonly string[] } {
    const counts = new Map<string, number>();

    for (const row of ts) {
        counts.set(row, (counts.get(row) ?? 0) + 1);
    }

    const onlySql: string[] = [];

    for (const row of sql) {
        const count = counts.get(row) ?? 0;

        if (count === 0) {
            onlySql.push(row);
        } else {
            counts.set(row, count - 1);
        }
    }

    const onlyTs = [...counts].flatMap(([row, count]) => Array.from({ length: count }, () => row));

    return { onlySql: onlySql.sort().slice(0, 8), onlyTs: onlyTs.sort().slice(0, 8) };
}

/** Assert two renderings of one table are the same multiset, naming what differs. */
function expectSameRows(what: string, sql: readonly string[], ts: readonly string[]): void {
    expect(differences(sql, ts), what).toEqual({ onlySql: [], onlyTs: [] });
    expect(sql.length, `${what}: rows compared`).toBeGreaterThan(0);
}

/** A row rendered as one comparable string. */
const render = (...fields: readonly unknown[]): string => JSON.stringify(fields);

describe('the verifier restates the seeder, over the committed seed', () => {
    let client: pg.Client;
    let inputs: SeedInputs;
    let image: SeedImage;
    let snapshot: CatalogSnapshot;

    /** One column of rows from the session, rendered. */
    async function sqlRows(sql: string): Promise<string[]> {
        const result = await client.query<{ row: unknown[] }>(sql);

        return result.rows.map((row) => JSON.stringify(row.row));
    }

    /** Run a restated function over a list of inputs, in one round trip. */
    async function sqlMap(fn: string, values: readonly (string | null)[][]): Promise<(string | boolean | null)[]> {
        const arity = values[0]?.length ?? 0;
        const columns = Array.from({ length: arity }, (_unused, index) => `(value ->> ${String(index)})`).join(', ');
        const result = await client.query<{ out: string | boolean | null }>(
            `SELECT pg_temp.${fn}(${columns}) AS out
               FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS input(value, position)
              ORDER BY position`,
            [JSON.stringify(values)],
        );

        return result.rows.map((row) => row.out);
    }

    beforeAll(async () => {
        client = new pg.Client({ connectionString: foodDb().seederUrl });
        await client.connect();
        inputs = await loadSeedSources(DATA_DIR);
        image = composeSeedImage(inputs);
        snapshot = projectSeed(image);
        await prepareCatalogVerifier(client, { dataDir: DATA_DIR, sqlDir: SQL_DIR });
    }, 300_000);

    afterAll(async () => {
        await client.end();
    });

    it('prepares as the seeder, so its own grants suffice for the temp functions and tables', async () => {
        const result = await client.query<{ who: string }>('SELECT current_user AS who');

        expect(result.rows[0]?.who).toBe(DATABASE_ROLES.food.seeder);
    });

    describe('rule by rule', () => {
        it('reads the same universe, with the same facts per item', async () => {
            const sql = await sqlRows(
                `SELECT jsonb_build_array(item_key, description, publication_date, is_foundation, food_group,
                                          lineage_key, has_energy) AS row
                   FROM v_usda_item`,
            );
            const ts = inputs.usdaItems.map((item) =>
                render(
                    item.key,
                    item.description,
                    item.publicationDate,
                    item.isFoundation,
                    item.foodGroup,
                    item.lineageKey,
                    item.hasEnergy,
                ),
            );

            expectSameRows('universe', sql, ts);
            expect(sql).toHaveLength(8188);
        });

        it('keys every description as normalizeUsdaDescription does (R48)', async () => {
            const descriptions = inputs.usdaItems.map((item) => item.description);
            const keys = await sqlMap(
                'v_usda_description_key',
                descriptions.map((description) => [description]),
            );

            expect(keys).toEqual(descriptions.map((description) => normalizeUsdaDescription(description)));
        });

        it("elects every group's supplier as the baseline does, in the same member order (R48)", async () => {
            const exclusions = new Set(inputs.curated.changes.exclusions);
            const baseline = buildBaselineSeed(inputs.usdaItems, exclusions);
            const sql = await sqlRows(
                `SELECT jsonb_build_array(item_key, supplier_key, supply_rank) AS row FROM v_baseline_member`,
            );
            const ts = [...baseline.groups.values()].flatMap((group) =>
                group.members.map((member, index) => render(member.key, group.supplier.key, index + 1)),
            );

            expectSameRows('election', sql, ts);
        });

        it('tells energy as statesEnergy does, over crafted amounts', async () => {
            const amounts = [
                '155',
                ' 1.5 ',
                '0',
                '',
                '  ',
                '-2',
                '+3',
                '1e5',
                '.5',
                '5.',
                '0x1F',
                '0o17',
                '0b101',
                '-0x1F',
                'Infinity',
                '1e400',
                'NaN',
                '1,5',
                '1.5.2',
                ' 7　',
            ];
            const sql = await sqlMap(
                'v_states_value',
                amounts.map((amount) => [amount]),
            );

            expect(sql).toEqual(amounts.map((amount) => statesEnergy([{ nutrientId: 1008, amount }])));
        });

        it("maps every nutrient definition's name and unit as the bulk parser does", async () => {
            const result = await client.query<{ name: string; unit_name: string; out_name: string; out_unit: string }>(
                `SELECT name, unit_name, pg_temp.v_canonical_nutrient_name(name) AS out_name,
                        pg_temp.v_canonical_bulk_unit(unit_name) AS out_unit
                   FROM v_usda_nutrient_definition`,
            );

            expect(result.rows.length).toBeGreaterThan(400);

            for (const row of result.rows) {
                expect([row.out_name, row.out_unit], row.name).toEqual([
                    canonicalizeNutrientName(row.name),
                    canonicalizeBulkUnit(row.unit_name),
                ]);
            }
        });

        it("maps every item's nutrient rows as mapBulkNutrients does", async () => {
            const sql = await sqlRows(
                `SELECT jsonb_build_array(item_key, name, unit, amount) AS row FROM v_usda_item_nutrient`,
            );
            const ts = inputs.usdaItems.flatMap((item) =>
                item.nutrients.map((nutrient) => render(item.key, nutrient.name, nutrient.unit, nutrient.amount)),
            );

            expectSameRows('nutrient rows', sql, ts);
        });

        it("labels and weighs every item's portions as mapBulkPortions does (KTD-28)", async () => {
            const sql = await sqlRows(
                `SELECT jsonb_build_array(item_key, label, gram_weight) AS row FROM v_usda_item_portion`,
            );
            const ts = inputs.usdaItems.flatMap((item) =>
                item.portions.map((portion) => render(item.key, portion.label, portion.gramWeight)),
            );

            expectSameRows('portion rows', sql, ts);
        });

        it('labels crafted portion rows as usdaPortionLabel does', async () => {
            const rows: [string, string, string, string][] = [
                ['4', '', '', 'oz'],
                ['1.0', 'egg', '', 'white'],
                ['', '', '1 cup, shredded', '10205'],
                ['0', 'cup', '', ''],
                ['2.50', 'undetermined', '', 'slice'],
                ['1', 'Undetermined', '', ''],
                ['0.0000001', 'g', '', ''],
                ['0.00005', 'g', '', ''],
                ['3', 'cup', ' chopped ', '12'],
                ['1e2', 'cup', '', ''],
                ['', 'cup', '', ''],
            ];
            const sql = await sqlMap('v_portion_label', rows);

            expect(sql).toEqual(
                rows.map(([amount, measureUnit, portionDescription, modifier]) =>
                    usdaPortionLabel({
                        amount: /^\d+(\.\d+)?$/u.test(amount) && Number(amount) <= 10_000_000 ? Number(amount) : null,
                        measureUnit,
                        portionDescription,
                        modifier,
                    }),
                ),
            );
        });

        it('trims as JavaScript trims', async () => {
            const values = ['  a ', '\t\nb\r\u000b\f', ' c　', '﻿d ', 'e​', ' ', ''];
            const sql = await sqlMap(
                'v_js_trim',
                values.map((value) => [value]),
            );

            expect(sql).toEqual(values.map((value) => value.trim()));
        });

        it('keys every expected root name as normalizeName does, and crafted names too', async () => {
            const names = [
                ...[...image.roots.values()].map((root) => root.name),
                'Bro​ccoli',
                'café́ Crème',
                'Ａpple  pie',
                'tab\tand\nnewline',
                '   lead and trail 　',
                'İstanbul ΣΟΦΟΣ',
                'ﬁne ﬂour',
                '‮evil‬ name',
            ];
            const sql = await sqlMap(
                'v_normalize_name',
                names.map((name) => [name]),
            );

            expect(sql).toEqual(names.map((name) => normalizeName(name)));
        });
    });

    describe('rule by rule: nutrition (V4)', () => {
        it('maps each stored INFOODS tag to the dictionary entry nutrientIdentity does (KTD-23)', async () => {
            const sql = await sqlRows(`SELECT jsonb_build_array(tag, name, unit) AS row FROM v_nutrient_tag`);
            const ts = Object.values(NUTRIENT_DEFINITIONS).flatMap((definition) =>
                definition.tag === null ? [] : [render(definition.tag, definition.name, definition.unit)],
            );

            expectSameRows('tags', sql, ts);
        });

        it('names the source of each citation dataset as citationDatasets does (KTD-22)', async () => {
            const sql = await sqlRows(`SELECT jsonb_build_array(dataset, source) AS row FROM v_citation_dataset`);
            const ts = Object.entries(DATASET_SOURCE).map(([dataset, source]) => render(dataset, source));

            expectSameRows('datasets', sql, ts);
        });

        it('divides in the same two steps as basisConversion, over every committed extract value (R54)', async () => {
            const result = await client.query<{ value: string; by_density: string; by_kj: string }>(
                `SELECT stated.value #>> '{}' AS value,
                        trim_scale(pg_temp.v_divide((stated.value #>> '{}')::numeric, 1.03))::text AS by_density,
                        trim_scale(pg_temp.v_divide((stated.value #>> '{}')::numeric, 4.184))::text AS by_kj
                   FROM v_extract_line line
                  CROSS JOIN LATERAL jsonb_each(line.doc -> 'values') AS stated`,
            );

            expect(result.rows.length).toBeGreaterThan(500);

            for (const row of result.rows) {
                const perMl = toPer100g({
                    key: 'x',
                    name: 'x',
                    basis: 'per100mL',
                    values: { PROCNT: row.value },
                    densityGramsPerMl: '1.03',
                });
                const fromKj = toPer100g({ key: 'x', name: 'x', basis: 'per100g', values: { ENERC_KJ: row.value } });

                expect([row.by_density, row.by_kj], row.value).toEqual([
                    new Decimal(perMl.values.PROCNT ?? 'NaN').toFixed(),
                    new Decimal(fromKj.values.ENERC_KCAL ?? 'NaN').toFixed(),
                ]);
            }
        });

        it('divides crafted ties and tiny quotients as decimal.js does', async () => {
            const pairs: [string, string][] = [
                ['0.0005', '1'],
                ['1.0005', '1'],
                ['2.0015', '1'],
                ['1', '3'],
                ['2', '3'],
                ['0.001', '7'],
                ['0', '4.184'],
                ['123456789.123', '0.001'],
                ['5', '0.8'],
                ['0.0004999', '1'],
                // 23 significant digits: decimal.js rounds the quotient to 20 first (to 1.0005), so the result is 1.001,
                // where rounding the exact quotient once would give 1.
                ['1.0004999999999999999995', '1'],
            ];
            const result = await client.query<{ out: string }>(
                `SELECT trim_scale(pg_temp.v_divide(pair[1]::numeric, pair[2]::numeric))::text AS out
                   FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS input(value, position)
                  CROSS JOIN LATERAL (SELECT ARRAY[value ->> 0, value ->> 1] AS pair) AS unpacked
                  ORDER BY position`,
                [JSON.stringify(pairs)],
            );

            expect(result.rows.map((row) => row.out)).toEqual(
                pairs.map(([amount, density]) =>
                    new Decimal(
                        toPer100g({
                            key: 'x',
                            name: 'x',
                            basis: 'per100mL',
                            values: { PROCNT: amount },
                            densityGramsPerMl: density,
                        }).values.PROCNT ?? 'NaN',
                    ).toFixed(),
                ),
            );
        });

        it('reads a label per 100 g as labelPer100g does, a printed zero dropped (KTD-20, OQ-2)', async () => {
            const label = makeLabel({
                serving: { label: '2 tbsp', grams: '32' },
                perServing: [
                    { name: 'Energy', unit: 'kcal', amount: '190' },
                    { name: 'Protein', unit: 'g', amount: '7' },
                    { name: 'Sodium, na', unit: 'mg', amount: '0' },
                    { name: 'Total lipid (fat)', unit: 'g', amount: '16.5' },
                ],
            });
            const result = await client.query<{ name: string; unit: string; amount: string }>(
                `SELECT printed.value ->> 'name' AS name, printed.value ->> 'unit' AS unit,
                        trim_scale(pg_temp.v_divide((printed.value ->> 'amount')::numeric * 100, $2::numeric))::text
                            AS amount
                   FROM jsonb_array_elements($1::jsonb) AS printed(value)
                  WHERE (printed.value ->> 'amount')::numeric <> 0`,
                [JSON.stringify(label.perServing), label.serving.grams],
            );

            expect(result.rows).toEqual(
                labelPer100g(label).map((value) => ({ ...value, amount: new Decimal(value.amount).toFixed() })),
            );
        });

        it('reads every committed Branded product per 100 g as brandedPer100g does (OQ-2)', async () => {
            const sql = await sqlRows(
                `SELECT jsonb_build_array(item_key, name, unit, amount) AS row
                   FROM (
                       SELECT DISTINCT ON (product.item_key, mapped.name, mapped.unit)
                              product.item_key, mapped.name, mapped.unit, mapped.amount
                         FROM v_branded_product product
                        CROSS JOIN LATERAL jsonb_array_elements(product.doc -> 'nutrients') WITH ORDINALITY
                                  AS row(value, position)
                        CROSS JOIN LATERAL (
                            SELECT pg_temp.v_canonical_nutrient_name(row.value ->> 'name') AS name,
                                   pg_temp.v_canonical_bulk_unit(row.value ->> 'unitName') AS unit,
                                   row.value ->> 'amount' AS amount, row.position
                        ) AS mapped
                        WHERE mapped.name <> '' AND mapped.unit <> '' AND mapped.amount::numeric <> 0
                        ORDER BY product.item_key, mapped.name, mapped.unit, mapped.position
                   ) AS kept`,
            );
            const ts = [...inputs.branded.entries()].flatMap(([key, product]) =>
                brandedPer100g(product).map((value) => render(key, value.name, value.unit, value.amount)),
            );

            expectSameRows('branded per 100 g', sql, ts);
            expect(brandedPer100g(makeBrandedProduct())).toHaveLength(1);
        });
    });

    describe('whole: the expected catalog equals the projected seed image', () => {
        it('roots', async () => {
            const sql = await sqlRows(
                `SELECT jsonb_build_array(seed_key, name, normalized_name, aliases, item_key) AS row FROM v_expected_root`,
            );
            const ts = [...snapshot.content.roots.values()].map((root) =>
                render(
                    root.seedKey,
                    root.name,
                    normalizeName(root.name),
                    root.synonyms.length === 0 ? null : root.synonyms.join('; '),
                    root.item,
                ),
            );

            expectSameRows('roots', sql, ts);
        });

        it('items', async () => {
            const variantItems = new Set(snapshot.content.variants.keys());
            const sql = await sqlRows(`SELECT jsonb_build_array(item_key, owner_kind) AS row FROM v_expected_item`);
            const ts = [...snapshot.content.items.keys()].map((key) =>
                render(key, variantItems.has(key) ? 'variant' : 'root'),
            );

            expectSameRows('items', sql, ts);
        });

        it('variants and their parts, each part by its place within its attribute', async () => {
            const variants = await sqlRows(
                `SELECT jsonb_build_array(item_key, root_key) AS row FROM v_expected_variant`,
            );
            const parts = await sqlRows(
                `SELECT jsonb_build_array(item_key, attribute, text, attribute_place) AS row FROM v_expected_part`,
            );
            const tsVariants = [...snapshot.content.variants.values()].map((variant) =>
                render(variant.item, variant.root),
            );
            const tsParts = [...snapshot.content.variants.values()].flatMap((variant) =>
                variant.parts.map((part, index) =>
                    render(
                        variant.item,
                        part.attribute,
                        part.text,
                        variant.parts.slice(0, index + 1).filter((other) => other.attribute === part.attribute).length,
                    ),
                ),
            );

            expectSameRows('variants', variants, tsVariants);
            expectSameRows('parts', parts, tsParts);
        });

        it('source rows, with lineage keys (KTD-27)', async () => {
            const sql = await sqlRows(
                `SELECT jsonb_build_array(item_key, 'usda', fdc_id, lineage_key) AS row FROM v_expected_source`,
            );
            const ts = [...snapshot.content.items.values()].flatMap((item) =>
                item.sources.map((source) => render(item.key, source.source, source.externalKey, source.lineageKey)),
            );

            expectSameRows('sources', sql, ts);
        });

        it('portions from source rows (R9)', async () => {
            const sql = await sqlRows(
                `SELECT jsonb_build_array(item_key, label, trim_scale(gram_weight)::text, fdc_id) AS row
                   FROM v_expected_source_portion`,
            );
            const ts = [...snapshot.content.items.values()].flatMap((item) =>
                item.portions.flatMap((portion) =>
                    'source' in portion
                        ? [render(item.key, portion.label, portion.gramWeight, portion.source.externalKey)]
                        : [],
                ),
            );

            expectSameRows('source portions', sql, ts);
        });

        it('food groups, each cited by the first source that states it', async () => {
            const sql = await sqlRows(
                `SELECT jsonb_build_array(item_key, name, fdc_id) AS row FROM v_expected_category`,
            );
            const ts = [...snapshot.content.items.values()].flatMap((item) =>
                item.categories.map((category) =>
                    render(item.key, category.name, category.source?.externalKey ?? null),
                ),
            );

            expectSameRows('categories', sql, ts);
        });

        it('nutrition headers and their citations (KTD-19, KTD-22, R54)', async () => {
            const sql = await sqlRows(
                `SELECT jsonb_build_array(owner_kind, owner_key, dataset, external_key, match,
                                          trim_scale(density_g_per_ml)::text, kcal_from_kj, url, retrieved_on::text,
                                          manufacturer, serving_label, trim_scale(serving_grams)::text) AS row
                   FROM v_expected_nutrition`,
            );

            const citationOf = (kind: string, key: string, nutrition: ContentNutrition): string => {
                const { citation } = nutrition;

                return citation.dataset === 'label'
                    ? render(
                          kind,
                          key,
                          'label',
                          null,
                          null,
                          null,
                          false,
                          citation.url,
                          citation.retrievedOn,
                          citation.manufacturer,
                          citation.servingLabel,
                          citation.servingGrams,
                      )
                    : render(
                          kind,
                          key,
                          citation.dataset,
                          citation.externalKey,
                          citation.match,
                          citation.densityGPerMl,
                          citation.kcalFromKj,
                          null,
                          null,
                          null,
                          null,
                          null,
                      );
            };

            const ts = [
                ...[...snapshot.content.roots.values()].flatMap((root) =>
                    root.nutrition === null ? [] : [citationOf('root', root.seedKey, root.nutrition)],
                ),
                ...[...snapshot.content.variants.values()].map((variant) =>
                    citationOf('variant', variant.item, variant.nutrition),
                ),
            ];

            expectSameRows('citations', sql, ts);
        });

        it('nutrition values, traces included (R53)', async () => {
            const sql = await sqlRows(
                `SELECT jsonb_build_array(owner_kind, owner_key, name, unit, trim_scale(amount)::text) AS row
                   FROM v_expected_value`,
            );
            const ts = [
                ...[...snapshot.content.roots.values()].flatMap((root) =>
                    (root.nutrition?.values ?? []).map((value) =>
                        render('root', root.seedKey, value.name, value.unit, value.amount),
                    ),
                ),
                ...[...snapshot.content.variants.values()].flatMap((variant) =>
                    variant.nutrition.values.map((value) =>
                        render('variant', variant.item, value.name, value.unit, value.amount),
                    ),
                ),
            ];

            expectSameRows('values', sql, ts);
        });

        it('the servings a citation states, as portions of the citing root (OQ-1)', async () => {
            const sql = await sqlRows(
                `SELECT jsonb_build_array(item_key, label, trim_scale(gram_weight)::text, dataset, cited_key) AS row
                   FROM v_expected_cited_portion`,
            );
            const ts = [...snapshot.content.items.values()].flatMap((item) =>
                item.portions.flatMap((portion) =>
                    'citation' in portion
                        ? [
                              render(
                                  item.key,
                                  portion.label,
                                  portion.gramWeight,
                                  portion.citation.dataset,
                                  portion.citation.dataset === 'label'
                                      ? portion.citation.url
                                      : portion.citation.externalKey,
                              ),
                          ]
                        : [],
                ),
            );

            expectSameRows('cited portions', sql, ts);
        });
    });
});
