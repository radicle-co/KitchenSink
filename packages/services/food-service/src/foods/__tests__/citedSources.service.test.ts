/**
 * `CitedSourcesService` composes the cited-dataset read with the listing policy (plan R55). The policy's rules are
 * pinned in `domain/__tests__/citedSources.test.ts` and the query's in `tests/e2e/dataSources.e2e.test.ts`; this
 * pins only that the service hands the read's rows to the policy and answers the published shape.
 */
import { describe, expect, it, vi } from 'vitest';

import { CitedSourcesService } from '../citedSources.service.js';
import type { CitedSourcesDao } from '../dao/citedSources.dao.js';
import { dataSourcesResponseSchema } from '../dataSources.schema.js';

/**
 * A service over a doubled read.
 *
 * @param rows - What the read answers.
 * @returns The service and the read's spy.
 */
function serviceOver(rows: Awaited<ReturnType<CitedSourcesDao['listCitedDatasets']>>) {
    const listCitedDatasets = vi.fn(async () => rows);

    return {
        service: new CitedSourcesService({ listCitedDatasets }),
        listCitedDatasets,
    };
}

describe('CitedSourcesService.list', () => {
    it('answers the cited sources in the register’s order, in the published shape, from one read', async () => {
        const { service, listCitedDatasets } = serviceOver([
            { dataset: 'cofid', converted: true },
            { dataset: 'label', converted: false },
            { dataset: 'usdaSrFoundation', converted: false },
        ]);

        const response = await service.list();

        expect(listCitedDatasets).toHaveBeenCalledTimes(1);
        expect(dataSourcesResponseSchema.parse(response)).toStrictEqual(response);
        expect(response.sources.map((source) => [source.id, source.converted])).toEqual([
            ['usda', false],
            ['cofid', true],
        ]);
    });

    it('answers an empty list when nothing is cited', async () => {
        await expect(serviceOver([]).service.list()).resolves.toEqual({ sources: [] });
    });

    it('lets a failed read propagate, so the error filter answers it', async () => {
        const failure = new Error('connection refused');
        const service = new CitedSourcesService({
            listCitedDatasets: vi.fn(async () => {
                throw failure;
            }),
        });

        await expect(service.list()).rejects.toBe(failure);
    });
});
