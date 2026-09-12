/**
 * The extractor registry (plan U23): every table dataset has an entry, so adding a dataset forces a decision here,
 * and a dataset with no extractor says why.
 */
import { describe, expect, it } from 'vitest';

import { TABLE_DATASETS } from '../../citationDatasets.js';
import { TABLE_EXTRACTORS } from '../tableExtractors.js';

describe('TABLE_EXTRACTORS', () => {
    it('has an entry for exactly the table datasets', () => {
        expect(Object.keys(TABLE_EXTRACTORS).sort()).toEqual([...TABLE_DATASETS].sort());
    });

    it('names the operator download each source without an extractor waits for', () => {
        const waiting = Object.entries(TABLE_EXTRACTORS).filter(([, entry]) => entry.kind === 'awaitingUpstream');

        expect(waiting.map(([source]) => source).sort()).toEqual(['bls', 'fsvo', 'livsmedelsverket']);

        for (const [, entry] of waiting) {
            expect(entry.kind === 'awaitingUpstream' && entry.reason).toMatch(/download/u);
        }
    });

    it('gives every extractor at least one role', () => {
        for (const entry of Object.values(TABLE_EXTRACTORS)) {
            if (entry.kind === 'extractor') {
                expect(entry.extractor.roles.length).toBeGreaterThan(0);
            }
        }
    });
});
