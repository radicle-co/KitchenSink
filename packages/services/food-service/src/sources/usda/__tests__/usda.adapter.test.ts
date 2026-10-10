/**
 * Unit tests for {@link UsdaSourceAdapter} (T-121). Exercises the real `UsdaApiClient` with a stubbed
 * `fetch` (no network): searchByName/fetchByKey `fdcId → externalKey` mapping, per-100g nutrient math,
 * nutrient name normalization collapsing case variants into one canonical row (DB-5), reject-not-store
 * on a malformed/invalid value, portion mapping, kind/brand mapping, and error classification.
 *
 * Traceability: FR-IDN-2, FR-023, FR-024, FR-ADP-2, FR-ADP-3.
 */
import { UsdaApiClient } from '@kitchensink/usda-client';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { isAdapterValidationError, isSourceApiError } from '../../foodSource.errors.js';
import { makeBulkFoodBundle, makeBulkLookups } from '../bulk/__fixtures__/usdaBulk.fixtures.js';
import { mapBulkFoodToCanonical } from '../bulk/usdaBulk.parser.js';
import type { BulkPortionRow } from '../bulk/usdaBulk.types.js';
import { UsdaSourceAdapter } from '../usda.adapter.js';
import {
    type UsdaPortionBody,
    makeAbortingFetch,
    makeJsonFetch,
    makeStatusFetch,
    makeUsdaAliasAttributes,
    makeUsdaBrandedLabelBody,
    makeUsdaFoodDetailBody,
    makeUsdaSearchResultBody,
} from '../__fixtures__/usda.fixtures.js';

/** Build an adapter over a real client wired to the given stub fetch. */
function makeAdapter(fetchFn: typeof fetch): UsdaSourceAdapter {
    return new UsdaSourceAdapter(new UsdaApiClient({ apiKey: 'test-key', fetchFn }));
}

describe('UsdaSourceAdapter.searchByName', () => {
    it('maps USDA hits to SourceCandidates with externalKey (from fdcId), never fdcId', async () => {
        const adapter = makeAdapter(makeJsonFetch(makeUsdaSearchResultBody()));

        const candidates = await adapter.searchByName('broccoli');

        expect(candidates).toHaveLength(2);
        expect(candidates[0]).toEqual({
            source: 'usda',
            externalKey: '171688',
            name: 'Broccoli, raw',
            lineageKey: null,
        });
        expect(Object.keys(candidates[0] ?? {})).not.toContain('fdcId');
    });

    // USDA gives an updated food a new FDC id and keeps its NDB number, so a Foundation hit's NDB number links it to
    // the item the seed pinned. Only a Foundation hit gets a key: SR Legacy is frozen, and an SR Legacy item often
    // shares its NDB number with a different Foundation item (broccoli: 747447 and 170379 are both 11090).
    it.each<[string, string | undefined, number | string | undefined, string | null]>([
        ['a Foundation hit', 'Foundation', 11090, 'foundation:11090'],
        ['a Foundation hit whose NDB number is a string', 'Foundation', '11090', 'foundation:11090'],
        ['a Foundation hit with no NDB number', 'Foundation', undefined, null],
        ['an SR Legacy hit with the same NDB number', 'SR Legacy', 11090, null],
        ['an FNDDS hit', 'Survey (FNDDS)', 11090, null],
        ['a Branded hit', 'Branded', 11090, null],
        ['a hit with no data type', undefined, 11090, null],
    ])('gives %s its lineage key', async (_label, dataType, ndbNumber, lineageKey) => {
        const hit = {
            fdcId: 747447,
            description: 'Broccoli, raw',
            ...(dataType === undefined ? {} : { dataType }),
            ...(ndbNumber === undefined ? {} : { ndbNumber }),
        };
        const adapter = makeAdapter(makeJsonFetch(makeUsdaSearchResultBody({ foods: [hit], totalHits: 1 })));

        const [candidate] = await adapter.searchByName('broccoli');

        expect(candidate?.lineageKey).toBe(lineageKey);
    });

    // An item no admitted dataset covers can never be stored (R52), so it must never become a key: asking USDA for the
    // admitted data types alone is what keeps it out of a batch. Pinned to exactly the four, so a change to the
    // client's search statement turns this red here, where the datasets are. The data types travel in the search's
    // JSON body (ADR-0055 point 1).
    it('asks USDA for exactly the data types an admitted dataset covers', async () => {
        const fetchFn = vi.fn(makeJsonFetch(makeUsdaSearchResultBody()));

        await makeAdapter(fetchFn).searchByName('broccoli');

        const sent = fetchFn.mock.calls[0]?.[1]?.body;

        if (typeof sent !== 'string') {
            throw new Error('The adapter sent no search body.');
        }

        const asked = z.object({ dataType: z.array(z.string()) }).parse(JSON.parse(sent)).dataType;

        expect([...asked].sort()).toEqual(['Branded', 'Foundation', 'SR Legacy', 'Survey (FNDDS)']);
    });
});

