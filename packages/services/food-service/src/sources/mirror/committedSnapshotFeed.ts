/**
 * The committed-snapshot feed (plan U28, KTD-26). A preview fills its mirror from a snapshot committed to the
 * repository, so open pull requests never multiply the load on a publisher (ADR-0053's rejected alternative). The
 * feed is built with no `fetch`, so it cannot reach the network.
 *
 * The snapshot is the publisher's file, gzipped. Its pin is the SHA-256 of the published bytes, as every upstream pin
 * is (`pinSchemas.ts`), so it is checked after decompression and the compression never decides whether the copy is
 * the publisher's file. The parser sees no byte that has not matched the pin.
 *
 * @pattern Strategy — the committed origin of a mirror feed
 * @pattern Guard — the pin is checked before the parser runs
 * @module
 */
import type { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { isMissingFile } from '../../foods/seed/archive/committedFile.js';
import { SHA256 } from '../../foods/seed/archive/pinSchemas.js';
import { SourcePinMismatchError } from '../../foods/seed/archive/sourcePin.errors.js';
import type { MirrorSourceId } from '../sourceRegister.js';
import type { MirrorFeed, MirrorPull } from './mirrorFeed.js';

const gunzipBytes = promisify(gunzip);

/** Where a snapshot is committed, and the pin of the publisher's bytes it holds. */
export interface CommittedSnapshot {
    /** The committed gzip file. */
    readonly path: string;
    /** The SHA-256 of the decompressed bytes, which are the publisher's. */
    readonly upstreamSha256: string;
}

/**
 * Read a committed snapshot's published bytes, refusing any that differ from the pin.
 *
 * @param snapshot - The snapshot and its pin.
 * @returns The decompressed bytes.
 * @throws {SourcePinMismatchError} when the file is absent or its published bytes differ from the pin.
 * @throws {Error} from zlib when the file is not gzip.
 * @sideEffect Reads one file.
 */
async function readSnapshot(snapshot: CommittedSnapshot): Promise<Buffer> {
    let compressed: Buffer;

    try {
        compressed = await readFile(snapshot.path);
    } catch (error) {
        if (isMissingFile(error)) {
            throw new SourcePinMismatchError(snapshot.path, snapshot.upstreamSha256, null);
        }

        throw error;
    }

    const published = await gunzipBytes(compressed);
    const actual = createHash('sha256').update(published).digest('hex');

    if (actual !== snapshot.upstreamSha256) {
        throw new SourcePinMismatchError(snapshot.path, snapshot.upstreamSha256, actual);
    }

    return published;
}

/**
 * A feed over a committed snapshot.
 *
 * @param source - The mirror source the snapshot belongs to.
 * @param snapshot - The committed file and its pin.
 * @param parse - The source's own document parser, the same one its publisher feed uses.
 * @returns The feed.
 * @throws {RangeError} when the pin is not a lower-case hex SHA-256, so a bad pin fails at composition.
 */
export function committedSnapshotFeed(
    source: MirrorSourceId,
    snapshot: CommittedSnapshot,
    parse: (text: string) => MirrorPull,
): MirrorFeed {
    if (!SHA256.test(snapshot.upstreamSha256)) {
        throw new RangeError(`The pin for '${snapshot.path}' is not a lower-case hex SHA-256.`);
    }

    return {
        source,

        /**
         * @returns The snapshot's items.
         * @throws {SourcePinMismatchError} when the snapshot is absent or differs from its pin.
         * @throws {MirrorFeedFormatError} from the parser.
         * @sideEffect Reads the committed file.
         */
        async pull(): Promise<MirrorPull> {
            const published = await readSnapshot(snapshot);

            return parse(new TextDecoder('utf-8', { fatal: true }).decode(published));
        },
    };
}
