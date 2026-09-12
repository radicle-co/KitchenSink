/**
 * A catalog food row for the real-database suites, with the item it owns (curated catalog plan U4, KTD-6).
 *
 * Since 0018 every root owns exactly one `food_item`, so a raw `INSERT INTO food` must mint the item first. The
 * factory writes both in one statement, as the service's own add-by-name does, so a suite never holds a food with no
 * item or an item with no owner. The item is live (no natural key), so the service role may write both.
 *
 * {@link makeSeededRoot} writes the other shape: a seed-owned root with its variants, as the seed writes one.
 *
 * @pattern Object Mother — one live catalog food, or one seeded root with its variants, per call
 */
import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import { newFoodId } from '../../src/db/ulid.js';
import type { VariantAttribute } from '../../src/foods/domain/variantAttribute.js';
import { ALIAS_DELIMITER } from '../../src/foods/foodAliases.js';
import { NUTRIENT_DEFINITIONS, type NutrientDefinitionKey } from '../../src/foods/nutrition/nutrientIdentity.js';

/** The subset of a pg client the factory needs: a pool, a client or a pool client. */
export interface Queryable {
    query(sql: string, params?: unknown[]): Promise<unknown>;
}

/** The `food` columns a suite sets. */
export interface CatalogFoodFields {
    readonly id: string;
    readonly name: string | null;
    readonly normalizedName: string;
    readonly description: string | null;
    readonly status: string;
    readonly kind: 'generic' | 'branded';
    readonly userId: string | null;
    readonly visibility: 'public' | 'private' | 'promoted';
    readonly tombstonedAt: Date | null;
    readonly aliases: string | null;
}

/**
 * Write one food and the item it owns.
 *
 * @param client - The writer, normally the service role's pool.
 * @param fields - Overrides; `normalizedName` defaults to the lowercased name, and an authored food (a `userId`) is
 *   private unless stated.
 * @returns The food's id and its item's id.
 * @sideEffect Inserts one `food_item` row and one `food` row.
 */
export async function makeCatalogFood(
    client: Queryable,
    fields: Partial<CatalogFoodFields> = {},
): Promise<{ readonly id: string; readonly itemId: string }> {
    const id = fields.id ?? `food-${randomUUID()}`;
    const itemId = `item-${id}`;
    const name = fields.name === undefined ? `catalog food ${id}` : fields.name;
    const userId = fields.userId ?? null;

    await client.query(
        `WITH item AS (INSERT INTO food_item (id, owner_kind) VALUES ($1, 'root') RETURNING id)
         INSERT INTO food (id, item_id, name, normalized_name, description, status, kind, user_id, visibility,
                           tombstoned_at, aliases)
         SELECT $2, item.id, $3, $4, $5, $6::food_status, $7::food_kind, $8, $9, $10, $11 FROM item`,
        [
            itemId,
            id,
            name,
            fields.normalizedName ?? (name ?? id).trim().toLowerCase(),
            fields.description ?? null,
            fields.status ?? 'RESOLVED',
            fields.kind ?? 'generic',
            userId,
            fields.visibility ?? (userId === null ? 'public' : 'private'),
            fields.tombstonedAt ?? null,
            fields.aliases ?? null,
        ],
    );

    return { id, itemId };
}

/** One stored value on a seeded owner: a definition's number, or `null` for a trace mark. */
export interface SeededValue {
    readonly key: NutrientDefinitionKey;
    readonly amount: number | null;
    readonly basis?: 'per_100g' | 'per_serving';
}

/** One part of a seeded variant's label. */
export interface SeededPart {
    readonly attribute: VariantAttribute;
    readonly text: string;
    readonly ordinal?: number;
}

/** A variant of a seeded root: its parts, its own nutrition, and its item's popularity weight. */
export interface SeededVariantSpec {
    readonly parts: readonly SeededPart[];
    readonly values?: readonly SeededValue[];
    /** `food_popularity.consumption_weight` of the variant's item; no row when absent. */
    readonly weight?: number;
    readonly retired?: boolean;
    /** A `usda` source row on the variant's item, keyed as the adapter spells it (bare, never `fdc:`). */
    readonly sourceKey?: string;
}

