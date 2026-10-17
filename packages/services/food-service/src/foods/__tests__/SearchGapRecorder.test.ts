/**
 * The search-gap recorder (ADR-0055 point 4, the review's "Search-gap record"): after a source's frame is written, it
 * counts the gaps under the source's EMF dimension and upserts them. A failure is logged and never fails the search.
 */
import { describe, expect, it } from 'vitest';

import type { SearchGap } from '../domain/remoteHitTriage.js';
import { SearchGapRecorder } from '../SearchGapRecorder.js';

const GAP: SearchGap = {
    query: 'kale',
    source: 'usda',
    externalKey: '1',
    foodId: '01JKALE0000000000000000000',
    foodVariantId: null,
    remoteName: 'Kale, raw',
};

/** The recorder over recording fakes. */
function makeRecorder(options: { readonly storeFails?: Error } = {}): {
    readonly recorder: SearchGapRecorder;
    readonly written: (readonly SearchGap[])[];
    readonly counted: { source: string; count: number }[];
    readonly errors: string[];
} {
    const written: (readonly SearchGap[])[] = [];
    const counted: { source: string; count: number }[] = [];
    const errors: string[] = [];

    return {
        written,
        counted,
        errors,
        recorder: new SearchGapRecorder(
            {
                record: async (gaps) => {
                    if (options.storeFails !== undefined) {
                        throw options.storeFails;
                    }

                    written.push(gaps);
                },
            },
            { recordSearchGaps: (source, count) => counted.push({ source, count }) },
            { error: (message) => errors.push(message) },
        ),
    };
}

describe('SearchGapRecorder', () => {
    it('records the gaps and counts them under their source', async () => {
        const { recorder, written, counted } = makeRecorder();

        await recorder.record('usda', [GAP, { ...GAP, externalKey: '2' }]);

        expect(written).toEqual([[GAP, { ...GAP, externalKey: '2' }]]);
        expect(counted).toEqual([{ source: 'usda', count: 2 }]);
    });

    it('writes and counts nothing when an answer found no gap', async () => {
        const { recorder, written, counted } = makeRecorder();

        await recorder.record('usda', []);

        expect(written).toEqual([]);
        expect(counted).toEqual([]);
    });

    it('logs a store failure and resolves, so the search it follows never fails on it', async () => {
        const { recorder, errors, counted } = makeRecorder({ storeFails: new Error('pool exhausted') });

        await expect(recorder.record('usda', [GAP])).resolves.toBeUndefined();
        expect(errors).toEqual(['search-gap-record-failed']);
        expect(counted).toEqual([{ source: 'usda', count: 1 }]);
    });
});
