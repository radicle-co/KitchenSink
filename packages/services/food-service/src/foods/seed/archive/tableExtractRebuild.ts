/**
 * Rebuild a cited table's extract from its published files (plan U23, KTD-20).
 *
 * @pattern Guard — every published file matches its pin before the extractor sees a byte
 * @pattern Template Method — the order is fixed here; only the reading of a format varies, in the Strategy
 *
 * The published files are not committed, so CI never runs this; the operator does, with `seed:table-extract`. It is
 * the proof that a committed extract is what the pinned files hold: the same rebuild either reproduces the committed
 * bytes or the tool exits non-zero.
 *
 * @module
 */
import { Buffer } from 'node:buffer';
import { join } from 'node:path';

import { parseSourceExtract, renderSourceExtract } from './sourceExtract.js';
import { TableFormatError } from './tableExtract.errors.js';
import type { TableExtractPins } from './tableExtractPins.js';
import type { TableExtractor } from './tableExtractor.js';
import { SourcePinsFormatError } from './usdaSourceArchive.errors.js';
import { readPinnedBytes } from './usdaSourceArchive.js';

/** What the rebuild needs. */
export interface TableRebuildInput {
    /** The table's pins. */
    readonly pins: TableExtractPins;
    /** The directory holding the published files, under their published names. */
    readonly upstreamDir: string;
    /** The table's extractor. */
    readonly extractor: TableExtractor;
    /** The source's candidate keys. */
    readonly keys: ReadonlySet<string>;
}

/** A rebuilt extract. */
export interface TableRebuild {
    /** The extract's text, in its one canonical rendering. */
    readonly text: string;
    /** The requested keys the table does not hold, sorted. */
    readonly missing: readonly string[];
}

/**
 * Rebuild one table's extract.
 *
 * @param input - The pins, the published files' directory, the extractor and the keys.
 * @returns The rendered extract and the keys the table does not hold.
 * @throws {SourcePinsFormatError} when the pins' roles are not exactly the extractor's.
 * @throws {SourcePinMismatchError} when a published file is absent or differs from its pin; the extractor is not called.
 * @throws {TableFormatError} when the extractor returns a key nobody requested, or one key twice.
 * @throws {SourceExtractFormatError} when the rendered extract is not one the seed would read.
 * @sideEffect Reads the published files.
 */
export async function rebuildTableExtract(input: TableRebuildInput): Promise<TableRebuild> {
    const { pins, upstreamDir, extractor, keys } = input;
    const pinned = Object.keys(pins.upstreams).sort();
    const expected = [...extractor.roles].sort();

    if (pinned.join('\n') !== expected.join('\n')) {
        throw new SourcePinsFormatError(
            `upstreams names ${pinned.join(', ')}; the extractor reads ${expected.join(', ')}`,
        );
    }

    const upstreams = new Map<string, Buffer>();

    for (const [role, pin] of Object.entries(pins.upstreams)) {
        upstreams.set(role, await readPinnedBytes(join(upstreamDir, pin.upstream), pin.upstreamSha256));
    }

    const lines = await extractor.extract(upstreams, keys);
    const found = new Set<string>();

    for (const line of lines) {
        if (!keys.has(line.key)) {
            throw new TableFormatError(line.key, 'the extractor returned a key nobody requested');
        }

        if (found.has(line.key)) {
            throw new TableFormatError(line.key, 'the extractor returned this key twice');
        }

        found.add(line.key);
    }

    const text = renderSourceExtract(lines);

    // The Guard covers the output too: a line the committed format refuses never reaches `--write`.
    parseSourceExtract(Buffer.from(text, 'utf8'));

    return { text, missing: [...keys].filter((key) => !found.has(key)).sort() };
}
