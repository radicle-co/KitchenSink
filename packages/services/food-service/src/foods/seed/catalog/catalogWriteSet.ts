/**
 * The rows one apply writes, resolved from a plan (curated catalog plan U6, KTD-1, KTD-8, KTD-19).
 *
 * @pattern Functional core — a pure function from a plan, the snapshot's ids and an id minter to the rows each
 *   statement writes; the Unit of Work (`catalogPlanApplier.ts`) only stages and executes them
 *
 * This is the one place a seeded row gets an id: a row the snapshot holds keeps its id, a root or variant the plan
 * restores keeps the id its forward kept (R33), and everything else is minted here, never twice for one key (KTD-8).
 * Every reference is resolved to an id before a statement runs, so the SQL joins nothing but the two shared
 * dictionaries and a cited portion's citation, which the apply finds through the item's owner.
 *
 * ⚠️ What the seed writes that no committed byte states, which the independent verifier (KTD-3) must restate:
 *
 * - every seeded root carries {@link SEEDED_ROOT_COLUMNS}, and NULL `description`, `brand_owner`, `brand_name`,
 *   `barcode`, `user_id`, `tombstoned_at` and `withdrawn_at`;
 * - every seeded source row carries {@link SEEDED_SOURCE_COLUMNS};
 * - every seeded value is per 100 g ({@link SEEDED_VALUE_BASIS}), and its `trace` is exactly `amount IS NULL`;
 * - a dictionary entry the seed adds carries the INFOODS tag its definition maps (`mappedTagOf`), else NULL;
 * - the seed writes NO `food_field_provenance` row. Every scalar a seeded root carries is the curator's or a constant,
 *   never a source row's, so no row could say which source supplied it (R5).
 */
import { mappedTagOf } from '../../dao/nutrient.dao.js';
import { ALIAS_DELIMITER } from '../../foodAliases.js';
import { normalizeName } from '../../foodName.js';
import type { ItemKey, SeedKey } from '../catalogKey.js';
import { CatalogApplyError } from './catalogPlanApplier.errors.js';
import type { CatalogPlan, OwnerKey } from './catalogPlanBuilder.js';
import {
    compareText,
    sourceRefKey,
    type ContentCitation,
    type ContentItem,
    type ContentNutrition,
    type OwnerKind,
    type SnapshotIds,
} from './catalogSnapshot.js';

/** The `food` columns every seeded root carries and the seed does not state. */
export const SEEDED_ROOT_COLUMNS = { status: 'RESOLVED', kind: 'generic', visibility: 'public' } as const;

/** The `food_sources` columns every seeded source row carries: fetched, and no live version to compare against. */
export const SEEDED_SOURCE_COLUMNS = { fetchState: 'fetched', itemVersion: null } as const;

/** The basis of every seeded value: the port holds per-100-g values only (KTD-20). */
export const SEEDED_VALUE_BASIS = 'per_100g';

/** A `nutrient` dictionary entry the apply adds when absent. */
export interface NutrientEntryRow {
    readonly id: string;
    readonly name: string;
    readonly unit: string;
    readonly infoodsTag: string | null;
}

/** A `food_category` dictionary entry the apply adds when absent. */
export interface CategoryEntryRow {
    readonly id: string;
    readonly name: string;
}

/** A source row the apply releases from a food it does not own (KTD-12's key claim). */
export interface ReleaseRow {
    readonly holderId: string;
    readonly source: string;
    readonly externalKey: string;
}

/** A `food_item` row. */
export interface ItemRow {
    readonly id: string;
    readonly naturalKey: ItemKey;
    readonly ownerKind: OwnerKind;
}

/** A held item whose owner kind flips. */
export interface ItemReownRow {
    readonly id: string;
    readonly ownerKind: OwnerKind;
}

/** A seeded root's own columns. */
export interface RootRow {
    readonly id: string;
    readonly seedKey: SeedKey;
    readonly itemId: string;
    readonly name: string;
    readonly normalizedName: string;
    /** The synonyms joined by `ALIAS_DELIMITER`, or NULL when there are none (GR-019). */
    readonly aliases: string | null;
}

/** A held root the apply rewrites, and whether the write clears its `retired_at`. */
export interface RootUpdateRow extends RootRow {
    readonly restore: boolean;
}

