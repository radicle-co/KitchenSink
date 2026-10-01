/**
 * Fixture factories for the curated seed (plan U1, KTD-16). `make*` builders accept `Partial<T>`.
 *
 * KTD-16 puts one root of each nutrition shape HERE rather than in the committed seed, which holds no label:
 * a root with its own USDA item, a USDA citation, a composition-table citation, a manufacturer label, and a root
 * with no numbers.
 *
 * The builders return plain objects that tests serialize as JSON lines, so a refusal case can spread one and
 * add or drop a key the parser must refuse.
 */
import type { BrandedProduct } from '../../archive/brandedExtract.js';
import type { ExtractLine } from '../../archive/sourceExtract.js';
import type { UsdaItemFacts } from '../baselineSeed.js';
import type {
    CatalogChanges,
    CuratedPart,
    CuratedVariant,
    ItemRoot,
    ManufacturerLabel,
    SourceItemCitation,
    SourcelessRoot,
} from '../curatedSeedFormat.js';

/**
 * A variant part.
 *
 * @param overrides - Field overrides.
 * @returns A `cut` part.
 */
export function makePart(overrides: Partial<CuratedPart> = {}): CuratedPart {
    return { attribute: 'cut', text: 'flat', ...overrides };
}

/**
 * A variant.
 *
 * @param overrides - Field overrides.
 * @returns A variant of item `fdc:101` with one part.
 */
export function makeVariant(overrides: Partial<CuratedVariant> = {}): CuratedVariant {
    return { item: 'fdc:101', parts: [makePart()], ...overrides };
}

/**
 * A root that stands for its own USDA item: its numbers are its item's, so it carries no `nutrition`.
 *
 * @param overrides - Field overrides.
 * @returns Root `fdc:100` "beef brisket" with two variants.
 */
export function makeItemRoot(overrides: Partial<ItemRoot> = {}): ItemRoot {
    return {
        seedKey: 'fdc:100',
        name: 'beef brisket',
        synonyms: ['brisket'],
        item: 'fdc:100',
        variants: [
            makeVariant({
                item: 'fdc:101',
                parts: [makePart({ text: 'flat' }), makePart({ attribute: 'trim', text: '1/8-inch trim' })],
            }),
            makeVariant({ item: 'fdc:102', parts: [makePart({ text: 'point' })] }),
        ],
        ...overrides,
    };
}

/**
 * A citation of one source's entry (R50, KTD-22).
 *
 * @param overrides - Field overrides.
 * @returns An exact citation of USDA Branded product `fdc:2096555`.
 */
export function makeSourceItemCitation(overrides: Partial<SourceItemCitation> = {}): SourceItemCitation {
    return { source: 'usda', key: 'fdc:2096555', match: 'exact', ...overrides };
}

/**
 * A manufacturer's Nutrition Facts label.
 *
 * @param overrides - Field overrides.
 * @returns A label with a gram serving and two printed values.
 */
export function makeLabel(overrides: Partial<ManufacturerLabel> = {}): ManufacturerLabel {
    return {
        source: 'manufacturerLabel',
        url: 'https://example.com/products/adobo',
        retrievedOn: '2026-09-29',
        manufacturer: 'Goya Foods',
        serving: { label: '1/4 tsp', grams: '0.8' },
        perServing: [
            { name: 'Sodium, na', unit: 'mg', amount: '190' },
            { name: 'Energy', unit: 'kcal', amount: '5' },
        ],
        ...overrides,
    };
}

/**
 * A root that stands for no USDA item.
 *
 * @param overrides - Field overrides.
 * @returns Root `curated:absinthe` with no numbers (`nutrition: null`).
 */
export function makeSourcelessRoot(overrides: Partial<SourcelessRoot> = {}): SourcelessRoot {
    return {
        seedKey: 'curated:absinthe',
        name: 'absinthe',
        synonyms: [],
        item: null,
        variants: [],
        nutrition: null,
        ...overrides,
    };
}

