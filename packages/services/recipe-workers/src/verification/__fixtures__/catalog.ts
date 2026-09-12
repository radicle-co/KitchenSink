/**
 * A miniature stand-in for the seeded USDA food catalog, shaped like the real thing.
 *
 * Every description here is either taken verbatim from the seeded catalog or written in exactly its house
 * style (head noun first, descriptors after, comma separated), because the whole corpus generator is a
 * function of that shape. A fixture that invented a tidier convention would let the generator pass its tests
 * and produce nonsense against the real 8,094 rows.
 *
 * The set is deliberately arranged to exercise all three contrast relations:
 *
 *  - **head-sharing siblings** (`Flour, wheat …` / `Flour, rice …`) for the near-miss identity class,
 *  - **form counterparts** (`Radishes, oriental, raw` / `Radishes, oriental, dried`) for the wrong-form class,
 *  - **rows with neither** (`Peaches, canned, water pack`), so the allocator's scarcity handling is reachable.
 */
import type { CatalogRow } from '../corpusSynthesis.js';

/** The descriptions, in catalog order. Ids are `f01…` so the generator's id ordering is legible in failures. */
const NAMES = [
    'Flour, wheat, all-purpose',
    'Flour, rice, white',
    'Flour, corn, whole-grain',
    'Bread, wheat, sprouted',
    'Bread, white, commercially prepared',
    'Radishes, oriental, raw',
    'Radishes, oriental, dried',
    'Radishes, red, raw',
    'Mushrooms, shiitake, raw',
    'Mushrooms, shiitake, dried',
    'Mushrooms, portabella, raw',
    'Cheese, cheshire',
    'Cheese, feta',
    'Nuts, pine nuts, dried',
    'Nuts, pecans, halves',
    'Taro, cooked, without salt',
    'Taro, cooked, with salt',
    'Apples, gala, with skin, raw',
    'Apples, fuji, with skin, raw',
    'Oats, whole grain, steel cut',
    'Oats, instant, fortified',
    'Plantains, green, raw',
    'Plantains, green, fried',
    'Peaches, canned, water pack',
] as const;

/**
 * Build the fixture catalog.
 *
 * @param extra - Rows to append, for a test that needs a shape the base set does not carry.
 * @returns The catalog rows. Pure.
 */
export function makeCatalogRows(extra: readonly CatalogRow[] = []): CatalogRow[] {
    return [...NAMES.map((name, index) => ({ id: `f${String(index + 1).padStart(2, '0')}`, name })), ...extra];
}