/** A `food_variant` row. */
export interface VariantRow {
    readonly id: string;
    readonly foodId: string;
    readonly itemId: string;
}

/** A `food_sources` row. */
export interface SourceRow {
    readonly id: string;
    readonly itemId: string;
    readonly source: string;
    readonly externalKey: string;
    readonly lineageKey: string | null;
}

/** A `food_nutrition` header: exactly one of its two owner ids is set. */
export interface HeaderRow {
    readonly id: string;
    readonly foodId: string | null;
    readonly variantId: string | null;
}

/** A `food_nutrition_citation` row, in either of 0018's two shapes. */
export interface CitationRow {
    readonly id: string;
    readonly nutritionId: string;
    readonly dataset: string;
    readonly externalKey: string | null;
    readonly match: string | null;
    readonly densityGPerMl: string | null;
    readonly kcalFromKj: boolean;
    readonly url: string | null;
    readonly retrievedOn: string | null;
    readonly manufacturer: string | null;
    readonly servingLabel: string | null;
    readonly servingGrams: string | null;
}

/** A `food_nutrition_value` row, its nutrient named by its dictionary entry. */
export interface ValueRow {
    readonly nutritionId: string;
    readonly citationId: string;
    readonly name: string;
    readonly unit: string;
    readonly amount: string | null;
    readonly trace: boolean;
}

/** A portion from a source row of its item. */
export interface SourcePortionRow {
    readonly id: string;
    readonly itemId: string;
    readonly label: string;
    readonly gramWeight: string;
    readonly sourceId: string;
}

/**
 * A portion a citation states (OQ-1). It names the citation by dataset and key or URL, and the apply finds its id
 * through the item's owner's header, which holds exactly one citation.
 */
export interface CitedPortionRow {
    readonly id: string;
    readonly itemId: string;
    readonly label: string;
    readonly gramWeight: string;
    readonly dataset: string;
    readonly externalKey: string | null;
    readonly url: string | null;
}

/** A `food_category_assignment` row, its category named by its dictionary entry. */
export interface CategoryRow {
    readonly itemId: string;
    readonly name: string;
    readonly sourceId: string | null;
}

/** A `food_variant_part` row: its ordinal counts within its attribute. */
export interface PartRow {
    readonly variantId: string;
    readonly attribute: string;
    readonly ordinal: number;
    readonly text: string;
}

/** A `food_forward` row: exactly one of its two target ids is set. */
export interface ForwardRow {
    readonly sourceId: string;
    readonly sourceKind: OwnerKind;
    readonly sourceKey: string | null;
    readonly targetFoodId: string | null;
    readonly targetVariantId: string | null;
}

/** The rows replaced whole: an item's children, an owner's nutrition, a variant's parts. */
export interface ChildrenWriteSet {
    /** The items whose sources, portions and categories are replaced. */
    readonly itemIds: readonly string[];
    /** The owners whose nutrition is replaced; a header is deleted for each, then written again unless it is none. */
    readonly nutritionOwners: { readonly rootIds: readonly string[]; readonly variantIds: readonly string[] };
    /** The variants whose parts are replaced. */
    readonly partsVariantIds: readonly string[];
    readonly sources: readonly SourceRow[];
    readonly headers: readonly HeaderRow[];
    readonly citations: readonly CitationRow[];
    readonly values: readonly ValueRow[];
    readonly sourcePortions: readonly SourcePortionRow[];
    readonly citedPortions: readonly CitedPortionRow[];
    readonly categories: readonly CategoryRow[];
    readonly parts: readonly PartRow[];
}

/** Every row one apply writes or removes, by the statement that does it. */
export interface CatalogWriteSet {
    readonly dictionary: {
        readonly nutrients: readonly NutrientEntryRow[];
        readonly categories: readonly CategoryEntryRow[];
    };
    /** Live foods the seed retires (KTD-12). */
    readonly claims: readonly string[];
    readonly releases: readonly ReleaseRow[];
    readonly forwardDeletes: readonly string[];
    readonly variantDeletes: readonly string[];
    readonly rootDeletes: readonly string[];
    readonly itemInserts: readonly ItemRow[];
    readonly itemReowns: readonly ItemReownRow[];
    readonly rootRetires: readonly string[];
    readonly variantRetires: readonly string[];
    readonly rootUpdates: readonly RootUpdateRow[];
    readonly rootInserts: readonly RootRow[];
    readonly variantRestores: readonly string[];
    readonly variantInserts: readonly VariantRow[];
    readonly itemDeletes: readonly string[];
    readonly children: ChildrenWriteSet;
    readonly forwardInserts: readonly ForwardRow[];
}

