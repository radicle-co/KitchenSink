/**
 * A small item-keyed catalog written straight to a migrated food database, for the LOCAL e2e suites that test the
 * catalog's own rules (curated catalog plan U4, KTD-6, KTD-12, KTD-19).
 *
 * One world holds one row of every guarded table, plus a spare row wherever a DELETE or INSERT case needs one that
 * nothing else depends on. A `seed` world is seed-owned: every item has a natural key. An `authored` world belongs to
 * one author: no item has a natural key, and the roots carry the author's id. Only a seed world has a variant: an
 * authored root never gets one (R40), so the authored world's variant-kind items stay unowned.
 *
 * The caller passes the client to write with. The suites write as the owner, whom the ownership trigger admits, so the
 * world exists before a subject's statement is tried against it.
 *
 * @pattern Object Mother — one named, fully linked catalog per ownership kind
 */
import { randomUUID } from 'node:crypto';

import type pg from 'pg';

/** Which kind of catalog a world is. */
export type CatalogWorldKind = 'seed' | 'authored';

/** The author every authored world belongs to. */
export const WORLD_AUTHOR = 'user-world-author';

/** The ids of the rows every world holds. */
interface CatalogWorldRows {
    /** The root's item and the root. */
    readonly item: string;
    readonly root: string;
    /** A variant-kind item: the seed world's variant owns it, and the authored world's stays unowned. */
    readonly variantItem: string;
    /** An unowned root item and an unowned variant item, for INSERT and DELETE cases. */
    readonly spareRootItem: string;
    readonly spareVariantItem: string;
    /** A second root with nutrition and no variant, for a DELETE that cascades. */
    readonly root2: string;
    /** A third root with no header and no variant, for a header INSERT. */
    readonly bareRoot: string;
    /** A source row every per-item row cites, and a spare one that nothing cites. */
    readonly source: string;
    readonly source2: string;
    /** A category the root is assigned to, and one it is not. */
    readonly category: string;
    readonly category2: string;
    /** The root's nutrition header, its cited citation and a spare citation nothing cites. */
    readonly nutrition: string;
    readonly citation: string;
    readonly citation2: string;
    /** Two dictionary nutrients; the root's header holds a value of the first. */
    readonly nutrient: string;
    readonly nutrient2: string;
    readonly portion: string;
}

/** A seed-owned world: its root has a variant with one part. */
export interface SeedWorld extends CatalogWorldRows {
    readonly kind: 'seed';
    readonly variant: string;
}

/** An authored world: its root has no variant (R40). */
export interface AuthoredWorld extends CatalogWorldRows {
    readonly kind: 'authored';
}

/** One world of either kind. */
export type CatalogWorld = SeedWorld | AuthoredWorld;

let sequence = Math.floor(Date.now() % 1_000_000) * 100;

/**
 * A fresh positive number, so every key a world mints is unique across a run.
 *
 * @returns The number.
 * @sideEffect Advances a module counter.
 */
export function nextNumber(): number {
    sequence += 1;

    return sequence;
}

/**
 * A fresh id.
 *
 * @param prefix - A readable prefix.
 * @returns The id.
 * @sideEffect Reads the random source.
 */
export function newId(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
}

/**
 * An item's natural key for a world: an `fdc:` key when seed-owned, none when authored.
 *
 * @param kind - The world kind.
 * @returns The key, or `null`.
 */
function naturalKey(kind: CatalogWorldKind): string | null {
    return kind === 'seed' ? `fdc:${nextNumber()}` : null;
}

/**
 * Write one item and return its id.
 *
 * @param client - The writer.
 * @param key - Its natural key, or `null`.
 * @param ownerKind - `root` or `variant`.
 * @returns The item's id.
 * @sideEffect Inserts into `food_item`.
 */
export async function insertItem(
    client: pg.ClientBase,
    key: string | null,
    ownerKind: 'root' | 'variant',
): Promise<string> {
    const id = newId('item');

    await client.query('INSERT INTO food_item (id, natural_key, owner_kind) VALUES ($1, $2, $3)', [id, key, ownerKind]);

    return id;
}

/** What a root needs beyond its item. */
export interface RootFields {
    readonly seedKey: string | null;
    readonly userId: string | null;
    readonly name?: string;
}

/**
 * Write one root on an item.
 *
 * @param client - The writer.
 * @param itemId - Its item.
 * @param fields - Its seed key or author.
 * @returns The root's id.
 * @sideEffect Inserts into `food`.
 */
export async function insertRoot(client: pg.ClientBase, itemId: string, fields: RootFields): Promise<string> {
    const id = newId('food');
    const name = fields.name ?? `world food ${nextNumber()}`;

    await client.query(
        `INSERT INTO food (id, item_id, name, normalized_name, status, seed_key, user_id, visibility)
         VALUES ($1, $2, $3, $4, 'RESOLVED', $5, $6, $7)`,
        [id, itemId, name, name, fields.seedKey, fields.userId, fields.userId === null ? 'public' : 'private'],
    );

    return id;
}

/**
 * Write a nutrition header for one owner.
 *
 * @param client - The writer.
 * @param owner - The root or the variant.
 * @returns The header's id.
 * @sideEffect Inserts into `food_nutrition`.
 */
export async function insertHeader(
    client: pg.ClientBase,
    owner: { readonly foodId: string } | { readonly variantId: string },
): Promise<string> {
    const id = newId('nutrition');

    await client.query('INSERT INTO food_nutrition (id, food_id, food_variant_id) VALUES ($1, $2, $3)', [
        id,
        'foodId' in owner ? owner.foodId : null,
        'variantId' in owner ? owner.variantId : null,
    ]);

    return id;
}

