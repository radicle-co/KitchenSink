/**
 * Writes a projected seed's catalog straight into a migrated food database, so a verifier test has a catalog that
 * equals the seed without the applier (curated catalog plan U6, KTD-3).
 *
 * The content comes from `projectSeed`, the seeder's own reading of the committed bytes, and the verifier derives its
 * expected state from the same bytes in SQL. A catalog written here passes the verifier only when the two readings
 * agree, which makes the positive control of every comparison case a parity test too.
 *
 * Every column takes the value the seeder's write contract gives it (`catalog/catalogWriteSet.ts`): the constants a seeded
 * root and source row carry are the columns' defaults, a dictionary entry carries the INFOODS tag its definition maps,
 * and no `food_field_provenance` row is written.
 *
 * The caller passes the client and owns the transaction: a test writes as the seeder inside a transaction it rolls
 * back.
 *
 * @pattern Object Mother — one fully linked catalog per projected seed
 */
import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import { mappedTagOf } from '../../../src/foods/dao/nutrient.dao.js';
import { normalizeName } from '../../../src/foods/foodName.js';
import type {
    CatalogContent,
    ContentCitation,
    ContentNutrition,
} from '../../../src/foods/seed/catalog/catalogSnapshot.js';

/** The ids the writer minted, by natural key. */
export interface WrittenCatalog {
    readonly roots: ReadonlyMap<string, string>;
    readonly variants: ReadonlyMap<string, string>;
    readonly items: ReadonlyMap<string, string>;
    /** Each owner's citation id, by `root:<seedKey>` or `variant:<itemKey>`. */
    readonly citations: ReadonlyMap<string, string>;
}

/**
 * A dictionary entry's id, inserted when absent with the tag its definition maps.
 *
 * @param client - The writing client.
 * @param name - The nutrient's name.
 * @param unit - Its unit.
 * @returns Its id.
 * @sideEffect May insert into `nutrient`.
 */
async function nutrientId(client: pg.ClientBase, name: string, unit: string): Promise<string> {
    await client.query(
        'INSERT INTO nutrient (id, name, unit, infoods_tag) VALUES ($1, $2, $3, $4) ON CONFLICT (name, unit) DO NOTHING',
        [randomUUID(), name, unit, mappedTagOf(name, unit) ?? null],
    );

    const found = await client.query<{ id: string }>('SELECT id FROM nutrient WHERE name = $1 AND unit = $2', [
        name,
        unit,
    ]);

    return found.rows[0]?.id ?? '';
}

/**
 * A food group's id, inserted when absent.
 *
 * @param client - The writing client.
 * @param name - The group's name.
 * @returns Its id.
 * @sideEffect May insert into `food_category`.
 */
async function categoryId(client: pg.ClientBase, name: string): Promise<string> {
    await client.query('INSERT INTO food_category (id, name) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING', [
        randomUUID(),
        name,
    ]);

    const found = await client.query<{ id: string }>('SELECT id FROM food_category WHERE name = $1', [name]);

    return found.rows[0]?.id ?? '';
}

/**
 * Write one owner's nutrition: its header, its one citation and its values.
 *
 * @param client - The writing client.
 * @param owner - The header's arm: a root's id or a variant's id.
 * @param nutrition - The nutrition.
 * @returns The citation's id.
 * @sideEffect Inserts into the three nutrition tables, and the dictionary.
 */
async function writeNutrition(
    client: pg.ClientBase,
    owner: { readonly foodId: string | null; readonly variantId: string | null },
    nutrition: ContentNutrition,
): Promise<string> {
    const header = randomUUID();
    const citation = randomUUID();
    const cited: ContentCitation = nutrition.citation;

    await client.query('INSERT INTO food_nutrition (id, food_id, food_variant_id) VALUES ($1, $2, $3)', [
        header,
        owner.foodId,
        owner.variantId,
    ]);

    if (cited.dataset === 'label') {
        await client.query(
            `INSERT INTO food_nutrition_citation
                 (id, nutrition_id, dataset, url, retrieved_on, manufacturer, serving_label, serving_grams)
             VALUES ($1, $2, 'label', $3, $4, $5, $6, $7)`,
            [
                citation,
                header,
                cited.url,
                cited.retrievedOn,
                cited.manufacturer,
                cited.servingLabel,
                cited.servingGrams,
            ],
        );
    } else {
        await client.query(
            `INSERT INTO food_nutrition_citation
                 (id, nutrition_id, dataset, external_key, match, density_g_per_ml, kcal_from_kj)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [citation, header, cited.dataset, cited.externalKey, cited.match, cited.densityGPerMl, cited.kcalFromKj],
        );
    }

    for (const value of nutrition.values) {
        await client.query(
            `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, trace, citation_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [header, await nutrientId(client, value.name, value.unit), value.amount, value.amount === null, citation],
        );
    }

    return citation;
}

