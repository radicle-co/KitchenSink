/**
 * `GET /api/v1/foods/{id}` lists a root's live variants (curated catalog plan U8 S2, R17, KTD-15).
 *
 * Unit tier: the service over doubled DAOs. What the variant DAO's SQL returns against a migrated schema is the LOCAL
 * e2e tier's job (`tests/e2e/catalogReadModel.e2e.test.ts`).
 */
import { describe, expect, it, vi } from 'vitest';

import type { CatalogOwner, CatalogOwnerReader, SourceKeyRef } from '../catalogOwnerReader.service.js';
import type { FoodDao, GoldenFoodRecord } from '../dao/food.dao.js';
import type { FoodSearchDao, SearchHit } from '../dao/foodSearch.dao.js';
import type { FoodSourcesDao } from '../dao/foodSources.dao.js';
import type { FoodVariantDao, LiveVariant } from '../dao/foodVariant.dao.js';
import { FoodsService } from '../foods.service.js';
import { FoodMetrics } from '../../observability/emfMetrics.js';

const ROOT_ID = '01JROOT0000000000000000000';
const AUTHOR = '01JAUTHOR00000000000000000';

/** A resolved catalog root with no nutrients of its own. */
function makeRoot(overrides: Partial<GoldenFoodRecord> = {}): GoldenFoodRecord {
    return {
        id: ROOT_ID,
        name: 'beef brisket',
        description: null,
        kind: 'generic',
        brandOwner: null,
        brandName: null,
        barcode: null,
        status: 'RESOLVED',
        tombstonedAt: null,
        createdAt: '2026-09-30T00:00:00.000Z',
        updatedAt: '2026-09-30T00:00:00.000Z',
        sources: [],
        nutrients: [],
        portions: [],
        fieldProvenance: [],
        userId: null,
        visibility: 'public',
        ...overrides,
    };
}

/** A live variant as the DAO returns it, with its own nutrition. */
function makeVariant(overrides: Partial<LiveVariant> = {}): LiveVariant {
    return {
        id: '01JVARIANT0000000000000001',
        rootId: ROOT_ID,
        itemId: 'item-variant-1',
        parts: [
            { attribute: 'cut', ordinal: 0, text: 'flat' },
            { attribute: 'cookingMethod', ordinal: 0, text: 'braised' },
        ],
        nutrients: [
            {
                nutrient: 'Energy (atwater specific factors)',
                infoodsTag: null,
                unit: 'kcal',
                basis: 'per_100g',
                amount: '211',
                trace: false,
            },
        ],
        ...overrides,
    };
}

/** The service with only the collaborators `getFood` touches; the rest are absent. */
function makeService(
    record: GoldenFoodRecord,
    variants: readonly LiveVariant[],
): { service: FoodsService; listLive: ReturnType<typeof vi.fn> } {
    const foodDao = { readGoldenRecord: vi.fn().mockResolvedValue(record) };
    const listLive = vi.fn().mockResolvedValue(variants);
    const variantDao: Pick<FoodVariantDao, 'listLive'> = { listLive };
    const unused = undefined as never;
    const service = new FoodsService(
        foodDao as unknown as FoodDao,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        new FoodMetrics(() => undefined),
        unused,
        variantDao as FoodVariantDao,
        unused,
    );

    return { service, listLive };
}

describe('getFood — a root lists its live variants (R17)', () => {
    it('reads the root’s live variants with their nutrition, and publishes parts and calories', async () => {
        const { service, listLive } = makeService(makeRoot(), [makeVariant()]);

        const response = await service.getFood(ROOT_ID, AUTHOR);

        expect(listLive).toHaveBeenCalledWith([ROOT_ID], { withNutrition: true });
        expect(response.variants).toStrictEqual([
            {
                id: '01JVARIANT0000000000000001',
                parts: [
                    { attribute: 'cut', text: 'flat' },
                    { attribute: 'cookingMethod', text: 'braised' },
                ],
                caloriesPer100g: 211,
            },
        ]);
    });

    it('keeps the DAO’s variant and part order — the dialog’s list order', async () => {
        const first = makeVariant({ id: 'V-1', parts: [{ attribute: 'cut', ordinal: 0, text: 'point' }] });
        const second = makeVariant({ id: 'V-2', parts: [{ attribute: 'cut', ordinal: 0, text: 'flat' }] });
        const { service } = makeService(makeRoot(), [first, second]);

        const response = await service.getFood(ROOT_ID, AUTHOR);

        expect(response.variants.map((variant) => variant.id)).toStrictEqual(['V-1', 'V-2']);
    });

    it('omits calories for a variant whose nutrition states no energy — absent, never 0 (R18)', async () => {
        const { service } = makeService(makeRoot(), [makeVariant({ nutrients: [] })]);

        const [variant] = (await service.getFood(ROOT_ID, AUTHOR)).variants;

        expect(variant).toBeDefined();
        expect(variant).not.toHaveProperty('caloriesPer100g');
    });

    it('answers [] for a root with no live variants', async () => {
        const { service } = makeService(makeRoot(), []);

        expect((await service.getFood(ROOT_ID, AUTHOR)).variants).toStrictEqual([]);
    });

    it('answers [] for an authored food without reading variants — an authored food has none', async () => {
        const { service, listLive } = makeService(makeRoot({ userId: AUTHOR, visibility: 'private' }), [makeVariant()]);

        const response = await service.getFood(ROOT_ID, AUTHOR);

        expect(response.variants).toStrictEqual([]);
        expect(listLive).not.toHaveBeenCalled();
    });

    it('never publishes a part’s ordinal or a variant’s item — the wire carries attribute and text only', async () => {
        const { service } = makeService(makeRoot(), [makeVariant()]);

        const text = JSON.stringify((await service.getFood(ROOT_ID, AUTHOR)).variants);

        expect(text).not.toContain('ordinal');
        expect(text).not.toContain('itemId');
        expect(text).not.toContain('item-variant-1');
    });
});

