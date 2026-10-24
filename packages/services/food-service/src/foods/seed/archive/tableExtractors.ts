/**
 * Which extractor reads each table dataset's published files (plan U23).
 *
 * @pattern Registry — a total `Record` over the table datasets, so a new dataset fails to compile until it has an
 *   entry here
 *
 * A dataset whose published file has not been seen yet has no extractor: its column layout is unknown, and an extractor
 * written blind would be a guess (KTD-24). Its entry says what it waits for.
 *
 * @module
 */
import type { TableDataset } from '../citationDatasets.js';
import { ciqualExtractor } from './ciqualExtract.js';
import { cnfExtractor } from './cnfExtract.js';
import { cofidExtractor } from './cofidExtract.js';
import { fnddsExtractor } from './fnddsExtract.js';
import { livsmedelsverketExtractor } from './livsmedelsverketExtract.js';
import { matvaretabellenExtractor } from './matvaretabellenExtract.js';
import { stfcjExtractor } from './stfcjExtract.js';
import type { TableExtractor } from './tableExtractor.js';

/** One dataset's entry. */
export type TableExtractorEntry =
    | { readonly kind: 'extractor'; readonly extractor: TableExtractor }
    | { readonly kind: 'awaitingUpstream'; readonly reason: string };

/** Every table dataset's extractor, or what it waits for. */
export const TABLE_EXTRACTORS: Readonly<Record<TableDataset, TableExtractorEntry>> = {
    usdaFndds: { kind: 'extractor', extractor: fnddsExtractor },
    ciqual: { kind: 'extractor', extractor: ciqualExtractor },
    cofid: { kind: 'extractor', extractor: cofidExtractor },
    bls: {
        kind: 'awaitingUpstream',
        reason: 'BLS 4.0 needs an operator download from blsdb.de in a browser. The site refuses scripted downloads.',
    },
    stfcj: { kind: 'extractor', extractor: stfcjExtractor },
    matvaretabellen: { kind: 'extractor', extractor: matvaretabellenExtractor },
    livsmedelsverket: { kind: 'extractor', extractor: livsmedelsverketExtractor },
    fsvo: {
        kind: 'awaitingUpstream',
        reason: 'The Swiss table needs an operator download from naehrwertdaten.ch in a browser. The site refuses scripts.',
    },
    cnf: { kind: 'extractor', extractor: cnfExtractor },
};
