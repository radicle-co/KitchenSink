/**
 * Reads a seeded catalog into the `CatalogSnapshot` port (curated catalog plan U5, KTD-8, KTD-11, KTD-12, KTD-19).
 *
 * @pattern Adapter — the database side of the `CatalogSnapshotSource` port; `seedProjection.ts` is the other side, so the
 *   deploy and the CI diff plan against one shape
 *
 * It reads on the ONE connection its caller passes, inside the caller's transaction, and never opens or ends one: the
 * seed reads, plans and writes in a single transaction (U6). The type admits a client, never a pool, because a pool
 * runs each statement on whichever connection is free, outside that transaction.
 *
 * A seed row is a root with a `seed_key`, or a variant whose item has a natural key; its per-item rows are read through
 * that item. Field provenance is not read: the applier derives it, and the port does not carry it.
 *
 * Two layers: one Drizzle select per table gives typed rows, and the pure {@link assembleSnapshot} maps them by natural
 * key, spelling every decimal and ordering every list as the port defines. A stored shape the port cannot hold (a header
 * with two citations, a variant with no header, a per-serving value) is refused with every issue, never dropped,
 * because a dropped row is one the plan would then never touch.
 */
import { and, asc, eq, inArray, isNotNull, isNull, not, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { alias } from 'drizzle-orm/pg-core';
import type pg from 'pg';

import {
    foodCategoryAssignment,
    foodForward,
    foodItem,
    foodPopularity,
    foodPortions,
    foodSources,
    foodVariant,
    foodVariantPart,
} from '../../../db/schema/catalogItems.js';
import { food, foodCategory, nutrient } from '../../../db/schema/food.js';
import { foodNutrition, foodNutritionCitation, foodNutritionValue } from '../../../db/schema/foodNutrition.js';
import type { VariantAttribute } from '../../domain/variantAttribute.js';
import { ALIAS_DELIMITER } from '../../foodAliases.js';
import { isSeedKey, type ItemKey, type SeedKey } from '../catalogKey.js';
import type { CitationDataset } from '../citationDatasets.js';
import type { CitationMatch } from './citationPrecedence.js';
import { CatalogSnapshotUnreadableError, type CatalogSnapshotIssue } from './catalogSnapshot.errors.js';
import {
    canonicalDecimal,
    compareCategories,
    comparePortions,
    compareText,
    sourceRefKey,
    type CatalogSnapshot,
    type CatalogSnapshotSource,
    type ContentCategory,
    type ContentCitation,
    type ContentItem,
    type ContentNutrition,
    type ContentPortion,
    type ContentRoot,
    type ContentSource,
    type ContentValue,
    type ContentVariant,
    type OwnerKind,
    type SnapshotForward,
} from './catalogSnapshot.js';

/** The rows one read returns, one list per table, already scoped to seed rows where the port asks for them. */
export interface SnapshotRows {
    /** Every item with a natural key, owned or not. */
    readonly items: readonly { readonly id: string; readonly naturalKey: string }[];
    /** Every root with a seed key, and its item's natural key. */
    readonly roots: readonly {
        readonly id: string;
        readonly seedKey: string;
        readonly name: string | null;
        readonly aliases: string | null;
        readonly retired: boolean;
        readonly itemKey: string | null;
    }[];
    /** Every variant whose item has a natural key, and its root's seed key. */
    readonly variants: readonly {
        readonly id: string;
        readonly itemKey: string;
        readonly rootSeedKey: string | null;
        readonly retired: boolean;
    }[];
    /** The parts of those variants, in `(variant, attribute, ordinal)` order: enum order is declaration order. */
    readonly parts: readonly {
        readonly variantId: string;
        readonly attribute: VariantAttribute;
        readonly ordinal: number;
        readonly text: string;
    }[];
    /** The source rows of seed items. */
    readonly sources: readonly {
        readonly id: string;
        readonly itemKey: string;
        readonly source: ContentSource['source'];
        readonly externalKey: string;
    }[];
    /** The portions of seed items. */
    readonly portions: readonly {
        readonly itemKey: string;
        readonly label: string;
        readonly gramWeight: string;
        readonly sourceId: string | null;
        readonly citationId: string | null;
    }[];
    /** The category assignments of seed items, by dictionary name. */
    readonly categories: readonly {
        readonly itemKey: string;
        readonly name: string;
        readonly sourceId: string | null;
    }[];
    /** The popularity rows of seed items. */
    readonly popularity: readonly {
        readonly itemKey: string;
        readonly weight: string;
        readonly priorFraction: string;
        readonly source: string;
    }[];
    /** The nutrition headers of seed roots and seed variants. */
    readonly headers: readonly {
        readonly id: string;
        readonly foodId: string | null;
        readonly variantId: string | null;
    }[];
    /** The citations under those headers. */
    readonly citations: readonly {
        readonly id: string;
        readonly nutritionId: string;
        readonly dataset: CitationDataset;
        readonly externalKey: string | null;
        readonly match: CitationMatch | null;
        readonly densityGPerMl: string | null;
        readonly kcalFromKj: boolean;
        readonly url: string | null;
        readonly retrievedOn: string | null;
        readonly manufacturer: string | null;
        readonly servingLabel: string | null;
        readonly servingGrams: string | null;
    }[];
    /** The values under those headers, named by their dictionary entry. */
    readonly values: readonly {
        readonly nutritionId: string;
        readonly name: string;
        readonly unit: string;
        readonly amount: string | null;
        readonly basis: 'per_100g' | 'per_serving';
    }[];
    /** Every forward. */
    readonly forwards: readonly {
        readonly sourceId: string;
        readonly sourceKind: OwnerKind;
        readonly sourceKey: string | null;
        readonly targetFoodId: string | null;
        readonly targetVariantId: string | null;
    }[];
    /** Live catalog roots that are neither seed-owned nor authored (KTD-12's exception), by normalized name. */
    readonly liveNames: readonly { readonly id: string; readonly normalizedName: string }[];
    /** The source rows of every item that is not seed-owned (Q1). */
    readonly liveSources: readonly { readonly source: ContentSource['source']; readonly externalKey: string }[];
}

/** A mutable content, filled one bucket at a time. */
interface ContentBuilder {
    readonly roots: Map<SeedKey, ContentRoot>;
    readonly variants: Map<ItemKey, ContentVariant>;
    readonly items: Map<ItemKey, ContentItem>;
}

/**
 * Order source rows by source, then key, as the projection does. Pure.
 *
 * @param left - A source row.
 * @param right - A source row.
 * @returns Negative, zero or positive.
 */
function compareSources(left: ContentSource, right: ContentSource): number {
    return compareText(left.source, right.source) || compareText(left.externalKey, right.externalKey);
}

/**
 * Group rows by a key, keeping each group in row order. Pure.
 *
 * @param rows - The rows.
 * @param keyOf - Each row's key.
 * @returns The groups.
 */
function groupBy<Row>(rows: readonly Row[], keyOf: (row: Row) => string): ReadonlyMap<string, readonly Row[]> {
    const groups = new Map<string, Row[]>();

    for (const row of rows) {
        const key = keyOf(row);
        const group = groups.get(key);

        if (group === undefined) {
            groups.set(key, [row]);
        } else {
            group.push(row);
        }
    }

    return groups;
}

/**
 * A stored citation as the port spells it, or `undefined` when its columns break the shape 0018's CHECKs give it.
 * Pure.
 *
 * @param row - The citation row.
 * @returns The citation.
 */
function citationOf(row: SnapshotRows['citations'][number]): ContentCitation | undefined {
    if (row.dataset === 'label') {
        const { url, retrievedOn, manufacturer, servingLabel, servingGrams } = row;

        if (url === null || retrievedOn === null || manufacturer === null || servingLabel === null) {
            return undefined;
        }

        if (servingGrams === null) {
            return undefined;
        }

        return {
            dataset: 'label',
            url,
            retrievedOn,
            manufacturer,
            servingLabel,
            servingGrams: canonicalDecimal(servingGrams),
        };
    }

    if (row.externalKey === null || row.match === null) {
        return undefined;
    }

    return {
        dataset: row.dataset,
        externalKey: row.externalKey,
        match: row.match,
        densityGPerMl: row.densityGPerMl === null ? null : canonicalDecimal(row.densityGPerMl),
        kcalFromKj: row.kcalFromKj,
    };
}

/** The rows indexed for assembly. */
interface Indexed {
    readonly rows: SnapshotRows;
    readonly headerByFood: ReadonlyMap<string, string>;
    readonly headerByVariant: ReadonlyMap<string, string>;
    readonly citationsByHeader: ReadonlyMap<string, readonly SnapshotRows['citations'][number][]>;
    readonly valuesByHeader: ReadonlyMap<string, readonly SnapshotRows['values'][number][]>;
    readonly citationById: ReadonlyMap<string, SnapshotRows['citations'][number]>;
    /** The natural key of the item whose owner holds each header. */
    readonly itemKeyByHeader: ReadonlyMap<string, string>;
    readonly sourceById: ReadonlyMap<string, SnapshotRows['sources'][number]>;
    readonly sourcesByItem: ReadonlyMap<string, readonly SnapshotRows['sources'][number][]>;
    readonly portionsByItem: ReadonlyMap<string, readonly SnapshotRows['portions'][number][]>;
    readonly categoriesByItem: ReadonlyMap<string, readonly SnapshotRows['categories'][number][]>;
    readonly popularityByItem: ReadonlyMap<string, SnapshotRows['popularity'][number]>;
    readonly partsByVariant: ReadonlyMap<string, readonly SnapshotRows['parts'][number][]>;
    readonly issues: CatalogSnapshotIssue[];
}

/**
 * A header's nutrition, or `undefined` after recording why the port cannot hold it.
 *
 * @param indexed - The indexed rows.
 * @param headerId - The header.
 * @returns The nutrition.
 * @sideEffect Appends each issue found to `indexed.issues`.
 */
function nutritionOf(indexed: Indexed, headerId: string): ContentNutrition | undefined {
    const citations = indexed.citationsByHeader.get(headerId) ?? [];
    const [row] = citations;

    if (citations.length !== 1 || row === undefined) {
        indexed.issues.push({ where: headerId, rule: 'citationCount' });

        return undefined;
    }

    const citation = citationOf(row);

    if (citation === undefined) {
        indexed.issues.push({ where: row.id, rule: 'citationShape' });

        return undefined;
    }

    const values: ContentValue[] = [];

    for (const value of indexed.valuesByHeader.get(headerId) ?? []) {
        if (value.basis !== 'per_100g') {
            indexed.issues.push({ where: headerId, rule: 'valueNotPer100g' });
        }

        values.push({
            name: value.name,
            unit: value.unit,
            amount: value.amount === null ? null : canonicalDecimal(value.amount),
        });
    }

    return {
        citation,
        values: values.sort((left, right) => compareText(left.name, right.name) || compareText(left.unit, right.unit)),
    };
}

/**
 * An item's per-item rows as the port holds them.
 *
 * @param indexed - The indexed rows.
 * @param key - The item's natural key.
 * @returns The item.
 * @sideEffect Appends each issue found to `indexed.issues`.
 */
function itemOf(indexed: Indexed, key: ItemKey): ContentItem {
    const sources = (indexed.sourcesByItem.get(key) ?? []).map((row): ContentSource => ({
        source: row.source,
        externalKey: row.externalKey,
    }));
    const portions: ContentPortion[] = [];

    for (const row of indexed.portionsByItem.get(key) ?? []) {
        const gramWeight = canonicalDecimal(row.gramWeight);

        if (row.citationId !== null) {
            // A cited portion cites its OWN owner's citation: one citing another owner's would compare equal, so no
            // plan would repair it, and that owner's rewrite would cascade it away.
            const cited = indexed.citationById.get(row.citationId);
            const citation =
                cited === undefined || indexed.itemKeyByHeader.get(cited.nutritionId) !== key
                    ? undefined
                    : citationOf(cited);

            if (citation === undefined) {
                indexed.issues.push({ where: key, rule: 'portionCitationUnknown' });
                continue;
            }

            portions.push({ label: row.label, gramWeight, citation });
            continue;
        }

        if (row.sourceId === null) {
            indexed.issues.push({ where: key, rule: 'portionWithoutProvenance' });
            continue;
        }

        const source = indexed.sourceById.get(row.sourceId);

        if (source === undefined) {
            indexed.issues.push({ where: key, rule: 'portionSourceUnknown' });
            continue;
        }

        portions.push({
            label: row.label,
            gramWeight,
            source: { source: source.source, externalKey: source.externalKey },
        });
    }

    const categories: ContentCategory[] = [];

    for (const row of indexed.categoriesByItem.get(key) ?? []) {
        const source = row.sourceId === null ? null : indexed.sourceById.get(row.sourceId);

        if (source === undefined || (source !== null && source.itemKey !== key)) {
            indexed.issues.push({ where: key, rule: 'categorySourceUnknown' });
            continue;
        }

        categories.push({
            name: row.name,
            source: source === null ? null : { source: source.source, externalKey: source.externalKey },
        });
    }

    const popularity = indexed.popularityByItem.get(key);

    return {
        key,
        sources: sources.sort(compareSources),
        portions: portions.sort(comparePortions),
        categories: categories.sort(compareCategories),
        popularity:
            popularity === undefined
                ? null
                : {
                      weight: canonicalDecimal(popularity.weight),
                      priorFraction: canonicalDecimal(popularity.priorFraction),
                      source: popularity.source,
                  },
    };
}

/**
 * Index the rows for assembly. Pure.
 *
 * @param rows - The rows.
 * @returns The indexes, with an empty issue list.
 */
function indexRows(rows: SnapshotRows): Indexed {
    const single = <Row>(list: readonly Row[], keyOf: (row: Row) => string): ReadonlyMap<string, Row> =>
        new Map(list.map((row) => [keyOf(row), row]));
    const rootItemKey = new Map(rows.roots.map((row) => [row.id, row.itemKey]));
    const variantItemKey = new Map(rows.variants.map((row) => [row.id, row.itemKey]));

    return {
        rows,
        headerByFood: new Map(rows.headers.flatMap((row) => (row.foodId === null ? [] : [[row.foodId, row.id]]))),
        headerByVariant: new Map(
            rows.headers.flatMap((row) => (row.variantId === null ? [] : [[row.variantId, row.id]])),
        ),
        citationsByHeader: groupBy(rows.citations, (row) => row.nutritionId),
        valuesByHeader: groupBy(rows.values, (row) => row.nutritionId),
        citationById: single(rows.citations, (row) => row.id),
        itemKeyByHeader: new Map(
            rows.headers.flatMap((row) => {
                const itemKey =
                    row.foodId !== null ? rootItemKey.get(row.foodId) : variantItemKey.get(row.variantId ?? '');

                return itemKey === undefined || itemKey === null ? [] : [[row.id, itemKey]];
            }),
        ),
        sourceById: single(rows.sources, (row) => row.id),
        sourcesByItem: groupBy(rows.sources, (row) => row.itemKey),
        portionsByItem: groupBy(rows.portions, (row) => row.itemKey),
        categoriesByItem: groupBy(rows.categories, (row) => row.itemKey),
        popularityByItem: single(rows.popularity, (row) => row.itemKey),
        partsByVariant: groupBy(rows.parts, (row) => row.variantId),
        issues: [],
    };
}

/**
 * Map stored rows to the port, by natural key. Pure.
 *
 * @param rows - One read's rows.
 * @returns The snapshot.
 * @throws {CatalogSnapshotUnreadableError} when a stored shape cannot be held by the port, with every issue.
 */
export function assembleSnapshot(rows: SnapshotRows): CatalogSnapshot {
    const indexed = indexRows(rows);
    const { issues } = indexed;
    const live: ContentBuilder = { roots: new Map(), variants: new Map(), items: new Map() };
    const retired: ContentBuilder = { roots: new Map(), variants: new Map(), items: new Map() };
    const rootIds = new Map<SeedKey, string>();
    const variantIds = new Map<ItemKey, string>();

    for (const row of rows.roots) {
        const { seedKey, itemKey, name } = row;

        if (!isSeedKey(seedKey) || !isSeedKey(itemKey)) {
            issues.push({ where: row.id, rule: 'ownerItemUnkeyed' });
            continue;
        }

        if (name === null) {
            issues.push({ where: seedKey, rule: 'rootWithoutName' });
            continue;
        }

        const header = indexed.headerByFood.get(row.id);
        const nutrition = header === undefined ? null : nutritionOf(indexed, header);
        const bucket = row.retired ? retired : live;

        rootIds.set(seedKey, row.id);
        bucket.roots.set(seedKey, {
            seedKey,
            name,
            synonyms: row.aliases === null ? [] : row.aliases.split(ALIAS_DELIMITER),
            item: itemKey,
            nutrition: nutrition ?? null,
        });
        bucket.items.set(itemKey, itemOf(indexed, itemKey));
    }

    for (const row of rows.variants) {
        const { itemKey, rootSeedKey } = row;

        if (!isSeedKey(itemKey)) {
            issues.push({ where: row.id, rule: 'ownerItemUnkeyed' });
            continue;
        }

        if (!isSeedKey(rootSeedKey)) {
            issues.push({ where: itemKey, rule: 'variantWithoutRoot' });
            continue;
        }

        const header = indexed.headerByVariant.get(row.id);

        if (header === undefined) {
            issues.push({ where: itemKey, rule: 'variantWithoutNutrition' });
            continue;
        }

        const nutrition = nutritionOf(indexed, header);
        const bucket = row.retired ? retired : live;

        variantIds.set(itemKey, row.id);

        if (nutrition !== undefined) {
            bucket.variants.set(itemKey, {
                item: itemKey,
                root: rootSeedKey,
                parts: (indexed.partsByVariant.get(row.id) ?? []).map((part) => ({
                    attribute: part.attribute,
                    text: part.text,
                })),
                nutrition,
            });
        }

        bucket.items.set(itemKey, itemOf(indexed, itemKey));
    }

    const forwards: SnapshotForward[] = [];

    for (const row of rows.forwards) {
        const target =
            row.targetFoodId !== null
                ? { kind: 'root' as const, id: row.targetFoodId }
                : row.targetVariantId === null
                  ? undefined
                  : { kind: 'variant' as const, id: row.targetVariantId };

        if (target === undefined) {
            issues.push({ where: row.sourceId, rule: 'forwardWithoutTarget' });
            continue;
        }

        forwards.push({ sourceId: row.sourceId, sourceKind: row.sourceKind, sourceKey: row.sourceKey, target });
    }

    if (issues.length > 0) {
        throw new CatalogSnapshotUnreadableError(issues);
    }

    const itemIds = new Map<ItemKey, string>(
        rows.items.flatMap((row) => (isSeedKey(row.naturalKey) ? [[row.naturalKey, row.id] as const] : [])),
    );

    return {
        content: live,
        retired,
        ids: { roots: rootIds, variants: variantIds, items: itemIds },
        forwards,
        liveNames: new Map(rows.liveNames.map((row) => [row.normalizedName, row.id])),
        liveSourceKeys: new Set(rows.liveSources.map((row) => sourceRefKey(row))),
    };
}

/** Reads the catalog through the caller's connection. */
export class CatalogSnapshotDao implements CatalogSnapshotSource {
    /**
     * @param client - The ONE connection the caller's transaction is open on; never a pool.
     */
    public constructor(private readonly client: pg.PoolClient | pg.Client) {}

    /**
     * Read the snapshot inside the caller's transaction.
     *
     * @returns The snapshot.
     * @throws {CatalogSnapshotUnreadableError} when the catalog holds a shape the port cannot represent.
     * @sideEffect Reads the catalog tables on the caller's connection; opens, commits and ends nothing.
     */
    public async read(): Promise<CatalogSnapshot> {
        return assembleSnapshot(await this.readRows());
    }

    /**
     * One select per table, scoped to seed rows where the port asks for them.
     *
     * @returns The rows.
     * @sideEffect Reads the catalog tables.
     */
    private async readRows(): Promise<SnapshotRows> {
        const db = drizzle(this.client);
        const seedItem = isNotNull(foodItem.naturalKey);
        const variantItem = alias(foodItem, 'variant_item');
        const seedHeaders = db
            .select({ id: foodNutrition.id })
            .from(foodNutrition)
            .leftJoin(food, eq(food.id, foodNutrition.foodId))
            .leftJoin(foodVariant, eq(foodVariant.id, foodNutrition.foodVariantId))
            .leftJoin(variantItem, eq(variantItem.id, foodVariant.itemId))
            .where(or(isNotNull(food.seedKey), isNotNull(variantItem.naturalKey)));

        const items = await db
            .select({ id: foodItem.id, naturalKey: foodItem.naturalKey })
            .from(foodItem)
            .where(seedItem);
        const roots = await db
            .select({
                id: food.id,
                seedKey: food.seedKey,
                name: food.name,
                aliases: food.aliases,
                retiredAt: food.retiredAt,
                itemKey: foodItem.naturalKey,
            })
            .from(food)
            .leftJoin(foodItem, eq(foodItem.id, food.itemId))
            .where(isNotNull(food.seedKey));
        const variants = await db
            .select({
                id: foodVariant.id,
                itemKey: foodItem.naturalKey,
                rootSeedKey: food.seedKey,
                retiredAt: foodVariant.retiredAt,
            })
            .from(foodVariant)
            .innerJoin(foodItem, eq(foodItem.id, foodVariant.itemId))
            .leftJoin(food, eq(food.id, foodVariant.foodId))
            .where(seedItem);
        const parts = await db
            .select({
                variantId: foodVariantPart.variantId,
                attribute: foodVariantPart.attribute,
                ordinal: foodVariantPart.ordinal,
                text: foodVariantPart.text,
            })
            .from(foodVariantPart)
            .innerJoin(foodVariant, eq(foodVariant.id, foodVariantPart.variantId))
            .innerJoin(foodItem, eq(foodItem.id, foodVariant.itemId))
            .where(seedItem)
            .orderBy(asc(foodVariantPart.variantId), asc(foodVariantPart.attribute), asc(foodVariantPart.ordinal));
        const sources = await db
            .select({
                id: foodSources.id,
                itemKey: foodItem.naturalKey,
                source: foodSources.source,
                externalKey: foodSources.externalKey,
            })
            .from(foodSources)
            .innerJoin(foodItem, eq(foodItem.id, foodSources.itemId))
            .where(seedItem);
        const portions = await db
            .select({
                itemKey: foodItem.naturalKey,
                label: foodPortions.label,
                gramWeight: foodPortions.gramWeight,
                sourceId: foodPortions.sourceId,
                citationId: foodPortions.citationId,
            })
            .from(foodPortions)
            .innerJoin(foodItem, eq(foodItem.id, foodPortions.itemId))
            .where(seedItem);
        const categories = await db
            .select({
                itemKey: foodItem.naturalKey,
                name: foodCategory.name,
                sourceId: foodCategoryAssignment.sourceId,
            })
            .from(foodCategoryAssignment)
            .innerJoin(foodItem, eq(foodItem.id, foodCategoryAssignment.itemId))
            .innerJoin(foodCategory, eq(foodCategory.id, foodCategoryAssignment.categoryId))
            .where(seedItem);
        const popularity = await db
            .select({
                itemKey: foodItem.naturalKey,
                weight: foodPopularity.consumptionWeight,
                priorFraction: foodPopularity.priorFraction,
                source: foodPopularity.source,
            })
            .from(foodPopularity)
            .innerJoin(foodItem, eq(foodItem.id, foodPopularity.itemId))
            .where(seedItem);
        const headers = await db
            .select({ id: foodNutrition.id, foodId: foodNutrition.foodId, variantId: foodNutrition.foodVariantId })
            .from(foodNutrition)
            .where(inArray(foodNutrition.id, seedHeaders));
        const citations = await db
            .select({
                id: foodNutritionCitation.id,
                nutritionId: foodNutritionCitation.nutritionId,
                dataset: foodNutritionCitation.dataset,
                externalKey: foodNutritionCitation.externalKey,
                match: foodNutritionCitation.match,
                densityGPerMl: foodNutritionCitation.densityGPerMl,
                kcalFromKj: foodNutritionCitation.kcalFromKj,
                url: foodNutritionCitation.url,
                retrievedOn: foodNutritionCitation.retrievedOn,
                manufacturer: foodNutritionCitation.manufacturer,
                servingLabel: foodNutritionCitation.servingLabel,
                servingGrams: foodNutritionCitation.servingGrams,
            })
            .from(foodNutritionCitation)
            .where(inArray(foodNutritionCitation.nutritionId, seedHeaders));
        const values = await db
            .select({
                nutritionId: foodNutritionValue.nutritionId,
                name: nutrient.name,
                unit: nutrient.unit,
                amount: foodNutritionValue.amount,
                basis: foodNutritionValue.basis,
            })
            .from(foodNutritionValue)
            .innerJoin(nutrient, eq(nutrient.id, foodNutritionValue.nutrientId))
            .where(inArray(foodNutritionValue.nutritionId, seedHeaders));
        const forwards = await db
            .select({
                sourceId: foodForward.sourceId,
                sourceKind: foodForward.sourceKind,
                sourceKey: foodForward.sourceKey,
                targetFoodId: foodForward.targetFoodId,
                targetVariantId: foodForward.targetVariantId,
            })
            .from(foodForward);
        // KTD-12's exception, as the ownership trigger states it: not seed-owned, unauthored, live.
        const liveNames = await db
            .select({ id: food.id, normalizedName: food.normalizedName })
            .from(food)
            .innerJoin(foodItem, eq(foodItem.id, food.itemId))
            .where(and(not(foodItem.seedOwned), isNull(food.userId), isNull(food.retiredAt)));
        // Every non-seed item, retired or not: `food_sources` is unique on (source, external_key) across all of them.
        const liveSources = await db
            .select({ source: foodSources.source, externalKey: foodSources.externalKey })
            .from(foodSources)
            .innerJoin(foodItem, eq(foodItem.id, foodSources.itemId))
            .where(not(foodItem.seedOwned));

        return {
            items: items.flatMap((row) =>
                row.naturalKey === null ? [] : [{ id: row.id, naturalKey: row.naturalKey }],
            ),
            roots: roots.flatMap((row) =>
                row.seedKey === null
                    ? []
                    : [
                          {
                              id: row.id,
                              seedKey: row.seedKey,
                              name: row.name,
                              aliases: row.aliases,
                              retired: row.retiredAt !== null,
                              itemKey: row.itemKey,
                          },
                      ],
            ),
            variants: variants.flatMap((row) =>
                row.itemKey === null
                    ? []
                    : [
                          {
                              id: row.id,
                              itemKey: row.itemKey,
                              rootSeedKey: row.rootSeedKey,
                              retired: row.retiredAt !== null,
                          },
                      ],
            ),
            parts,
            sources: sources.flatMap((row) => (row.itemKey === null ? [] : [{ ...row, itemKey: row.itemKey }])),
            portions: portions.flatMap((row) => (row.itemKey === null ? [] : [{ ...row, itemKey: row.itemKey }])),
            categories: categories.flatMap((row) => (row.itemKey === null ? [] : [{ ...row, itemKey: row.itemKey }])),
            popularity: popularity.flatMap((row) => (row.itemKey === null ? [] : [{ ...row, itemKey: row.itemKey }])),
            headers,
            citations,
            values,
            forwards,
            liveNames,
            liveSources,
        };
    }
}