/** A seed-owned root, as the seed writes one (KTD-6, KTD-19). */
export interface SeededRootSpec {
    readonly name: string;
    /** The root's synonyms, stored in `food.aliases`. */
    readonly synonyms?: readonly string[];
    /** The root's own nutrition; no header when absent (GR-019). */
    readonly values?: readonly SeededValue[];
    readonly weight?: number;
    readonly retired?: boolean;
    readonly variants?: readonly SeededVariantSpec[];
    /** A `usda` source row on the root's item, keyed as the adapter spells it (bare, never `fdc:`). */
    readonly sourceKey?: string;
    /** The root's citation key and match, when it cites an item other than its own (a stand-in). */
    readonly citation?: { readonly key: string; readonly match: 'exact' | 'sameSubstance' | 'close' | 'generic' };
    /** The root's seed key; derived from the name and the item when absent. */
    readonly seedKey?: string;
}

/** The ids a seeded root's suite asserts on. */
export interface SeededRoot {
    readonly id: string;
    readonly itemId: string;
    /** The root's citation key, when it has nutrition — the positive control for SC-013. */
    readonly citationKey: string | null;
    readonly variants: readonly { readonly id: string; readonly itemId: string; readonly citationKey: string | null }[];
}

/** A database handle that can run work as the schema owner, whom `catalog_guard` admits. */
export interface OwnerScoped {
    asOwner<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T>;
}

let seededSequence = Math.floor(Date.now() % 1_000_000) * 100;

/**
 * A fresh FDC-shaped number, unique across a run.
 *
 * @returns The number.
 * @sideEffect Advances a module counter.
 */
function nextFdcNumber(): number {
    seededSequence += 1;

    return seededSequence;
}

/**
 * Write one seed-owned item and, when given, its popularity weight.
 *
 * @param client - The owner's client.
 * @param ownerKind - `root` or `variant`.
 * @param weight - The consumption weight, if any.
 * @returns The item's id and its FDC number.
 * @sideEffect Inserts into `food_item` and maybe `food_popularity`.
 */
async function insertSeededItem(
    client: pg.PoolClient,
    ownerKind: 'root' | 'variant',
    weight: number | undefined,
): Promise<{ readonly id: string; readonly fdc: number }> {
    const fdc = nextFdcNumber();
    const id = `item-${randomUUID()}`;

    await client.query('INSERT INTO food_item (id, natural_key, owner_kind) VALUES ($1, $2, $3)', [
        id,
        `fdc:${fdc}`,
        ownerKind,
    ]);

    if (weight !== undefined) {
        await client.query(
            "INSERT INTO food_popularity (item_id, consumption_weight, prior_fraction, source) VALUES ($1, $2, 0, 'fixture')",
            [id, weight],
        );
    }

    return { id, fdc };
}

/**
 * Write a `usda` source row on an item, when a key is given.
 *
 * @param client - The owner's client.
 * @param itemId - The item.
 * @param key - The key, as the adapter spells it.
 * @sideEffect Inserts into `food_sources`.
 */
async function insertSourceRow(client: pg.PoolClient, itemId: string, key: string | undefined): Promise<void> {
    if (key === undefined) {
        return;
    }

    await client.query("INSERT INTO food_sources (id, item_id, source, external_key) VALUES ($1, $2, 'usda', $3)", [
        `source-${randomUUID()}`,
        itemId,
        key,
    ]);
}

/**
 * Write one owner's nutrition header, its citation and its values.
 *
 * @param client - The owner's client.
 * @param owner - The root or the variant.
 * @param values - The values; nothing is written when empty.
 * @param citation - The cited key, as the adapter spells it, and its match.
 * @returns The citation's key, or `null` when nothing was written.
 * @sideEffect Inserts into `nutrient`, `food_nutrition`, `food_nutrition_citation` and `food_nutrition_value`.
 */
