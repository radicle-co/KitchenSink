/**
 * Fixture factories for catalog content and snapshots (curated catalog plan U5). `make*` builders accept `Partial<T>`.
 *
 * A snapshot built here names each row's id `id:<key>`, so a test can tell a reused id from a minted one by sight.
 */
import type { ItemKey, SeedKey } from '../../catalogKey.js';
import {
    EMPTY_CONTENT,
    usdaExternalKey,
    type CatalogContent,
    type CatalogSnapshot,
    type ContentItem,
    type ContentNutrition,
    type ContentRoot,
    type ContentVariant,
    type SnapshotForward,
} from '../catalogSnapshot.js';

/**
 * A header citing an item as itself.
 *
 * @param item - The cited `fdc:<id>` item.
 * @param protein - The protein value.
 * @returns The header.
 */
export function makeNutrition(item: `fdc:${string}` = 'fdc:100', protein = '21.5'): ContentNutrition {
    return {
        citation: {
            dataset: 'usdaSrFoundation',
            externalKey: usdaExternalKey(item),
            match: 'exact',
            densityGPerMl: null,
            kcalFromKj: false,
        },
        values: [{ name: 'Protein', unit: 'g', amount: protein }],
    };
}

/**
 * A root.
 *
 * @param overrides - Field overrides.
 * @returns Root `fdc:100` "beef brisket" on its own item.
 */
export function makeContentRoot(overrides: Partial<ContentRoot> = {}): ContentRoot {
    return {
        seedKey: 'fdc:100',
        name: 'beef brisket',
        synonyms: [],
        item: 'fdc:100',
        nutrition: makeNutrition('fdc:100'),
        ...overrides,
    };
}

/**
 * A variant.
 *
 * @param overrides - Field overrides.
 * @returns Variant on item `fdc:101` of root `fdc:100`.
 */
export function makeContentVariant(overrides: Partial<ContentVariant> = {}): ContentVariant {
    return {
        item: 'fdc:101',
        root: 'fdc:100',
        parts: [{ attribute: 'cut', text: 'flat' }],
        nutrition: makeNutrition('fdc:101'),
        ...overrides,
    };
}

/**
 * An item with one USDA source row: itself.
 *
 * @param key - The item's `fdc:<id>` key.
 * @param overrides - Field overrides.
 * @returns The item.
 */
export function makeContentItem(key: ItemKey = 'fdc:100', overrides: Partial<ContentItem> = {}): ContentItem {
    return {
        key,
        sources: key.startsWith('fdc:') ? [{ source: 'usda', externalKey: key.slice('fdc:'.length) }] : [],
        portions: [],
        categories: [],
        popularity: null,
        ...overrides,
    };
}

/**
 * Content from roots and variants, each owning an item made by {@link makeContentItem} unless one is given.
 *
 * @param roots - The roots.
 * @param variants - The variants.
 * @param items - Items to use instead of the made ones, by key.
 * @returns The content.
 */
export function makeContent(
    roots: readonly ContentRoot[],
    variants: readonly ContentVariant[] = [],
    items: readonly ContentItem[] = [],
): CatalogContent {
    const given = new Map(items.map((item) => [item.key, item]));
    const owned = [...roots.map((root) => root.item), ...variants.map((variant) => variant.item)];

    return {
        roots: new Map(roots.map((root) => [root.seedKey, root])),
        variants: new Map(variants.map((variant) => [variant.item, variant])),
        items: new Map(owned.map((key) => [key, given.get(key) ?? makeContentItem(key)])),
    };
}

/**
 * A database snapshot: live rows, retired rows and forwards, every id `id:<key>`.
 *
 * @param live - The live seed rows.
 * @param overrides - The retired rows, forwards, live names and live source keys.
 * @returns The snapshot.
 */
export function makeSnapshot(
    live: CatalogContent,
    overrides: {
        readonly retired?: CatalogContent;
        readonly forwards?: readonly SnapshotForward[];
        readonly liveNames?: ReadonlyMap<string, string>;
        readonly liveSourceKeys?: ReadonlySet<string>;
    } = {},
): CatalogSnapshot {
    const retired = overrides.retired ?? EMPTY_CONTENT;
    const idsOf = <Key extends SeedKey | ItemKey>(...maps: ReadonlyMap<Key, unknown>[]): ReadonlyMap<Key, string> =>
        new Map(maps.flatMap((map) => [...map.keys()]).map((key) => [key, `id:${key}`]));

    return {
        content: live,
        retired,
        ids: {
            roots: idsOf(live.roots, retired.roots),
            variants: idsOf(live.variants, retired.variants),
            items: idsOf(live.items, retired.items),
        },
        forwards: overrides.forwards ?? [],
        liveNames: overrides.liveNames ?? new Map(),
        liveSourceKeys: overrides.liveSourceKeys ?? new Set(),
    };
}
