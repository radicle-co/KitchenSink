/**
 * The one statement of how USDA is searched (ADR-0055 point 1). Food-service's add-by-name and the remote search
 * service both search through `UsdaApiClient.searchFoods`, which reads only this statement, so the two cannot ask USDA
 * for different candidates.
 */
import { describe, expect, it } from 'vitest';

import { isUsdaSearchedDataType, USDA_SEARCH_PARAMETERS } from '../searchParameters.js';
import { USDA_DATA_TYPES } from '../types.js';
import { USDA_MAX_BATCH_SIZE } from '../UsdaApiClient.js';

describe('USDA_SEARCH_PARAMETERS', () => {
    it('searches the four data types the catalog can cite, and never Experimental', () => {
        expect(USDA_SEARCH_PARAMETERS.dataTypes).toStrictEqual([
            'Foundation',
            'SR Legacy',
            'Survey (FNDDS)',
            'Branded',
        ]);
    });

    it('asks for one page the size of one batch fetch', () => {
        expect(USDA_SEARCH_PARAMETERS.pageSize).toBe(USDA_MAX_BATCH_SIZE);
    });

    it('cannot be changed at run time by either caller', () => {
        expect(Object.isFrozen(USDA_SEARCH_PARAMETERS)).toBe(true);
        expect(Object.isFrozen(USDA_SEARCH_PARAMETERS.dataTypes)).toBe(true);
    });
});

describe('isUsdaSearchedDataType', () => {
    it.each<[unknown, boolean]>([
        ...USDA_SEARCH_PARAMETERS.dataTypes.map((dataType): [unknown, boolean] => [dataType, true]),
        ['Experimental', false],
        ['foundation', false],
        ['Agricultural Acquisition', false],
        ['', false],
        [undefined, false],
        [null, false],
        [1, false],
    ])('answers %j with %j', (value, expected) => {
        expect(isUsdaSearchedDataType(value)).toBe(expected);
    });

    it('admits only data types the client knows', () => {
        const known: readonly unknown[] = USDA_DATA_TYPES;

        expect(USDA_SEARCH_PARAMETERS.dataTypes.every((dataType) => known.includes(dataType))).toBe(true);
    });
});