/** The service with the collaborators `search` touches. */
function makeSearchService(options: {
    hits: readonly SearchHit[];
    variants?: readonly LiveVariant[];
    barcodeFood?: { readonly id: string; readonly name: string | null };
    owner?: CatalogOwner;
    /** What the catalog gate reads for the owner's root; by default it admits the root under its own name. */
    listedRoot?: { readonly id: string; readonly name: string | null } | null;
}): { service: FoodsService; listLive: ReturnType<typeof vi.fn>; ownersOfKeys: ReturnType<typeof vi.fn> } {
    const searchDao = { search: vi.fn().mockResolvedValue([...options.hits]) };
    const admitted =
        options.owner === undefined ? undefined : { id: options.owner.rootId, name: options.owner.rootName };
    const sources = {
        findCatalogFoodByBarcode: vi.fn().mockResolvedValue(options.barcodeFood),
        findCatalogFoodById: vi
            .fn()
            .mockResolvedValue(options.listedRoot === undefined ? admitted : (options.listedRoot ?? undefined)),
    };
    const foodDao = { nutrientRowsFor: vi.fn().mockResolvedValue([]) };
    const listLive = vi.fn().mockResolvedValue([...(options.variants ?? [])]);
    const ownersOfKeys = vi.fn(async (_source: string, keys: readonly SourceKeyRef[]) =>
        options.owner === undefined ? new Map() : new Map(keys.map((key) => [key.externalKey, options.owner])),
    );
    const unused = undefined as never;
    const service = new FoodsService(
        foodDao as unknown as FoodDao,
        unused,
        sources as unknown as FoodSourcesDao,
        searchDao as unknown as FoodSearchDao,
        unused,
        unused,
        unused,
        new FoodMetrics(() => undefined),
        unused,
        { listLive } as unknown as FoodVariantDao,
        { ownersOfKeys } as unknown as CatalogOwnerReader,
    );

    return { service, listLive, ownersOfKeys };
}

/** A catalog hit for brisket. */
function brisketHit(overrides: Partial<SearchHit> = {}): SearchHit {
    return {
        id: ROOT_ID,
        name: 'beef brisket',
        aliases: 'first cut brisket',
        score: 0.8,
        visibility: 'public',
        userId: null,
        ...overrides,
    };
}

const FLAT = makeVariant({ id: 'V-flat', parts: [{ attribute: 'cut', ordinal: 0, text: 'flat' }], nutrients: [] });
const POINT = makeVariant({ id: 'V-point', parts: [{ attribute: 'cut', ordinal: 0, text: 'point' }], nutrients: [] });