/**
 * CURATED ALIASES (plan U2 / KTD-2) — the adapter is the boundary that carries USDA's alias table onto
 * the source-agnostic candidate. Nothing downstream may see `foodAttributes` or `foodAttributeType`
 * (FR-ADP-1/FR-IDN-2): the canonical field is `aliases`, a plain ordered list.
 *
 * Mutation lens: reds if the field is dropped, if the WWEIA category attribute leaks in as an alias, if
 * a USDA-native term appears on the candidate, or if a food with no aliases yields anything but `[]`.
 */
describe('UsdaSourceAdapter — curated aliases (U2)', () => {
    it('carries USDA additional descriptions onto the canonical candidate, in rank order', async () => {
        const adapter = makeAdapter(
            makeJsonFetch(
                makeUsdaFoodDetailBody({
                    foodAttributes: makeUsdaAliasAttributes(['sharp cheese', 'Tillamook', 'Longhorn']),
                }),
            ),
        );

        const candidate = await adapter.fetchByKey('171688');

        expect(candidate.aliases).toEqual(['sharp cheese', 'Tillamook', 'Longhorn']);
    });

    it('surfaces no USDA-native attribute term on the canonical candidate', async () => {
        const adapter = makeAdapter(
            makeJsonFetch(makeUsdaFoodDetailBody({ foodAttributes: makeUsdaAliasAttributes(['Tillamook']) })),
        );

        const candidate = await adapter.fetchByKey('171688');

        expect(Object.keys(candidate)).not.toContain('foodAttributes');
        expect(Object.keys(candidate)).not.toContain('additionalDescriptions');
        expect(candidate.aliases).not.toContain('Cheese');
    });

    it('yields an empty list for a food USDA publishes no aliases for (Foundation / SR Legacy)', async () => {
        const adapter = makeAdapter(makeJsonFetch(makeUsdaFoodDetailBody()));

        const candidate = await adapter.fetchByKey('171688');

        expect(candidate.aliases).toEqual([]);
    });

    it('carries them through the BATCH path too — the one the fan-out worker uses', async () => {
        const adapter = makeAdapter(
            makeJsonFetch([makeUsdaFoodDetailBody({ foodAttributes: makeUsdaAliasAttributes(['Tillamook', 'Coon']) })]),
        );

        const [candidate] = await adapter.fetchByKeys(['171688']);

        expect(candidate?.aliases).toEqual(['Tillamook', 'Coon']);
    });
});

