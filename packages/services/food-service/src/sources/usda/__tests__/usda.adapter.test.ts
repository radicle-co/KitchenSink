/**
 * Unit tests for {@link UsdaSourceAdapter} (T-121). Exercises the real `UsdaApiClient` with a stubbed
 * `fetch` (no network): searchByName/fetchByKey `fdcId → externalKey` mapping, per-100g nutrient math,
 * nutrient name normalization collapsing case variants into one canonical row (DB-5), reject-not-store
 * on a malformed/invalid value, portion mapping, kind/brand mapping, and error classification.
 *
 * Traceability: FR-IDN-2, FR-023, FR-024, FR-ADP-2, FR-ADP-3.
 */
import { UsdaApiClient } from '@kitchensink/usda-client';
import { describe, expect, it } from 'vitest';

import { isAdapterValidationError, isSourceApiError } from '../../food-source-adapter.js';
import { UsdaSourceAdapter } from '../usda.adapter.js';
import {
    makeAbortingFetch,
    makeJsonFetch,
    makeStatusFetch,
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
        expect(candidates[0]).toEqual({ source: 'usda', externalKey: '171688', name: 'Broccoli, raw' });
        expect(Object.keys(candidates[0] ?? {})).not.toContain('fdcId');
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

        expect(protein).toBeDefined();
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
});

/** Narrow shape used only to read `statusCode` off a classified error in assertions. */
interface SourceApiErrorLike {
    statusCode: number;
}
