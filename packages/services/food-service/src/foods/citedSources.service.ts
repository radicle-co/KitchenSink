/**
 * `CitedSourcesService` — the read behind `GET /api/v1/foods/sources`, the Data sources page (plan R55).
 *
 * One query for the cited datasets, then the pure listing policy. Nothing here depends on the caller: the response is
 * the same for every authenticated principal (see `dataSources.schema.ts`).
 *
 * @pattern Facade — composes the cited-dataset Repository with the listing Policy
 */
import type { CitedSourcesDao } from './dao/citedSources.dao.js';
import type { DataSourcesResponse } from './dataSources.schema.js';
import { citedSourceViews } from './domain/citedSources.js';

export class CitedSourcesService {
    /** @param citedSources - The cited-dataset read. */
    public constructor(private readonly citedSources: Pick<CitedSourcesDao, 'listCitedDatasets'>) {}

    /**
     * The sources a stored value cites, in the register's order.
     *
     * @returns The page's sources; an empty list when nothing is cited.
     * @throws Any database failure unchanged; the exception filter answers it.
     * @sideEffect Reads the database.
     */
    public async list(): Promise<DataSourcesResponse> {
        return { sources: citedSourceViews(await this.citedSources.listCitedDatasets()) };
    }
}
