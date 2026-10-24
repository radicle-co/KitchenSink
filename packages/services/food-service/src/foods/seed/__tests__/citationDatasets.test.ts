/**
 * The datasets a root's numbers can come from (plan R50, KTD-22). A candidate names its dataset, never only its
 * source: USDA alone has three datasets that rank apart, and inferring one from where an id happens to be found let a
 * mistyped FDC id that names an SR Legacy item become the top-ranked candidate unnoticed.
 */
import { describe, expect, it } from 'vitest';

import { REGISTERED_SOURCE_IDS } from '../../../sources/sourceRegister.js';
import {
    CITATION_DATASETS,
    DATASET_SOURCE,
    TABLE_DATASETS,
    TABLE_DATASET_SOURCE,
    datasetsOfSource,
    isTableDataset,
} from '../citationDatasets.js';

describe('CITATION_DATASETS', () => {
    it('orders the datasets as R50 states, with a Branded product and a label last', () => {
        expect(CITATION_DATASETS).toEqual([
            'usdaSrFoundation',
            'usdaFndds',
            'ciqual',
            'cofid',
            'bls',
            'stfcj',
            'matvaretabellen',
            'livsmedelsverket',
            'fsvo',
            'cnf',
            'usdaBranded',
            'label',
        ]);
    });
});

describe('DATASET_SOURCE', () => {
    it('names USDA for its three datasets and the manufacturer for a label', () => {
        expect(DATASET_SOURCE.usdaSrFoundation).toBe('usda');
        expect(DATASET_SOURCE.usdaFndds).toBe('usda');
        expect(DATASET_SOURCE.usdaBranded).toBe('usda');
        expect(DATASET_SOURCE.label).toBe('manufacturerLabel');
    });

    it('agrees with the table datasets’ own sources', () => {
        for (const dataset of TABLE_DATASETS) {
            expect(DATASET_SOURCE[dataset]).toBe(TABLE_DATASET_SOURCE[dataset]);
        }

        expect(TABLE_DATASET_SOURCE.usdaFndds).toBe('usda');
    });

    it('reaches every registered source, so no source is unreachable from a candidate', () => {
        const reached = new Set(Object.values(DATASET_SOURCE));

        expect(REGISTERED_SOURCE_IDS.filter((source) => !reached.has(source))).toEqual([]);
    });
});

describe('TABLE_DATASETS', () => {
    it('lists the datasets read from a committed extract: FNDDS and every other table', () => {
        expect(TABLE_DATASETS).toEqual([
            'usdaFndds',
            'ciqual',
            'cofid',
            'bls',
            'stfcj',
            'matvaretabellen',
            'livsmedelsverket',
            'fsvo',
            'cnf',
        ]);
    });

    it.each(['usdaSrFoundation', 'usdaBranded', 'label', 'nevo'])('does not count %s as a table dataset', (dataset) => {
        expect(isTableDataset(dataset)).toBe(false);
    });

    it('counts FNDDS and CIQUAL as table datasets', () => {
        expect(isTableDataset('usdaFndds')).toBe(true);
        expect(isTableDataset('ciqual')).toBe(true);
    });
});

describe('datasetsOfSource — the inverse of DATASET_SOURCE (curated plan U8 S4)', () => {
    it('answers every dataset a source publishes, in precedence order', () => {
        expect(datasetsOfSource('usda')).toStrictEqual(['usdaSrFoundation', 'usdaFndds', 'usdaBranded']);
    });

    it('answers a table source’s one dataset', () => {
        expect(datasetsOfSource('ciqual')).toStrictEqual(['ciqual']);
    });

    it('is the exact inverse: every dataset is answered for its own source and no other', () => {
        for (const dataset of CITATION_DATASETS) {
            const owners = [...REGISTERED_SOURCE_IDS, 'manufacturerLabel' as const].filter((source) =>
                datasetsOfSource(source).includes(dataset),
            );

            expect(owners, dataset).toStrictEqual([DATASET_SOURCE[dataset]]);
        }
    });
});