describe('UsdaSourceAdapter.fetchByKey — mapToCanonical', () => {
    it('maps fdcId → externalKey and exposes no fdcId on the canonical candidate', async () => {
        const adapter = makeAdapter(makeJsonFetch(makeUsdaFoodDetailBody()));

        const candidate = await adapter.fetchByKey('171688');

        expect(candidate.source).toBe('usda');
        expect(candidate.externalKey).toBe('171688');
        expect(Object.keys(candidate)).not.toContain('fdcId');
    });

    it('produces per-100g nutrients with amounts preserved as strings (SC-008 fidelity)', async () => {
        const adapter = makeAdapter(makeJsonFetch(makeUsdaFoodDetailBody()));

        const candidate = await adapter.fetchByKey('171688');
        const protein = candidate.nutrients.find((n) => n.name === 'Protein');

        expect(protein).toMatchObject({ code: null, name: 'Protein', unit: 'g' });
        expect(protein?.amount).toBe('2.82');
        expect(protein?.basis).toBe('per_100g');
    });

    it('normalizes nutrient names so case variants collapse to ONE canonical row (DB-5)', async () => {
        // Fixture has both 'Protein'/'G' and 'protein'/'g' — they MUST collapse to a single canonical row.
        const adapter = makeAdapter(makeJsonFetch(makeUsdaFoodDetailBody()));

        const candidate = await adapter.fetchByKey('171688');
        const proteinRows = candidate.nutrients.filter((n) => n.name.toLowerCase() === 'protein');

        expect(proteinRows).toHaveLength(1);
        expect(proteinRows[0]?.name).toBe('Protein');
        expect(proteinRows[0]?.unit).toBe('g');
    });

    it('skips nutrients USDA omits a value for (not malformed — just absent)', async () => {
        const adapter = makeAdapter(makeJsonFetch(makeUsdaFoodDetailBody()));

        const candidate = await adapter.fetchByKey('171688');

        // Protein (collapsed) + Energy = 2; the value-less 'Vitamin omitted' row is skipped.
        expect(candidate.nutrients).toHaveLength(2);
        expect(candidate.nutrients.some((n) => n.name === 'Vitamin omitted')).toBe(false);
    });

    it('maps USDA portions to canonical portions', async () => {
        const adapter = makeAdapter(makeJsonFetch(makeUsdaFoodDetailBody()));

        const candidate = await adapter.fetchByKey('171688');

        expect(candidate.portions).toEqual([{ label: '1 cup chopped', gramWeight: '91' }]);
    });

    it.each<[string, UsdaPortionBody, string]>([
        [
            'an SR portion',
            { gramWeight: 113, amount: 4, measureUnit: { name: 'undetermined' }, modifier: 'oz' },
            '4 oz',
        ],
        [
            'an FNDDS portion, by its description and never its portion code',
            { gramWeight: 240, measureUnit: { name: 'undetermined' }, portionDescription: '1 cup', modifier: '10205' },
            '1 cup',
        ],
    ])('labels %s with the amount USDA states', async (_case, portion, label) => {
        const adapter = makeAdapter(makeJsonFetch(makeUsdaFoodDetailBody({ foodPortions: [portion] })));

        const candidate = await adapter.fetchByKey('171688');

        expect(candidate.portions.map((stored) => stored.label)).toEqual([label]);
    });

    it('skips a portion that states no measure, rather than storing a code or a bare unit', async () => {
        const adapter = makeAdapter(
            makeJsonFetch(
                makeUsdaFoodDetailBody({
                    foodPortions: [
                        {
                            gramWeight: 86,
                            measureUnit: { name: 'undetermined' },
                            portionDescription: 'Quantity not specified',
                            modifier: '90000',
                        },
                        { gramWeight: 142, amount: 0, measureUnit: { name: 'undetermined' }, modifier: 'cup' },
                    ],
                }),
            ),
        );

        const candidate = await adapter.fetchByKey('171688');

        expect(candidate.portions).toEqual([]);
    });

    it.each<[string, BulkPortionRow, UsdaPortionBody]>([
        [
            'an SR row',
            {
                amount: '0.5',
                measureUnitId: '9999',
                portionDescription: '',
                modifier: 'cup, chopped',
                gramWeight: '45',
            },
            { amount: 0.5, measureUnit: { name: 'undetermined' }, modifier: 'cup, chopped', gramWeight: 45 },
        ],
        [
            'a Foundation row, whose CSV amount reads `1.0`',
            { amount: '1.0', measureUnitId: '1000', portionDescription: '', modifier: 'chopped', gramWeight: '91' },
            { amount: 1, measureUnit: { name: 'cup' }, modifier: 'chopped', gramWeight: 91 },
        ],
        [
            'an FNDDS row, whose CSV amount is blank and whose API amount is absent',
            { amount: '', measureUnitId: '9999', portionDescription: '1 cup', modifier: '10205', gramWeight: '240' },
            { measureUnit: { name: 'undetermined' }, portionDescription: '1 cup', modifier: '10205', gramWeight: 240 },
        ],
    ])('labels %s the same from the bulk file and the live API', async (_case, bulkRow, livePortion) => {
        const bulk = mapBulkFoodToCanonical(makeBulkFoodBundle({ portions: [bulkRow] }), makeBulkLookups());
        const live = await makeAdapter(
            makeJsonFetch(makeUsdaFoodDetailBody({ foodPortions: [livePortion] })),
        ).fetchByKey('171688');

        expect(bulk?.portions).toHaveLength(1);
        expect(live.portions).toEqual(bulk?.portions);
    });

    it('maps a Branded record to kind=branded and carries the brand owner', async () => {
        const body = makeUsdaFoodDetailBody({
            dataType: 'Branded',
            brandOwner: 'Acme Foods',
            gtinUpc: '0123456789012',
        });
        const adapter = makeAdapter(makeJsonFetch(body));

        const candidate = await adapter.fetchByKey('171688');

        expect(candidate.kind).toBe('branded');
        expect(candidate.brandOwner).toBe('Acme Foods');
        expect(candidate.barcode).toBe('0123456789012');
    });

    it('derives itemVersion from the publication date for change-refresh (FR-032)', async () => {
        const adapter = makeAdapter(makeJsonFetch(makeUsdaFoodDetailBody({ publicationDate: '2019-04-01' })));

        const candidate = await adapter.fetchByKey('171688');

        expect(candidate.itemVersion).toBe('2019-04-01');
    });

    it('reject-not-store: a negative nutrient amount rejects the whole candidate (AdapterValidationError)', async () => {
        const body = makeUsdaFoodDetailBody({
            foodNutrients: [{ nutrientId: 1004, nutrientName: 'Total fat', unitName: 'G', value: -5 }],
        });
        const adapter = makeAdapter(makeJsonFetch(body));

        let thrown: unknown;

        try {
            await adapter.fetchByKey('171688');
        } catch (error) {
            thrown = error;
        }

        expect(isAdapterValidationError(thrown)).toBe(true);
    });

    it('rejects a non-numeric external key before any fetch (AdapterValidationError)', async () => {
        const adapter = makeAdapter(makeJsonFetch(makeUsdaFoodDetailBody()));

        let thrown: unknown;

        try {
            await adapter.fetchByKey('not-a-number');
        } catch (error) {
            thrown = error;
        }

        expect(isAdapterValidationError(thrown)).toBe(true);
    });
});

