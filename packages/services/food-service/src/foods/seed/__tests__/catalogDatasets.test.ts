/**
 * Unit suite for the catalog dataset ROSTER (U12b) — the configuration that decides which USDA bulk
 * `data_type`s the reseed imports, and whether the reseed should expect curated aliases to land.
 *
 * ⚠️ THE POINT OF THESE TESTS IS THE FNDDS CONSEQUENCE, NOT THE GETTERS. U2 measured that USDA publishes
 * "additional descriptions" ONLY for Survey (FNDDS) foods; the two datasets this roster enables
 * (`foundation_food`, `sr_legacy_food`) carry none. So after a reseed the `food.aliases` column is NULL
 * across the WHOLE bulk catalog, and the assertions below pin that as a deliberate, recorded state rather
 * than an accident — `expectsAliases(CATALOG_DATASETS)` is `false` today, on purpose, and that is what
 * keeps the reseed's alias post-condition quiet. Whether to seed FNDDS is a PRODUCT decision (composite
 * prepared dishes competing with ingredient rows) and is deliberately not taken here.
 */
import { describe, expect, it } from 'vitest';

import { CATALOG_DATASETS, enabledDataTypes, expectsAliases, type CatalogDataset } from '../catalogDatasets.js';

/** A roster entry; each test overrides only the field it is about. */
function makeDataset(overrides: Partial<CatalogDataset> = {}): CatalogDataset {
    return {
        id: 'foundation',
        dataType: 'foundation_food',
        enabled: true,
        carriesAliases: false,
        why: 'test fixture',
        ...overrides,
    };
}

describe('catalog dataset roster (U12b)', () => {
    describe('the shipped roster', () => {
        it('enables Foundation + SR Legacy and nothing else', () => {
            expect(enabledDataTypes(CATALOG_DATASETS)).toEqual(['foundation_food', 'sr_legacy_food']);
        });

        it('carries Survey (FNDDS) as a DISABLED entry rather than omitting it', () => {
            const fndds = CATALOG_DATASETS.find((dataset) => dataset.dataType === 'survey_fndds_food');

            expect(fndds).toBeDefined();
            expect(fndds?.enabled).toBe(false);
        });

        it('records that FNDDS is the ONLY roster entry carrying curated aliases', () => {
            const aliasCarrying = CATALOG_DATASETS.filter((dataset) => dataset.carriesAliases).map(
                (dataset) => dataset.dataType,
            );

            expect(aliasCarrying).toEqual(['survey_fndds_food']);
        });

        it('⚠️ expects NO aliases from the shipped roster — the reseed leaves food.aliases NULL', () => {
            expect(expectsAliases(CATALOG_DATASETS)).toBe(false);
        });

        it('gives every entry a written reason, so a flip is a decision and not a typo', () => {
            for (const dataset of CATALOG_DATASETS) {
                expect(dataset.why.length).toBeGreaterThan(40);
            }
        });

        it('names each data type exactly once', () => {
            const dataTypes = CATALOG_DATASETS.map((dataset) => dataset.dataType);

            expect(new Set(dataTypes).size).toBe(dataTypes.length);
        });
    });

    describe('enabledDataTypes', () => {
        it('drops disabled entries and preserves roster order', () => {
            const roster = [
                makeDataset({ id: 'srLegacy', dataType: 'sr_legacy_food' }),
                makeDataset({ id: 'surveyFndds', dataType: 'survey_fndds_food', enabled: false }),
                makeDataset({ id: 'foundation', dataType: 'foundation_food' }),
            ];

            expect(enabledDataTypes(roster)).toEqual(['sr_legacy_food', 'foundation_food']);
        });

        it('is empty when nothing is enabled (the reseed refuses on that, rather than seeding nothing)', () => {
            expect(enabledDataTypes([makeDataset({ enabled: false })])).toEqual([]);
        });
    });

    describe('expectsAliases', () => {
        it('is true only when an ENABLED entry claims to carry aliases', () => {
            expect(expectsAliases([makeDataset({ carriesAliases: true })])).toBe(true);
        });

        it('ignores a disabled alias-carrying entry — a roster is not a promise about rows it excludes', () => {
            expect(expectsAliases([makeDataset({ carriesAliases: true, enabled: false })])).toBe(false);
        });

        it('is false for an empty roster', () => {
            expect(expectsAliases([])).toBe(false);
        });
    });
});