/**
 * Write a source-item citation on a header.
 *
 * @param client - The writer.
 * @param nutritionId - The header.
 * @returns The citation's id.
 * @sideEffect Inserts into `food_nutrition_citation`.
 */
export async function insertCitation(client: pg.ClientBase, nutritionId: string): Promise<string> {
    const id = newId('citation');

    await client.query(
        `INSERT INTO food_nutrition_citation (id, nutrition_id, dataset, external_key, match)
         VALUES ($1, $2, 'usdaSrFoundation', $3, 'exact')`,
        [id, nutritionId, String(nextNumber())],
    );

    return id;
}

/**
 * Write a dictionary nutrient.
 *
 * @param client - The writer.
 * @returns Its id.
 * @sideEffect Inserts into `nutrient`.
 */
export async function insertNutrient(client: pg.ClientBase): Promise<string> {
    const id = newId('nutrient');

    await client.query('INSERT INTO nutrient (id, name, unit) VALUES ($1, $2, $3)', [id, `World ${id}`, 'g']);

    return id;
}

/**
 * Write one world of the given kind.
 *
 * @param client - The writer, normally the owner.
 * @param kind - Seed-owned or authored.
 * @returns The ids.
 * @sideEffect Inserts one row or more into every catalog table and both dictionaries.
 */
export function makeCatalogWorld(client: pg.ClientBase, kind: 'seed'): Promise<SeedWorld>;

export function makeCatalogWorld(client: pg.ClientBase, kind: 'authored'): Promise<AuthoredWorld>;

export async function makeCatalogWorld(client: pg.ClientBase, kind: CatalogWorldKind): Promise<CatalogWorld> {
    const author = kind === 'seed' ? null : WORLD_AUTHOR;
    const item = await insertItem(client, naturalKey(kind), 'root');
    const root = await insertRoot(client, item, {
        seedKey: kind === 'seed' ? `curated:world-${nextNumber()}` : null,
        userId: author,
    });
    const variantItem = await insertItem(client, naturalKey(kind), 'variant');
    const variant = kind === 'seed' ? await insertVariant(client, root, variantItem) : undefined;
    const spareRootItem = await insertItem(client, naturalKey(kind), 'root');
    const spareVariantItem = await insertItem(client, naturalKey(kind), 'variant');
    const root2Item = await insertItem(client, naturalKey(kind), 'root');
    const root2 = await insertRoot(client, root2Item, {
        seedKey: kind === 'seed' ? `fdc:${nextNumber()}` : null,
        userId: author,
    });
    const bareRoot = await insertRoot(client, await insertItem(client, naturalKey(kind), 'root'), {
        seedKey: kind === 'seed' ? `fdc:${nextNumber()}` : null,
        userId: author,
    });
    const source = newId('source');
    const source2 = newId('source');

    await client.query(
        "INSERT INTO food_sources (id, item_id, source, external_key) VALUES ($1, $2, 'usda', $3), ($4, $2, 'usda', $5)",
        [source, item, String(nextNumber()), source2, String(nextNumber())],
    );
    await client.query("INSERT INTO food_field_provenance (item_id, field, source_id) VALUES ($1, 'name', $2)", [
        item,
        source,
    ]);

    const category = newId('category');
    const category2 = newId('category');

    await client.query('INSERT INTO food_category (id, name) VALUES ($1, $1), ($2, $2)', [category, category2]);
    await client.query('INSERT INTO food_category_assignment (item_id, category_id, source_id) VALUES ($1, $2, $3)', [
        item,
        category,
        source,
    ]);

    const nutrient = await insertNutrient(client);
    const nutrient2 = await insertNutrient(client);
    const nutrition = await insertHeader(client, { foodId: root });
    const citation = await insertCitation(client, nutrition);
    const citation2 = await insertCitation(client, nutrition);

    await client.query(
        "INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis, citation_id) VALUES ($1, $2, 10, 'per_100g', $3)",
        [nutrition, nutrient, citation],
    );

    const root2Nutrition = await insertHeader(client, { foodId: root2 });
    const root2Citation = await insertCitation(client, root2Nutrition);

    await client.query(
        "INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis, citation_id) VALUES ($1, $2, 3, 'per_100g', $3)",
        [root2Nutrition, nutrient, root2Citation],
    );

    const portion = newId('portion');

    await client.query(
        'INSERT INTO food_portions (id, item_id, label, gram_weight, source_id) VALUES ($1, $2, $3, 240, $4)',
        [portion, item, 'cup', source],
    );

    const rows: CatalogWorldRows = {
        item,
        root,
        variantItem,
        spareRootItem,
        spareVariantItem,
        root2,
        bareRoot,
        source,
        source2,
        category,
        category2,
        nutrition,
        citation,
        citation2,
        nutrient,
        nutrient2,
        portion,
    };

    return variant === undefined ? { ...rows, kind: 'authored' } : { ...rows, kind: 'seed', variant };
}

/**
 * Write a variant of a root, with one part.
 *
 * @param client - The writer.
 * @param root - The root.
 * @param itemId - The variant's own item.
 * @returns The variant's id.
 * @sideEffect Inserts into `food_variant` and `food_variant_part`.
 */
async function insertVariant(client: pg.ClientBase, root: string, itemId: string): Promise<string> {
    const id = newId('variant');

    await client.query('INSERT INTO food_variant (id, food_id, item_id) VALUES ($1, $2, $3)', [id, root, itemId]);
    await client.query(
        "INSERT INTO food_variant_part (variant_id, attribute, ordinal, text) VALUES ($1, 'cut', 0, 'flat')",
        [id],
    );

    return id;
}