describe('UsdaSourceAdapter — the dataset a candidate cites (curated catalog plan U4, KTD-22)', () => {
    it.each([
        ['Foundation', 'usdaSrFoundation'],
        ['SR Legacy', 'usdaSrFoundation'],
        ['Survey (FNDDS)', 'usdaFndds'],
        ['Branded', 'usdaBranded'],
    ])('maps a %s item to the %s dataset', async (dataType, dataset) => {
        const adapter = makeAdapter(makeJsonFetch(makeUsdaFoodDetailBody({ dataType })));

        expect((await adapter.fetchByKey('171688')).dataset).toBe(dataset);
    });

    it.each([['Experimental'], [undefined]])(
        'refuses an item of data type %s, which no admitted dataset covers (R52), naming the field',
        async (dataType) => {
            const adapter = makeAdapter(makeJsonFetch(makeUsdaFoodDetailBody({ dataType })));
            const thrown = await adapter.fetchByKey('171688').then(
                () => undefined,
                (error: unknown) => error,
            );

            expect(isAdapterValidationError(thrown)).toBe(true);
            expect(isAdapterValidationError(thrown) ? thrown.field : undefined).toBe('dataType');
        },
    );
});

describe('UsdaSourceAdapter.fetchByKey — branded labelNutrients (per-serving panel, D-PERSERVING)', () => {
    it('converts a gram-serving labelNutrients panel to per-100g (amount = label * 100 / servingSizeGrams)', async () => {
        // 30 g serving: protein 6 → 20, fat 9 → 30, calories 45 → 150 per 100 g.
        const adapter = makeAdapter(makeJsonFetch(makeUsdaBrandedLabelBody({ servingSize: 30, servingSizeUnit: 'g' })));

        const candidate = await adapter.fetchByKey('555001');
        const protein = candidate.nutrients.find((nutrient) => nutrient.name === 'Protein');
        const energy = candidate.nutrients.find((nutrient) => nutrient.name === 'Energy');

        expect(protein?.amount).toBe('20');
        expect(protein?.basis).toBe('per_100g');
        expect(energy?.amount).toBe('150');
        expect(energy?.basis).toBe('per_100g');
    });

    it('keeps a NON-gram (ml) serving panel as basis=per_serving with the label value preserved (no ml=g assumption)', async () => {
        const adapter = makeAdapter(
            makeJsonFetch(
                makeUsdaBrandedLabelBody({
                    servingSize: 240,
                    servingSizeUnit: 'ml',
                    labelNutrients: { protein: { value: 8 } },
                }),
            ),
        );

        const candidate = await adapter.fetchByKey('555001');
        const protein = candidate.nutrients.find((nutrient) => nutrient.name === 'Protein');

        expect(protein).toMatchObject({ code: null, name: 'Protein', unit: 'g' });
        expect(protein?.basis).toBe('per_serving');
        expect(protein?.amount).toBe('8');
    });

    it('prefers USDA per-100g foodNutrients over the label panel (label not double-counted)', async () => {
        const adapter = makeAdapter(
            makeJsonFetch(
                makeUsdaBrandedLabelBody({
                    servingSize: 30,
                    servingSizeUnit: 'g',
                    // USDA already shipped per-100g foodNutrients for Energy + Protein.
                    foodNutrients: [
                        { nutrientId: 1008, nutrientName: 'Energy', unitName: 'KCAL', value: 380 },
                        { nutrientId: 1003, nutrientName: 'Protein', unitName: 'G', value: 12 },
                    ],
                    // The label panel repeats Energy + Protein — these MUST NOT override or duplicate.
                    labelNutrients: { calories: { value: 45 }, protein: { value: 6 } },
                }),
            ),
        );

        const candidate = await adapter.fetchByKey('555001');
        const energyRows = candidate.nutrients.filter((nutrient) => nutrient.name === 'Energy');
        const proteinRows = candidate.nutrients.filter((nutrient) => nutrient.name === 'Protein');

        expect(energyRows).toHaveLength(1);
        expect(energyRows[0]?.amount).toBe('380');
        expect(energyRows[0]?.basis).toBe('per_100g');
        expect(proteinRows).toHaveLength(1);
        expect(proteinRows[0]?.amount).toBe('12');
        expect(proteinRows[0]?.basis).toBe('per_100g');
    });

    it('reject-not-store: a malformed (negative) label value rejects the whole candidate', async () => {
        const adapter = makeAdapter(
            makeJsonFetch(
                makeUsdaBrandedLabelBody({
                    servingSize: 30,
                    servingSizeUnit: 'g',
                    foodNutrients: [],
                    labelNutrients: { protein: { value: -5 } },
                }),
            ),
        );

        let thrown: unknown;

        try {
            await adapter.fetchByKey('555001');
        } catch (error) {
            thrown = error;
        }

        expect(isAdapterValidationError(thrown)).toBe(true);
    });
});

