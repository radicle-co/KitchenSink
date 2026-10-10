/**
 * The datasets a root's numbers can come from, in the precedence order R50 states (plan KTD-22).
 *
 * @pattern Registry — one ordered list of datasets and a total `Record` from each to its registered source
 *
 * A candidate names its dataset, never only its source. USDA has three datasets that rank apart: an SR Legacy or
 * Foundation item for the same substance first, FNDDS second, a Branded product last. Inferring the dataset from
 * whichever collection holds an FDC id would let a mistyped id that names an SR Legacy item become the top-ranked
 * candidate, and the policy check would agree with itself. Each candidate is resolved against its stated dataset
 * only.
 *
 * @module
 */
import type { RegisteredSourceId } from '../../sources/sourceRegister.js';

/** Every dataset, highest precedence first. */
export const CITATION_DATASETS = [
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
] as const;

/** A dataset a candidate names. */
export type CitationDataset = (typeof CITATION_DATASETS)[number];

/** The datasets read from a committed extract (KTD-20): FNDDS and every other table. */
export const TABLE_DATASETS = [
    'usdaFndds',
    'ciqual',
    'cofid',
    'bls',
    'stfcj',
    'matvaretabellen',
    'livsmedelsverket',
    'fsvo',
    'cnf',
] as const satisfies readonly CitationDataset[];

/** A dataset read from a committed extract. */
export type TableDataset = (typeof TABLE_DATASETS)[number];

/** The registered source each table dataset belongs to. */
export const TABLE_DATASET_SOURCE: Readonly<Record<TableDataset, RegisteredSourceId>> = {
    usdaFndds: 'usda',
    ciqual: 'ciqual',
    cofid: 'cofid',
    bls: 'bls',
    stfcj: 'stfcj',
    matvaretabellen: 'matvaretabellen',
    livsmedelsverket: 'livsmedelsverket',
    fsvo: 'fsvo',
    cnf: 'cnf',
};

/** The source each dataset belongs to. A label's numbers are the manufacturer's own. */
export const DATASET_SOURCE: Readonly<Record<CitationDataset, RegisteredSourceId | 'manufacturerLabel'>> = {
    ...TABLE_DATASET_SOURCE,
    usdaSrFoundation: 'usda',
    usdaBranded: 'usda',
    label: 'manufacturerLabel',
};

/**
 * Whether a text names a table dataset. Pure.
 *
 * @param value - The text, for example a command-line argument.
 * @returns True for a dataset read from a committed extract.
 */
export function isTableDataset(value: string): value is TableDataset {
    return TABLE_DATASETS.some((dataset) => dataset === value);
}

/**
 * Every dataset a source publishes, in precedence order: the inverse of {@link DATASET_SOURCE} (curated plan U8). The
 * live owner reader matches a source item's key against the citations of exactly these datasets. Pure.
 *
 * @param source - A registered source, or `manufacturerLabel`.
 * @returns Its datasets; empty for a source no dataset names.
 */
export function datasetsOfSource(source: RegisteredSourceId | 'manufacturerLabel'): CitationDataset[] {
    return CITATION_DATASETS.filter((dataset) => DATASET_SOURCE[dataset] === source);
}