/** The ids a write set resolves references through: the snapshot's, then those the plan inserts. */
interface IdIndex {
    readonly roots: ReadonlyMap<SeedKey, string>;
    readonly variants: ReadonlyMap<ItemKey, string>;
    readonly items: ReadonlyMap<ItemKey, string>;
}

/**
 * The id an index holds for a key.
 *
 * @param ids - The index.
 * @param key - The key.
 * @param rule - The refusal when it holds none.
 * @returns The id.
 * @throws {CatalogApplyError} when the index holds no id for the key.
 */
function idOf<Key extends string>(
    ids: ReadonlyMap<Key, string>,
    key: Key,
    rule: 'unresolvedOwner' | 'unresolvedItem',
): string {
    const id = ids.get(key);

    if (id === undefined) {
        throw new CatalogApplyError(rule, key, 'neither the catalog holds it nor does the plan insert it');
    }

    return id;
}

/**
 * The id of a root or variant. Pure.
 *
 * @param index - The ids.
 * @param owner - The owner.
 * @returns Its id.
 * @throws {CatalogApplyError} `unresolvedOwner` when no row stands for it.
 */
function ownerIdOf(index: IdIndex, owner: OwnerKey): string {
    return owner.kind === 'root'
        ? idOf(index.roots, owner.key, 'unresolvedOwner')
        : idOf(index.variants, owner.key, 'unresolvedOwner');
}

/**
 * A root's own columns. Pure.
 *
 * @param write - The plan's root.
 * @param id - Its id.
 * @param index - The ids.
 * @returns The row.
 */
function rootRow(
    write: {
        readonly seedKey: SeedKey;
        readonly name: string;
        readonly synonyms: readonly string[];
        readonly item: ItemKey;
    },
    id: string,
    index: IdIndex,
): RootRow {
    return {
        id,
        seedKey: write.seedKey,
        itemId: idOf(index.items, write.item, 'unresolvedItem'),
        name: write.name,
        normalizedName: normalizeName(write.name),
        aliases: write.synonyms.length === 0 ? null : write.synonyms.join(ALIAS_DELIMITER),
    };
}

/**
 * A citation's row. Pure.
 *
 * @param citation - The citation.
 * @param id - Its id.
 * @param nutritionId - Its header.
 * @returns The row in the shape its dataset gives it.
 */
function citationRow(citation: ContentCitation, id: string, nutritionId: string): CitationRow {
    if (citation.dataset === 'label') {
        return {
            id,
            nutritionId,
            dataset: 'label',
            externalKey: null,
            match: null,
            densityGPerMl: null,
            kcalFromKj: false,
            url: citation.url,
            retrievedOn: citation.retrievedOn,
            manufacturer: citation.manufacturer,
            servingLabel: citation.servingLabel,
            servingGrams: citation.servingGrams,
        };
    }

    return {
        id,
        nutritionId,
        dataset: citation.dataset,
        externalKey: citation.externalKey,
        match: citation.match,
        densityGPerMl: citation.densityGPerMl,
        kcalFromKj: citation.kcalFromKj,
        url: null,
        retrievedOn: null,
        manufacturer: null,
        servingLabel: null,
        servingGrams: null,
    };
}

/** The rows of the children a write set replaces, filled one item or owner at a time. */
interface ChildrenBuilder {
    readonly sources: SourceRow[];
    readonly headers: HeaderRow[];
    readonly citations: CitationRow[];
    readonly values: ValueRow[];
    readonly sourcePortions: SourcePortionRow[];
    readonly citedPortions: CitedPortionRow[];
    readonly categories: CategoryRow[];
    readonly parts: PartRow[];
}

/**
 * Stage one item's children, minting an id for each source row and portion in the item's own order.
 *
 * @param out - The rows being built.
 * @param item - The item, as the plan writes it.
 * @param itemId - Its id.
 * @param mintId - The minter.
 * @throws {CatalogApplyError} `unresolvedSource` when a portion or category cites a source row the item lacks.
 * @sideEffect Appends to `out`; calls `mintId`.
 */
