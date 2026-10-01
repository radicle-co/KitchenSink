/**
 * The seed image as the catalog a seeded database would hold (curated catalog plan U5, KTD-11).
 *
 * @pattern Adapter — a `CatalogSnapshot` read off a committed seed instead of a database, so CI can plan main's seed
 *   against a pull request's seed with no database
 *
 * Every id is `projected:<key>`: a projection has no ids, and these never reach a database. It holds no retired row,
 * no forward and no live row, because a committed seed describes only what is live (KTD-3).
 *
 * No value changes here. Each comes from the image as `basisConversion.ts` left it (KTD-24), and only its spelling is
 * made canonical, so the projection and the database adapter compare equal on equal content.
 */
import type { CanonicalNutrient } from '../../../sources/foodSourceAdapter.js';
import { INFOODS, NUTRIENT_DEFINITIONS, type InfoodsTag } from '../../nutrition/nutrientIdentity.js';
import { isFdcKey, type ItemKey, type SeedKey } from '../catalogKey.js';
import type { CitationMatch } from './citationPrecedence.js';
import {
    EMPTY_CONTENT,
    canonicalDecimal,
    comparePortions,
    compareText,
    usdaExternalKey,
    type CatalogContent,
    type CatalogSnapshot,
    type ContentCitation,
    type ContentItem,
    type ContentNutrition,
    type CitedPortion,
    type ContentRoot,
    type ContentSource,
    type ContentValue,
    type ContentVariant,
} from './catalogSnapshot.js';
import type { RootNumbers, SeedImage, SeedImageItem } from './seedImage.js';

/**
 * The match a root's or variant's citation of ITS OWN item records. 0018's `source_item_shape` CHECK requires a match
 * on every source-item citation, and an owner's own item is the food itself. The verifier must restate it.
 */
export const OWN_ITEM_MATCH: CitationMatch = 'exact';

/** The prefix of every projected id. */
const PROJECTED_ID_PREFIX = 'projected:';

/** Each tagged definition's dictionary entry, by tag. */
const ENTRY_BY_TAG: ReadonlyMap<string, { readonly name: string; readonly unit: string }> = new Map(
    Object.values(NUTRIENT_DEFINITIONS).flatMap((definition) =>
        definition.tag === null ? [] : [[definition.tag, { name: definition.name, unit: definition.unit }] as const],
    ),
);

/**
 * Order values by dictionary entry. Pure.
 *
 * @param left - A value.
 * @param right - A value.
 * @returns Negative, zero or positive.
 */
function compareValues(left: ContentValue, right: ContentValue): number {
    return compareText(left.name, right.name) || compareText(left.unit, right.unit);
}

/**
 * Order source rows by source, then key. Pure.
 *
 * @param left - A source row.
 * @param right - A source row.
 * @returns Negative, zero or positive.
 */
function compareSources(left: ContentSource, right: ContentSource): number {
    return compareText(left.source, right.source) || compareText(left.externalKey, right.externalKey);
}

/**
 * A USDA item's source row. Pure.
 *
 * @param item - The item's natural key.
 * @returns The `food_sources` identity.
 */
function usdaSource(item: Parameters<typeof usdaExternalKey>[0]): ContentSource {
    return { source: 'usda', externalKey: usdaExternalKey(item) };
}

/**
 * Sorted, canonically spelled values. Pure.
 *
 * @param values - Values in any order.
 * @returns The values in dictionary order.
 */
function valuesOf(values: readonly ContentValue[]): ContentValue[] {
    return values
        .map((value) => ({ ...value, amount: value.amount === null ? null : canonicalDecimal(value.amount) }))
        .sort(compareValues);
}

/**
 * The values of a USDA item's nutrient rows. Pure.
 *
 * @param nutrients - The rows, as the live parser maps them.
 * @returns Their values.
 */
function usdaValues(nutrients: readonly CanonicalNutrient[]): ContentValue[] {
    return valuesOf(
        nutrients.map((nutrient) => ({ name: nutrient.name, unit: nutrient.unit, amount: nutrient.amount })),
    );
}

/**
 * The dictionary entry of a stored tag. Pure.
 *
 * @param tag - An INFOODS tag.
 * @returns Its `(name, unit)`.
 * @throws {Error} for a tag no definition carries, which the `InfoodsTag` type rules out.
 */
