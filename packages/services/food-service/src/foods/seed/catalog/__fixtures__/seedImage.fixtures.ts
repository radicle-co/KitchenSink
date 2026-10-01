/**
 * Fixture factories for a composed seed image (curated catalog plan U5). `make*` builders accept `Partial<T>`.
 */
import type { CanonicalNutrient } from '../../../../sources/foodSourceAdapter.js';
import type { SeedImage, SeedImageItem, SeedImageRoot } from '../seedImage.js';

/**
 * A nutrient row as the live parser maps it.
 *
 * @param overrides - Field overrides.
 * @returns Protein, 21.5 g per 100 g.
 */
export function makeCanonicalNutrient(overrides: Partial<CanonicalNutrient> = {}): CanonicalNutrient {
    return { code: null, name: 'Protein', unit: 'g', amount: '21.5', basis: 'per_100g', ...overrides };
}

/**
 * An image item.
 *
 * @param overrides - Field overrides.
 * @returns Item `fdc:100` with one supplier source, no portions and no weight.
 */
export function makeSeedImageItem(overrides: Partial<SeedImageItem> = {}): SeedImageItem {
    return {
        sources: [{ item: 'fdc:100', role: 'supplier' }],
        portions: [],
        nutrients: [makeCanonicalNutrient()],
        weight: '0',
        priorFraction: '0',
        ...overrides,
    };
}

/**
 * An image root.
 *
 * @param overrides - Field overrides.
 * @returns Baseline root `fdc:100` on its own item, with no variants.
 */
export function makeSeedImageRoot(overrides: Partial<SeedImageRoot> = {}): SeedImageRoot {
    return {
        seedKey: 'fdc:100',
        name: 'Beef, brisket, whole, raw',
        synonyms: [],
        item: 'fdc:100',
        variants: [],
        numbers: { from: 'item' },
        origin: 'baseline',
        ...overrides,
    };
}

/**
 * An image from its roots and items.
 *
 * @param roots - The roots.
 * @param items - The items, by key.
 * @param popularitySource - The survey cycle of every popularity weight.
 * @returns The image.
 */
export function makeSeedImage(
    roots: readonly SeedImageRoot[],
    items: readonly (readonly [SeedImageRoot['item'], SeedImageItem])[],
    popularitySource = 'fndds-fixture-cycle',
): SeedImage {
    return { roots: new Map(roots.map((root) => [root.seedKey, root])), items: new Map(items), popularitySource };
}