function stageItem(out: ChildrenBuilder, item: ContentItem, itemId: string, mintId: () => string): void {
    const sourceIds = new Map<string, string>();

    for (const source of item.sources) {
        const id = mintId();

        sourceIds.set(sourceRefKey(source), id);
        out.sources.push({
            id,
            itemId,
            source: source.source,
            externalKey: source.externalKey,
            lineageKey: source.lineageKey,
        });
    }

    const sourceIdOf = (source: { readonly source: string; readonly externalKey: string }): string => {
        const id = sourceIds.get(`${source.source}\u0000${source.externalKey}`);

        if (id === undefined) {
            throw new CatalogApplyError(
                'unresolvedSource',
                item.key,
                `${source.source} ${source.externalKey} is cited but is not a source row of the item`,
            );
        }

        return id;
    };

    for (const portion of item.portions) {
        const row = { id: mintId(), itemId, label: portion.label, gramWeight: portion.gramWeight };

        if ('citation' in portion) {
            const { citation } = portion;

            out.citedPortions.push({
                ...row,
                dataset: citation.dataset,
                externalKey: citation.dataset === 'label' ? null : citation.externalKey,
                url: citation.dataset === 'label' ? citation.url : null,
            });
        } else {
            out.sourcePortions.push({ ...row, sourceId: sourceIdOf(portion.source) });
        }
    }

    for (const category of item.categories) {
        out.categories.push({
            itemId,
            name: category.name,
            sourceId: category.source === null ? null : sourceIdOf(category.source),
        });
    }
}

/**
 * Stage one owner's header, its citation and its values.
 *
 * @param out - The rows being built.
 * @param owner - The owner's kind and id.
 * @param nutrition - Its nutrition.
 * @param mintId - The minter.
 * @sideEffect Appends to `out`; calls `mintId`.
 */
function stageNutrition(
    out: ChildrenBuilder,
    owner: { readonly kind: OwnerKind; readonly id: string },
    nutrition: ContentNutrition,
    mintId: () => string,
): void {
    const header = mintId();
    const citation = mintId();

    out.headers.push({
        id: header,
        foodId: owner.kind === 'root' ? owner.id : null,
        variantId: owner.kind === 'variant' ? owner.id : null,
    });
    out.citations.push(citationRow(nutrition.citation, citation, header));

    for (const value of nutrition.values) {
        out.values.push({
            nutritionId: header,
            citationId: citation,
            name: value.name,
            unit: value.unit,
            amount: value.amount,
            trace: value.amount === null,
        });
    }
}

/**
 * Every dictionary entry the staged rows name, once each, in name order. Pure but for minting.
 *
 * @param children - The staged children.
 * @param mintId - The minter.
 * @returns The entries.
 * @sideEffect Calls `mintId`.
 */
function dictionaryOf(children: ChildrenBuilder, mintId: () => string): CatalogWriteSet['dictionary'] {
    const nutrients = new Map<string, { readonly name: string; readonly unit: string }>();

    for (const value of children.values) {
        nutrients.set(`${value.name}\u0000${value.unit}`, { name: value.name, unit: value.unit });
    }

    const categoryNames = [...new Set(children.categories.map((category) => category.name))].sort(compareText);

    return {
        nutrients: [...nutrients.entries()]
            .sort(([left], [right]) => compareText(left, right))
            .map(([, entry]) => ({ id: mintId(), ...entry, infoodsTag: mappedTagOf(entry.name, entry.unit) ?? null })),
        categories: categoryNames.map((name) => ({ id: mintId(), name })),
    };
}

/**
 * Resolve a plan into the rows each statement of the apply writes. Pure but for the minter.
 *
 * Ids are minted in one fixed order (items, roots, variants, then each item's and owner's children in plan order), so
 * the same plan and minter give the same rows, and portion ids rise in each item's portion order.
 *
 * @param plan - The plan.
 * @param held - The snapshot's ids, by natural key.
 * @param mintId - The one source of new ids (`newFoodId` in the apply).
 * @returns The write set.
 * @throws {CatalogApplyError} when the plan names a row, item or source row nothing stands for.
 * @sideEffect Calls `mintId`.
 */