function entryOf(tag: InfoodsTag): { readonly name: string; readonly unit: string } {
    const entry = ENTRY_BY_TAG.get(tag);

    if (entry === undefined) {
        throw new Error(`Unreachable: ${tag} is a stored tag with no definition.`);
    }

    return entry;
}

/**
 * A citation of a USDA SR Legacy or Foundation item. Pure.
 *
 * @param item - The cited item.
 * @param match - How well it matches the food.
 * @returns The citation.
 */
function usdaItemCitation(item: Parameters<typeof usdaExternalKey>[0], match: CitationMatch): ContentCitation {
    return {
        dataset: 'usdaSrFoundation',
        externalKey: usdaExternalKey(item),
        match,
        densityGPerMl: null,
        kcalFromKj: false,
    };
}

/**
 * The nutrients of an image item. Pure.
 *
 * @param image - The image.
 * @param item - An item the image holds.
 * @returns Its supplier's rows.
 * @throws {Error} for an item the image does not hold, which `composeSeedImage` rules out.
 */
function itemOf(image: SeedImage, item: ItemKey): SeedImageItem {
    const found = image.items.get(item);

    if (found === undefined) {
        throw new Error(`Unreachable: ${item} is owned or cited but the image holds no such item.`);
    }

    return found;
}

/**
 * The nutrition an owner of its own USDA item stores. Pure.
 *
 * @param image - The image.
 * @param item - The owner's item.
 * @returns The header, or `null` for an item with no USDA source (a sourceless root's item).
 */
function ownItemNutrition(image: SeedImage, item: ItemKey): ContentNutrition | null {
    return isFdcKey(item)
        ? {
              citation: usdaItemCitation(item, OWN_ITEM_MATCH),
              values: usdaValues(itemOf(image, item).nutrients),
          }
        : null;
}

/**
 * The serving a root's citation states, as a portion of the root's item that cites it (OQ-1). Pure.
 *
 * A label states its serving; a gram-served Branded product states its household serving, kept verbatim (`1 ONZ`), as
 * every source value is: the seed stores what the source states. Any other citation states none.
 *
 * @param numbers - Where the root's numbers come from.
 * @param nutrition - The root's nutrition, whose citation the portion cites.
 * @returns The portion, or none (GR-019: a blank household text is absent, never blank).
 */
function citedServing(numbers: RootNumbers, nutrition: ContentNutrition | null): readonly CitedPortion[] {
    if (nutrition === null) {
        return [];
    }

    const { citation } = nutrition;

    switch (numbers.from) {
        case 'usdaBranded': {
            const label = numbers.product.household_serving_fulltext.trim();

            return label === ''
                ? []
                : [{ label, gramWeight: canonicalDecimal(numbers.product.serving_size), citation }];
        }

        case 'manufacturerLabel':
            return [
                {
                    label: numbers.label.serving.label,
                    gramWeight: canonicalDecimal(numbers.label.serving.grams),
                    citation,
                },
            ];

        case 'item':
        case 'none':
        case 'usdaStandIn':
        case 'extract':
            return [];
    }
}

/**
 * A root's nutrition, from wherever its numbers come (R50). Pure.
 *
 * @param image - The image.
 * @param item - The root's item.
 * @param numbers - Where its numbers come from.
 * @returns The header, or `null` when the seed states no numbers.
 */