describe('search — the variant a query names rides its root’s hit (R15, R16, AE3)', () => {
    it('AE3: a query naming one variant returns the root carrying that variant', async () => {
        const { service, listLive } = makeSearchService({ hits: [brisketHit()], variants: [FLAT, POINT] });

        const { results } = await service.search('beef brisket flat', AUTHOR);

        expect(listLive).toHaveBeenCalledWith([ROOT_ID], { withNutrition: false });
        expect(results).toStrictEqual([
            {
                id: ROOT_ID,
                name: 'beef brisket',
                score: 0.8,
                variant: { id: 'V-flat', parts: [{ attribute: 'cut', text: 'flat' }] },
            },
        ]);
    });

    it('AE3: two variants named, or none, return the root alone', async () => {
        const { service } = makeSearchService({ hits: [brisketHit()], variants: [FLAT, POINT] });

        const [both] = (await service.search('beef brisket flat point', AUTHOR)).results;

        expect(both).not.toHaveProperty('variant');
    });

    it('AE2: a query that IS a synonym leaves no words, so no variant is read', async () => {
        const { service, listLive } = makeSearchService({ hits: [brisketHit()], variants: [FLAT, POINT] });

        const { results } = await service.search('first cut brisket', AUTHOR);

        expect(results.map((result) => result.name)).toStrictEqual(['beef brisket']);
        expect(results[0]).not.toHaveProperty('variant');
        expect(listLive).not.toHaveBeenCalled();
    });

    it('reads every hit’s variants in ONE call, and only for hits whose query leaves words', async () => {
        const other = brisketHit({ id: 'R-2', name: 'beef brisket flat', aliases: null });
        const { service, listLive } = makeSearchService({ hits: [brisketHit(), other], variants: [FLAT] });

        await service.search('beef brisket flat', AUTHOR);

        expect(listLive).toHaveBeenCalledTimes(1);
        expect(listLive).toHaveBeenCalledWith([ROOT_ID], { withNutrition: false });
    });

    it('never reads variants for an authored hit — an authored food has none', async () => {
        const mine = brisketHit({ userId: AUTHOR, visibility: 'private' });
        const { service, listLive } = makeSearchService({ hits: [mine], variants: [FLAT] });

        const [result] = (await service.search('beef brisket flat', AUTHOR)).results;

        expect(result).not.toHaveProperty('variant');
        expect(listLive).not.toHaveBeenCalled();
    });

    it('attaches a variant only to its own root', async () => {
        const otherRoot = makeVariant({
            id: 'V-x',
            rootId: 'R-OTHER',
            parts: [{ attribute: 'cut', ordinal: 0, text: 'flat' }],
        });
        const { service } = makeSearchService({ hits: [brisketHit()], variants: [otherRoot] });

        const [result] = (await service.search('beef brisket flat', AUTHOR)).results;

        expect(result).not.toHaveProperty('variant');
    });
});

// Plan 002 S3 moved "a retired root is never a barcode hit" into the crosswalk's own SQL (`findCatalogFoodByBarcode`,
// pinned by `dao/__tests__/foodSources.dao.test.ts` and against a real database by
// `tests/e2e/catalogSearchPrivacy.e2e.test.ts`), so the service no longer reads the row a second time to check it.
describe('search — a barcode unshift (curated U8 S3, plan 002 S3)', () => {
    it('unshifts nothing when the crosswalk names no live catalog food', async () => {
        const { service } = makeSearchService({ hits: [] });

        expect((await service.search('0123456789012', AUTHOR)).results).toStrictEqual([]);
    });

    it('unshifts the live catalog food the crosswalk names, at score 1', async () => {
        const { service } = makeSearchService({ hits: [], barcodeFood: { id: 'R-LIVE', name: 'beef brisket' } });

        expect((await service.search('0123456789012', AUTHOR)).results).toStrictEqual([
            { id: 'R-LIVE', name: 'beef brisket', score: 1 },
        ]);
    });
});

describe('search — a source-key unshift reads through the owner reader (curated U8 S4, R19)', () => {
    const VARIANT_OWNER: CatalogOwner = {
        kind: 'variant',
        id: 'V-flat',
        rootId: ROOT_ID,
        rootName: 'beef brisket',
        seedOwned: true,
        parts: [{ attribute: 'cut', ordinal: 0, text: 'flat' }],
    };

    it('⛔ R19: unshifts a variant-owned key as its ROOT, carrying the variant, at score 1', async () => {
        const { service, ownersOfKeys } = makeSearchService({ hits: [], owner: VARIANT_OWNER });

        expect((await service.search('174532', AUTHOR)).results).toStrictEqual([
            {
                id: ROOT_ID,
                name: 'beef brisket',
                score: 1,
                variant: { id: 'V-flat', parts: [{ attribute: 'cut', text: 'flat' }] },
            },
        ]);
        expect(ownersOfKeys).toHaveBeenCalledWith('usda', [{ externalKey: '174532', lineageKey: null }]);
    });

    it('unshifts nothing when no live catalog entry stands for the key', async () => {
        const { service } = makeSearchService({ hits: [] });

        expect((await service.search('174532', AUTHOR)).results).toStrictEqual([]);
    });

    // sec-aud-1 S3 review, F1: the per-caller search shares the crosswalk, so the catalog gate binds it too.
    it('⛔ unshifts nothing when the catalog gate does not admit the root the owner reader named', async () => {
        const { service } = makeSearchService({ hits: [], owner: VARIANT_OWNER, listedRoot: null });

        expect((await service.search('174532', AUTHOR)).results).toStrictEqual([]);
    });

    it('never duplicates a root the ranked hits already hold', async () => {
        const { service } = makeSearchService({
            hits: [brisketHit()],
            owner: { ...VARIANT_OWNER, kind: 'root', id: ROOT_ID, parts: [] },
        });

        expect((await service.search('174531', AUTHOR)).results.map((result) => result.id)).toStrictEqual([ROOT_ID]);
    });
});