async function insertSeededNutrition(
    client: pg.PoolClient,
    owner: { readonly foodId: string } | { readonly variantId: string },
    values: readonly SeededValue[],
    citation: { readonly key: string; readonly match: string },
): Promise<string | null> {
    if (values.length === 0) {
        return null;
    }

    const nutritionId = `nutrition-${randomUUID()}`;
    const citationId = `citation-${randomUUID()}`;
    const citationKey = citation.key;

    await client.query('INSERT INTO food_nutrition (id, food_id, food_variant_id) VALUES ($1, $2, $3)', [
        nutritionId,
        'foodId' in owner ? owner.foodId : null,
        'variantId' in owner ? owner.variantId : null,
    ]);
    await client.query(
        `INSERT INTO food_nutrition_citation (id, nutrition_id, dataset, external_key, match)
         VALUES ($1, $2, 'usdaSrFoundation', $3, $4::citation_match)`,
        [citationId, nutritionId, citationKey, citation.match],
    );

    for (const value of values) {
        const definition = NUTRIENT_DEFINITIONS[value.key];

        // The dictionary is shared, and its entries carry their tag as `NutrientDao` writes them (KTD-23).
        await client.query(
            'INSERT INTO nutrient (id, name, unit, infoods_tag) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
            [`nutrient-${randomUUID()}`, definition.name, definition.unit, definition.tag],
        );
        await client.query(
            `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, trace, basis, citation_id)
             SELECT $1, n.id, $2, $3, $4::nutrient_basis, $5 FROM nutrient n WHERE n.name = $6 AND n.unit = $7`,
            [
                nutritionId,
                value.amount,
                value.amount === null,
                value.basis ?? 'per_100g',
                citationId,
                definition.name,
                definition.unit,
            ],
        );
    }

    return citationKey;
}

/**
 * Write one seed-owned root with its variants, as the seed does: every item keyed `fdc:<n>`, the root keyed
 * `curated:<slug>`, each owner's nutrition cited from its own item.
 *
 * Writes as the schema owner, whom `catalog_guard` admits; the service role may not write a seed-owned row (R47).
 *
 * @param db - The database handle.
 * @param spec - The root.
 * @returns The ids.
 * @sideEffect Inserts the root, its variants, their parts, items, weights and nutrition.
 */
export async function makeSeededRoot(db: OwnerScoped, spec: SeededRootSpec): Promise<SeededRoot> {
    return db.asOwner(async (client) => {
        const item = await insertSeededItem(client, 'root', spec.weight);
        const id = newFoodId();

        await client.query(
            `INSERT INTO food (id, item_id, name, normalized_name, status, seed_key, aliases, visibility, retired_at)
             VALUES ($1, $2, $3, $4, 'RESOLVED', $5, $6, 'public', $7)`,
            [
                id,
                item.id,
                spec.name,
                spec.name.toLowerCase(),
                // The seed-key CHECK admits `curated:` + lowercase alphanumerics in hyphen-joined runs.
                spec.seedKey ??
                    `curated:${spec.name
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-|-$/g, '')}-${item.fdc}`,
                spec.synonyms === undefined ? null : spec.synonyms.join(ALIAS_DELIMITER),
                spec.retired === true ? new Date() : null,
            ],
        );

        await insertSourceRow(client, item.id, spec.sourceKey);

        const citationKey = await insertSeededNutrition(
            client,
            { foodId: id },
            spec.values ?? (spec.citation === undefined ? [] : [{ key: 'energyKcal', amount: 100 }]),
            spec.citation ?? { key: String(item.fdc), match: 'exact' },
        );
        const variants: { id: string; itemId: string; citationKey: string | null }[] = [];

        for (const variant of spec.variants ?? []) {
            const variantItem = await insertSeededItem(client, 'variant', variant.weight);
            const variantId = newFoodId();

            await client.query('INSERT INTO food_variant (id, food_id, item_id, retired_at) VALUES ($1, $2, $3, $4)', [
                variantId,
                id,
                variantItem.id,
                variant.retired === true ? new Date() : null,
            ]);

            await insertSourceRow(client, variantItem.id, variant.sourceKey);

            for (const part of variant.parts) {
                await client.query(
                    'INSERT INTO food_variant_part (variant_id, attribute, ordinal, text) VALUES ($1, $2, $3, $4)',
                    [variantId, part.attribute, part.ordinal ?? 0, part.text],
                );
            }

            variants.push({
                id: variantId,
                itemId: variantItem.id,
                citationKey: await insertSeededNutrition(
                    client,
                    { variantId },
                    variant.values ?? [{ key: 'energyKcal', amount: 100 }],
                    { key: String(variantItem.fdc), match: 'exact' },
                ),
            });
        }

        return { id, itemId: item.id, citationKey, variants };
    });
}
