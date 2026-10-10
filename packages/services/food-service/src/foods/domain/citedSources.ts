/**
 * Which sources the Data sources page lists, and what it says about each (plan R55, design §S16).
 *
 * The page lists ONLY a source some stored value cites, never a registered source the catalog does not use (owner,
 * 2026-10-01). A citation names its dataset, never its source; `DATASET_SOURCE` is the one map from one to the other,
 * so USDA is listed when any of its three datasets is cited. A manufacturer's label is not a register source and is
 * never listed. The words come from the register alone, so no client keeps a copy of them.
 *
 * @pattern Policy — a pure function from the cited datasets to the listed sources
 * @module
 */
import {
    REGISTERED_SOURCE_IDS,
    LICENCES,
    SOURCE_REGISTER,
    type RegisteredSourceId,
} from '../../sources/sourceRegister.js';
import type { DataSourceView } from '../dataSources.schema.js';
import { DATASET_SOURCE, type CitationDataset } from '../seed/citationDatasets.js';

/** One dataset some stored value cites, and whether any of those citations recorded an R54 conversion. */
export interface CitedDataset {
    readonly dataset: CitationDataset;
    readonly converted: boolean;
}

/**
 * The page's view of one registered source.
 *
 * @param id - A cited source.
 * @param converted - Whether any of its citations recorded a conversion.
 * @returns Its view, with no `shortName` key when the register gives it none.
 */
function viewOf(id: RegisteredSourceId, converted: boolean): DataSourceView {
    const { shortName, name, publisher, edition, licence, licenceUrl, attribution, attributionLanguage, homepage } =
        SOURCE_REGISTER[id];

    return {
        id,
        ...(shortName === undefined ? {} : { shortName }),
        name,
        publisher,
        edition,
        licenceName: LICENCES[licence].name,
        licenceUrl,
        attribution,
        attributionLanguage,
        homepage,
        converted,
    };
}

/**
 * The sources the page lists, in the register's order. Pure.
 *
 * @param cited - Each dataset some stored value cites, in any order, possibly repeated.
 * @returns One view for each cited registered source; a source is converted when any of its citations is.
 */
export function citedSourceViews(cited: readonly CitedDataset[]): DataSourceView[] {
    const convertedBySource = new Map<RegisteredSourceId, boolean>();

    for (const { dataset, converted } of cited) {
        const source = DATASET_SOURCE[dataset];

        if (source !== 'manufacturerLabel') {
            convertedBySource.set(source, (convertedBySource.get(source) ?? false) || converted);
        }
    }

    return REGISTERED_SOURCE_IDS.flatMap((id) => {
        const converted = convertedBySource.get(id);

        return converted === undefined ? [] : [viewOf(id, converted)];
    });
}