export function resolveCatalogWriteSet(plan: CatalogPlan, held: SnapshotIds, mintId: () => string): CatalogWriteSet {
    const { rows } = plan;
    const itemInserts = rows.items.insert.map((write): ItemRow => ({
        id: mintId(),
        naturalKey: write.key,
        ownerKind: write.ownerKind,
    }));
    const items = new Map<ItemKey, string>([
        ...held.items,
        ...itemInserts.map((row) => [row.naturalKey, row.id] as const),
    ]);
    const rootIds = new Map<SeedKey, string>([
        ...held.roots,
        ...rows.roots.insert.map((write) => [write.seedKey, write.id ?? mintId()] as const),
    ]);
    const variantIds = new Map<ItemKey, string>([
        ...held.variants,
        ...rows.variants.insert.map((write) => [write.item, write.id ?? mintId()] as const),
    ]);
    const index: IdIndex = { roots: rootIds, variants: variantIds, items };
    const children: ChildrenBuilder = {
        sources: [],
        headers: [],
        citations: [],
        values: [],
        sourcePortions: [],
        citedPortions: [],
        categories: [],
        parts: [],
    };

    for (const item of rows.itemChildren) {
        stageItem(children, item, idOf(items, item.key, 'unresolvedItem'), mintId);
    }

    for (const write of rows.nutrition) {
        if (write.nutrition !== null) {
            stageNutrition(
                children,
                { kind: write.owner.kind, id: ownerIdOf(index, write.owner) },
                write.nutrition,
                mintId,
            );
        }
    }

    for (const write of rows.parts) {
        const variantId = idOf(variantIds, write.item, 'unresolvedOwner');
        const ordinals = new Map<string, number>();

        for (const part of write.parts) {
            const ordinal = ordinals.get(part.attribute) ?? 0;

            ordinals.set(part.attribute, ordinal + 1);
            children.parts.push({ variantId, attribute: part.attribute, ordinal, text: part.text });
        }
    }

    const nutritionOwnerIds = (kind: OwnerKind): string[] =>
        rows.nutrition.filter((write) => write.owner.kind === kind).map((write) => ownerIdOf(index, write.owner));

    return {
        dictionary: dictionaryOf(children, mintId),
        claims: rows.claims.map((claim) => claim.id),
        releases: rows.releasedSources.map((release) => ({
            holderId: release.holder,
            source: release.source.source,
            externalKey: release.source.externalKey,
        })),
        forwardDeletes: rows.forwards.delete,
        variantDeletes: rows.variants.delete.map((row) => row.id),
        rootDeletes: rows.roots.delete.map((row) => row.id),
        itemInserts,
        itemReowns: rows.items.reown.map((row) => ({ id: row.id, ownerKind: row.ownerKind })),
        rootRetires: rows.roots.retire.map((row) => row.id),
        variantRetires: rows.variants.retire.map((row) => row.id),
        rootUpdates: rows.roots.update.map((write) => {
            if (write.id === null) {
                throw new CatalogApplyError('unresolvedOwner', write.seedKey, 'a root the plan rewrites names no id');
            }

            return { ...rootRow(write, write.id, index), restore: write.restore };
        }),
        rootInserts: rows.roots.insert.map((write) =>
            rootRow(write, idOf(rootIds, write.seedKey, 'unresolvedOwner'), index),
        ),
        variantRestores: rows.variants.restore.map((row) => row.id),
        variantInserts: rows.variants.insert.map((write) => ({
            id: idOf(variantIds, write.item, 'unresolvedOwner'),
            foodId: idOf(rootIds, write.root, 'unresolvedOwner'),
            itemId: idOf(items, write.item, 'unresolvedItem'),
        })),
        itemDeletes: rows.items.delete.map((row) => row.id),
        children: {
            itemIds: rows.itemChildren.map((item) => idOf(items, item.key, 'unresolvedItem')),
            nutritionOwners: { rootIds: nutritionOwnerIds('root'), variantIds: nutritionOwnerIds('variant') },
            partsVariantIds: rows.parts.map((write) => idOf(variantIds, write.item, 'unresolvedOwner')),
            ...children,
        },
        forwardInserts: rows.forwards.insert.map((write) => {
            const target = ownerIdOf(index, write.target);

            return {
                sourceId: write.sourceId,
                sourceKind: write.sourceKind,
                sourceKey: write.sourceKey,
                targetFoodId: write.target.kind === 'root' ? target : null,
                targetVariantId: write.target.kind === 'variant' ? target : null,
            };
        }),
    };
}
