/**
 * `sourceCandidates.tsv` (plan KTD-22): every candidate for every root with no USDA item, so the seed image can assert
 * that each committed citation is `chooseCitation`'s choice. A candidate names its dataset (`citationDatasets.ts`),
 * and the image resolves it against that dataset only. A label candidate's key is the label's URL.
 *
 * @pattern Parser — tab-separated rows into typed candidates, or a refusal naming each broken rule
 * @module
 */
import { z } from 'zod';

import { isCuratedKey, isFdcKey, type CuratedKey } from '../catalogKey.js';
import { CITATION_DATASETS, DATASET_SOURCE, type CitationDataset } from '../citationDatasets.js';
import { CITATION_MATCHES } from './citationPrecedence.js';
import { SeedRefusedError, type SeedIssue } from './curatedSeedFormat.errors.js';

/** The committed file's name in the seed data directory, also used in a refusal's `where`. */
export const SOURCE_CANDIDATES_FILE = 'sourceCandidates.tsv';

/** The file's header line. */
const HEADER = 'seedKey\tdataset\tkey\tmatch';

/** A label's key: the https URL the label was read at. */
const LABEL_URL = /^https:\/\/\S+$/u;

/**
 * Whether a key has the form its dataset's keys take. Pure.
 *
 * @param dataset - The dataset.
 * @param key - The key.
 * @returns True for an `fdc:<id>` key in a USDA dataset, an https URL for a label, and any key for a table.
 */
function keyFitsDataset(dataset: CitationDataset, key: string): boolean {
    if (DATASET_SOURCE[dataset] === 'usda') {
        return isFdcKey(key);
    }

    return dataset === 'label' ? LABEL_URL.test(key) : true;
}

const candidateSchema = z
    .strictObject({
        seedKey: z.custom<CuratedKey>(isCuratedKey, { message: 'must be a curated:<slug> key' }),
        dataset: z.enum(CITATION_DATASETS),
        key: z.string().min(1),
        match: z.enum(CITATION_MATCHES),
    })
    .refine((candidate) => keyFitsDataset(candidate.dataset, candidate.key), {
        message: "the key is not the form its dataset's keys take",
    });

/** One candidate for a root's numbers. */
export type SourceCandidate = z.infer<typeof candidateSchema>;

/**
 * Parse `sourceCandidates.tsv`. Every row is checked, and every issue is collected before refusing. Pure.
 *
 * @param text - The file's text: the header, then one candidate per line, each line ending in a newline.
 * @returns The candidates, in file order.
 * @throws {SeedRefusedError} with every issue found.
 */
export function parseSourceCandidates(text: string): readonly SourceCandidate[] {
    const issues: SeedIssue[] = [];
    const candidates: SourceCandidate[] = [];
    const seen = new Set<string>();

    if (!text.endsWith('\n')) {
        issues.push({ where: SOURCE_CANDIDATES_FILE, rule: 'candidateMalformed', detail: 'does not end in a newline' });
    }

    const [header, ...rows] = text.replace(/\n$/u, '').split('\n');

    if (header !== HEADER) {
        issues.push({
            where: `${SOURCE_CANDIDATES_FILE}:1`,
            rule: 'candidateMalformed',
            detail: `the header is not '${HEADER}'`,
        });
    }

    rows.forEach((row, index) => {
        const where = `${SOURCE_CANDIDATES_FILE}:${String(index + 2)}`;
        const fields = row.split('\t');
        const [seedKey, dataset, key, match] = fields;
        const parsed = candidateSchema.safeParse({ seedKey, dataset, key, match });

        if (fields.length !== 4 || !parsed.success) {
            issues.push({ where, rule: 'candidateMalformed', detail: `is not a seedKey, dataset, key and match row` });

            return;
        }

        if (parsed.data.dataset === 'usdaSrFoundation' && parsed.data.match !== 'sameSubstance') {
            // R50 admits an SR Legacy or Foundation item only as a stand-in for the same substance: an exact item
            // would be the root's own item, and a looser one is a different food.
            issues.push({
                where,
                rule: 'candidateStandInNotSameSubstance',
                detail: `${parsed.data.key} is graded ${parsed.data.match}, not sameSubstance`,
            });

            return;
        }

        // An FDC id belongs to one USDA dataset, so a key repeats across datasets of one source as well as within one.
        const identity = `${parsed.data.seedKey}\t${DATASET_SOURCE[parsed.data.dataset]}\t${parsed.data.key}`;

        if (seen.has(identity)) {
            issues.push({
                where,
                rule: 'candidateRepeated',
                detail: `${parsed.data.key} is listed twice for ${parsed.data.seedKey}`,
            });

            return;
        }

        seen.add(identity);
        candidates.push(parsed.data);
    });

    if (issues.length > 0) {
        throw new SeedRefusedError(issues);
    }

    return candidates;
}

/**
 * The distinct keys one dataset is a candidate under, across every root: what that dataset's extract must hold. Pure.
 *
 * @param candidates - The parsed candidates.
 * @param dataset - The dataset.
 * @returns Its candidate keys.
 */
export function candidateKeysOf(candidates: readonly SourceCandidate[], dataset: CitationDataset): ReadonlySet<string> {
    return new Set(candidates.filter((candidate) => candidate.dataset === dataset).map((candidate) => candidate.key));
}