/** One root of each nutrition shape (KTD-16): its own item, a USDA citation, a table citation, a label, and none. */
export const EACH_NUTRITION_SHAPE: readonly (ItemRoot | SourcelessRoot)[] = [
    makeItemRoot(),
    makeSourcelessRoot({
        seedKey: 'curated:adobo-seasoning',
        name: 'adobo seasoning',
        nutrition: makeSourceItemCitation(),
    }),
    makeSourcelessRoot({
        seedKey: 'curated:apple-nectar',
        name: 'apple nectar',
        nutrition: makeSourceItemCitation({ source: 'ciqual', key: '2076' }),
    }),
    makeSourcelessRoot({ seedKey: 'curated:goya-sazon', name: 'sazon seasoning', nutrition: makeLabel() }),
    makeSourcelessRoot(),
];

/**
 * The changes that declare {@link makeItemRoot}'s two variants as merges, and nothing else.
 *
 * @param overrides - Field overrides.
 * @returns A cumulative change file.
 */
export function makeCatalogChanges(overrides: Partial<CatalogChanges> = {}): CatalogChanges {
    return {
        merges: [
            { from: 'fdc:101', into: 'fdc:100' },
            { from: 'fdc:102', into: 'fdc:100' },
        ],
        aliases: [],
        exclusions: [],
        splits: [],
        ...overrides,
    };
}

/**
 * Serialize roots as `curatedCatalog.jsonl`.
 *
 * @param roots - Any objects; a refusal case passes shapes the parser must refuse.
 * @returns The JSON-lines text.
 */
export function catalogText(roots: readonly unknown[]): string {
    return roots.map((root) => `${JSON.stringify(root)}\n`).join('');
}

/**
 * Serialize changes as `catalogChanges.json`.
 *
 * @param changes - Any object.
 * @returns The JSON text.
 */
export function changesText(changes: unknown): string {
    return `${JSON.stringify(changes, null, 4)}\n`;
}

/**
 * The facts the baseline reads about one USDA item.
 *
 * @param overrides - Field overrides.
 * @returns An SR Legacy item with energy.
 */
export function makeUsdaItemFacts(overrides: Partial<UsdaItemFacts> = {}): UsdaItemFacts {
    return {
        key: 'fdc:100',
        description: 'Beef, brisket, whole, raw',
        publicationDate: '2019-04-01',
        isFoundation: false,
        hasEnergy: true,
        portions: [],
        nutrients: [],
        ...overrides,
    };
}

/**
 * A cited Branded product.
 *
 * @param overrides - Field overrides.
 * @returns Product 2096555 with a gram serving.
 */
export function makeBrandedProduct(overrides: Partial<BrandedProduct> = {}): BrandedProduct {
    return {
        available_date: '2021-10-28',
        brand_name: '',
        brand_owner: 'GOYA FOODS, INC.',
        branded_food_category: 'Seasoning Mixes, Salts, Marinades & Tenderizers',
        description: 'ADOBO ALL PURPOSE SEASONING',
        fdcId: 2096555,
        gtin_upc: '041331026017',
        household_serving_fulltext: '1/4 tsp',
        market_country: 'United States',
        modified_date: '2021-06-02',
        nutrients: [{ amount: '23750', name: 'Sodium, Na', nutrientId: 1093, unitName: 'MG' }],
        publicationDate: '2021-10-28',
        serving_size: '0.8',
        serving_size_unit: 'g',
        ...overrides,
    };
}

/**
 * One line of a composition table's extract.
 *
 * @param overrides - Field overrides.
 * @returns CIQUAL's apple nectar, per 100 g, with energy.
 */
export function makeExtractLine(overrides: Partial<ExtractLine> = {}): ExtractLine {
    return {
        key: '2076',
        name: 'Apple nectar',
        basis: 'per100g',
        values: { ENERC_KCAL: '52', CHOAVL: '12.4' },
        ...overrides,
    };
}