describe('UsdaSourceAdapter — error classification', () => {
    it('classifies a 429 as SourceApiError(statusCode=429)', async () => {
        const adapter = makeAdapter(makeStatusFetch(429));

        let thrown: unknown;

        try {
            await adapter.fetchByKey('171688');
        } catch (error) {
            thrown = error;
        }

        expect(isSourceApiError(thrown)).toBe(true);
        expect((thrown as SourceApiErrorLike).statusCode).toBe(429);
    });

    it('classifies a 404 as SourceApiError(statusCode=404)', async () => {
        const adapter = makeAdapter(makeStatusFetch(404));

        let thrown: unknown;

        try {
            await adapter.fetchByKey('171688');
        } catch (error) {
            thrown = error;
        }

        expect(isSourceApiError(thrown)).toBe(true);
        expect((thrown as SourceApiErrorLike).statusCode).toBe(404);
    });

    it('classifies a 503 as SourceApiError(statusCode=503)', async () => {
        const adapter = makeAdapter(makeStatusFetch(503));

        let thrown: unknown;

        try {
            await adapter.fetchByKey('171688');
        } catch (error) {
            thrown = error;
        }

        expect(isSourceApiError(thrown)).toBe(true);
        expect((thrown as SourceApiErrorLike).statusCode).toBe(503);
    });

    it('classifies a timeout as SourceApiError(statusCode=0)', async () => {
        const adapter = makeAdapter(makeAbortingFetch());

        let thrown: unknown;

        try {
            await adapter.searchByName('broccoli');
        } catch (error) {
            thrown = error;
        }

        expect(isSourceApiError(thrown)).toBe(true);
        expect((thrown as SourceApiErrorLike).statusCode).toBe(0);
    });

    it('classifies a 2xx schema drift as SourceApiError(statusCode=422), distinct from a gateway 502', async () => {
        // A 200 whose body fails the modelled shape → UsdaSchemaError → classified 422 (NOT 502) so the
        // consumer fails persistent corruption instead of deferring it as transient gateway backpressure.
        const adapter = makeAdapter(makeJsonFetch({ totalHits: 1, foods: [{ description: 'no fdcId' }] }));

        let thrown: unknown;

        try {
            await adapter.searchByName('broccoli');
        } catch (error) {
            thrown = error;
        }

        expect(isSourceApiError(thrown)).toBe(true);
        expect((thrown as SourceApiErrorLike).statusCode).toBe(422);
    });
});

/** Narrow shape used only to read `statusCode` off a classified error in assertions. */
interface SourceApiErrorLike {
    statusCode: number;
}