function rootNutrition(image: SeedImage, item: ItemKey, numbers: RootNumbers): ContentNutrition | null {
    switch (numbers.from) {
        case 'item':
            return ownItemNutrition(image, item);

        case 'none':
            return null;

        case 'usdaStandIn':
            return {
                citation: usdaItemCitation(numbers.item, numbers.match),
                values: usdaValues(numbers.nutrients),
            };

        case 'usdaBranded':
            return {
                citation: {
                    dataset: 'usdaBranded',
                    externalKey: String(numbers.product.fdcId),
                    match: numbers.match,
                    densityGPerMl: null,
                    kcalFromKj: false,
                },
                values: valuesOf(numbers.per100g),
            };

        case 'extract': {
            const { values, traces = [], conversions } = numbers.per100g;
            const density = conversions.flatMap((conversion) =>
                conversion.kind === 'volumeToMass' ? [conversion.densityGramsPerMl] : [],
            );
            const stated = Object.values(INFOODS).flatMap((tag) => {
                const amount = values[tag];

                return amount === undefined ? [] : [{ ...entryOf(tag), amount }];
            });

            return {
                citation: {
                    dataset: numbers.dataset,
                    externalKey: isFdcKey(numbers.line.key) ? usdaExternalKey(numbers.line.key) : numbers.line.key,
                    match: numbers.match,
                    densityGPerMl: density[0] === undefined ? null : canonicalDecimal(density[0]),
                    kcalFromKj: conversions.some((conversion) => conversion.kind === 'kilojoulesToKilocalories'),
                },
                values: valuesOf([...stated, ...traces.map((tag) => ({ ...entryOf(tag), amount: null }))]),
            };
        }

        case 'manufacturerLabel':
            return {
                citation: {
                    dataset: 'label',
                    url: numbers.label.url,
                    retrievedOn: numbers.label.retrievedOn,
                    manufacturer: numbers.label.manufacturer,
                    servingLabel: numbers.label.serving.label,
                    servingGrams: canonicalDecimal(numbers.label.serving.grams),
                },
                values: valuesOf(numbers.per100g),
            };
    }
}

/**
 * An image item as the catalog holds it. Pure.
 *
 * @param key - The item's natural key.
 * @param item - The image item.
 * @param popularitySource - The survey cycle its weight comes from.
 * @returns The content item.
 */
function contentItem(
    key: ItemKey,
    item: SeedImageItem,
    popularitySource: string,
    cited: readonly CitedPortion[] = [],
): ContentItem {
    const portions = [
        ...item.portions.map((portion) => ({
            label: portion.label,
            gramWeight: canonicalDecimal(portion.gramWeight),
            source: usdaSource(portion.source),
        })),
        ...cited,
    ];
    const weight = canonicalDecimal(item.weight);

    return {
        key,
        sources: item.sources.map((source) => usdaSource(source.item)).sort(compareSources),
        portions: portions.sort(comparePortions),
        // The image carries no category yet: which taxonomy the seed stores is an open decision.
        categories: [],
        popularity:
            weight === '0'
                ? null
                : { weight, priorFraction: canonicalDecimal(item.priorFraction), source: popularitySource },
    };
}

/**
 * Project a seed image onto the catalog it describes. Pure.
 *
 * @param image - A composed seed image.
 * @returns A snapshot whose live rows are the image's, each id `projected:<key>`.
 */
export function projectSeed(image: SeedImage): CatalogSnapshot {
    const roots = new Map<SeedKey, ContentRoot>();
    const variants = new Map<ItemKey, ContentVariant>();
    const items = new Map<ItemKey, ContentItem>();

    for (const root of image.roots.values()) {
        const nutrition = rootNutrition(image, root.item, root.numbers);

        roots.set(root.seedKey, {
            seedKey: root.seedKey,
            name: root.name,
            synonyms: root.synonyms,
            item: root.item,
            nutrition,
        });
        items.set(
            root.item,
            contentItem(
                root.item,
                itemOf(image, root.item),
                image.popularitySource,
                citedServing(root.numbers, nutrition),
            ),
        );

        for (const variant of root.variants) {
            const nutrition = ownItemNutrition(image, variant.item);

            if (nutrition === null) {
                throw new Error(`Unreachable: variant ${variant.item} has no USDA item, which the format refuses.`);
            }

            variants.set(variant.item, { item: variant.item, root: root.seedKey, parts: variant.parts, nutrition });
            items.set(variant.item, contentItem(variant.item, itemOf(image, variant.item), image.popularitySource));
        }
    }

    const content: CatalogContent = { roots, variants, items };
    const projectedIds = <Key extends string>(keys: Iterable<Key>): ReadonlyMap<Key, string> =>
        new Map([...keys].map((key) => [key, `${PROJECTED_ID_PREFIX}${key}`]));

    return {
        content,
        retired: EMPTY_CONTENT,
        ids: {
            roots: projectedIds(roots.keys()),
            variants: projectedIds(variants.keys()),
            items: projectedIds(items.keys()),
        },
        forwards: [],
        liveNames: new Map(),
        liveSourceKeys: new Set(),
    };
}