/**
 * Write a projected catalog: every item, root, variant and part, every item's source rows, portions and food groups,
 * and every owner's nutrition.
 *
 * @param client - A client the ownership trigger admits on seed-owned rows (the seeder or the owner), inside the
 *   caller's transaction.
 * @param content - The projected catalog.
 * @returns The ids minted.
 * @sideEffect Inserts into the catalog tables and the dictionaries.
 */
export async function writeProjectedCatalog(client: pg.ClientBase, content: CatalogContent): Promise<WrittenCatalog> {
    const items = new Map<string, string>();
    const roots = new Map<string, string>();
    const variants = new Map<string, string>();
    const citations = new Map<string, string>();
    const sources = new Map<string, string>();

    for (const key of content.items.keys()) {
        const id = randomUUID();

        items.set(key, id);
        await client.query('INSERT INTO food_item (id, natural_key, owner_kind) VALUES ($1, $2, $3)', [
            id,
            key,
            content.variants.has(key) ? 'variant' : 'root',
        ]);
    }

    for (const root of content.roots.values()) {
        const id = randomUUID();

        roots.set(root.seedKey, id);
        await client.query(
            `INSERT INTO food (id, name, normalized_name, aliases, status, item_id, seed_key)
             VALUES ($1, $2, $3, $4, 'RESOLVED', $5, $6)`,
            [
                id,
                root.name,
                normalizeName(root.name),
                root.synonyms.length === 0 ? null : root.synonyms.join('; '),
                items.get(root.item),
                root.seedKey,
            ],
        );

        if (root.nutrition !== null) {
            citations.set(
                `root:${root.seedKey}`,
                await writeNutrition(client, { foodId: id, variantId: null }, root.nutrition),
            );
        }
    }

    for (const variant of content.variants.values()) {
        const id = randomUUID();

        variants.set(variant.item, id);
        await client.query('INSERT INTO food_variant (id, food_id, item_id) VALUES ($1, $2, $3)', [
            id,
            roots.get(variant.root),
            items.get(variant.item),
        ]);

        for (const [index, part] of variant.parts.entries()) {
            const ordinal = variant.parts.slice(0, index).filter((other) => other.attribute === part.attribute).length;

            await client.query(
                'INSERT INTO food_variant_part (variant_id, attribute, ordinal, text) VALUES ($1, $2, $3, $4)',
                [id, part.attribute, ordinal, part.text],
            );
        }

        citations.set(
            `variant:${variant.item}`,
            await writeNutrition(client, { foodId: null, variantId: id }, variant.nutrition),
        );
    }

    for (const item of content.items.values()) {
        const itemId = items.get(item.key);

        for (const source of item.sources) {
            const id = randomUUID();

            sources.set(`${item.key}\u0000${source.source}\u0000${source.externalKey}`, id);
            await client.query(
                'INSERT INTO food_sources (id, item_id, source, external_key, lineage_key) VALUES ($1, $2, $3, $4, $5)',
                [id, itemId, source.source, source.externalKey, source.lineageKey],
            );
        }

        const owner = content.variants.has(item.key)
            ? `variant:${item.key}`
            : `root:${[...content.roots.values()].find((root) => root.item === item.key)?.seedKey ?? ''}`;

        for (const portion of item.portions) {
            await client.query(
                'INSERT INTO food_portions (id, item_id, label, gram_weight, source_id, citation_id) VALUES ($1, $2, $3, $4, $5, $6)',
                [
                    randomUUID(),
                    itemId,
                    portion.label,
                    portion.gramWeight,
                    'source' in portion
                        ? sources.get(`${item.key}\u0000${portion.source.source}\u0000${portion.source.externalKey}`)
                        : null,
                    'citation' in portion ? citations.get(owner) : null,
                ],
            );
        }

        for (const category of item.categories) {
            await client.query(
                'INSERT INTO food_category_assignment (item_id, category_id, source_id) VALUES ($1, $2, $3)',
                [
                    itemId,
                    await categoryId(client, category.name),
                    category.source === null
                        ? null
                        : sources.get(`${item.key}\u0000${category.source.source}\u0000${category.source.externalKey}`),
                ],
            );
        }
    }

    return { roots, variants, items, citations };
}
