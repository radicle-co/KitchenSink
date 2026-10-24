/**
 * What one cited table's extractor is to the hand-run rebuild (plan U23, KTD-20, KTD-24).
 *
 * @pattern Strategy — one extractor per upstream format, chosen by source id in `tableExtractors.ts`
 *
 * An extractor reads the published files of one table and returns the extract line of each requested key. It
 * translates columns into INFOODS tags and never converts a value (`basisConversion.ts` does, KTD-24). It is pure over
 * the bytes it is given: the rebuild has already checked every file against its pin, so an extractor never reads a
 * path and never sees an unpinned byte.
 *
 * @module
 */
import type { Buffer } from 'node:buffer';

import type { ExtractLine } from './sourceExtract.js';
import { TableFormatError } from './tableExtract.errors.js';

/** The verified bytes of each upstream file, by the role the extractor names it with. */
export type TableUpstreams = ReadonlyMap<string, Buffer>;

/** One table's extractor. */
export interface TableExtractor {
    /** The roles of the published files it reads. The table's pins name exactly one file per role. */
    readonly roles: readonly string[];
    /**
     * Read the requested entries. Pure; async only because a container reader is.
     *
     * @param upstreams - Each role's verified bytes.
     * @param keys - The source's candidate keys (`sourceCandidates.tsv`).
     * @returns The line of every requested key the table holds, in any order. A key it does not hold is left out;
     *   the rebuild decides whether that is an error.
     * @throws {TableFormatError} when a file holds a layout, a cell or a row the extractor was not written for.
     */
    extract(upstreams: TableUpstreams, keys: ReadonlySet<string>): Promise<readonly ExtractLine[]>;
}

/**
 * The verified bytes of one role. Pure.
 *
 * @param upstreams - Each role's bytes.
 * @param role - The role.
 * @returns Its bytes.
 * @throws {TableFormatError} when no file was given for the role.
 */
export function upstreamOf(upstreams: TableUpstreams, role: string): Buffer {
    const bytes = upstreams.get(role);

    if (bytes === undefined) {
        throw new TableFormatError(role, 'no file was given for this role');
    }

    return bytes;
}
