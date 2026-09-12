/**
 * The committed USDA source archives, opened only after their bytes match their pins (plan U1, R2, KTD-3).
 *
 * @pattern Guard — the checksum is a precondition: no byte is parsed until the whole file matches its pin
 * @pattern Adapter over yauzl — a zip becomes a set of byte streams addressed by basename
 *
 * The public surface is checksums and byte streams, and nothing else. It knows no CSV and imports no reader,
 * so U6's verifier can depend on it without depending on the seeder's interpretation of the bytes.
 *
 * ⛔ **Read once.** A pinned file is read into memory ONCE, hashed, and every later read comes from those
 * bytes. There is no time-of-check to time-of-use gap: the bytes that were hashed are the bytes that are
 * read. `DSG/manifestFile.ts` records the same principle for migrations.
 *
 * ⚠️ yauzl does NOT check an entry's CRC-32 (its README, "No CRC-32 Checking"). That is fine here, and is
 * deliberately not re-implemented: the whole-file SHA-256 precondition already proves every byte of every
 * entry is the reviewed byte, which is strictly stronger than a per-entry CRC.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import type { Readable } from 'node:stream';

import { fromBufferPromise, type Entry } from 'yauzl';
import { z } from 'zod';

import { isMissingFile } from './committedFile.js';
import { committedNameSchema, parsePinsText, SHA256, sha256Schema, upstreamPinSchema } from './pinSchemas.js';
import { tableExtractPinsSchema, type TableExtractPins } from './tableExtractPins.js';
import { SourcePinMismatchError } from './sourcePin.errors.js';
import { ArchiveLayoutError } from './usdaSourceArchive.errors.js';

/** A committed archive: the upstream name USDA published it under, its digest, and the committed name. */
interface ArchivePin {
    /** The name USDA publishes the file under (it breaks the file-name rule, so the copy is renamed). */
    readonly upstream: string;
    /** The SHA-256 of the upstream bytes, which the committed copy must equal. */
    readonly upstreamSha256: string;
    /** The committed copy's file name, beside `sourcePins.json`. */
    readonly file: string;
}

/** A committed extract of an upstream archive too large to commit (KTD-20). */
interface ExtractPin {
    /** The upstream archive's published name. */
    readonly upstream: string;
    /** The upstream archive's SHA-256, checked by the hand-run rebuild. */
    readonly upstreamSha256: string;
    /** The committed extract's file name, beside `sourcePins.json`. */
    readonly extract: string;
    /** The committed extract's SHA-256. */
    readonly extractSha256: string;
}

/** An upstream input that is not committed: its name and digest only. */
interface UpstreamPin {
    /** The input's file name. */
    readonly upstream: string;
    /** The input's SHA-256. */
    readonly upstreamSha256: string;
}

/** Every pinned source of the curated seed. */
export interface SourcePins {
    /** The SR Legacy archive. */
    readonly srLegacy: ArchivePin;
    /** The Foundation archive. */
    readonly foundation: ArchivePin;
    /** The Branded Foods extract and its upstream archive. */
    readonly brandedFoods: ExtractPin;
    /** The inputs `seed:fndds-prior` derives `foodPopularity.jsonl` from. */
    readonly fnddsPrior: {
        /** The derivation's provenance label. */
        readonly label: string;
        /** The FNDDS survey-food archive. */
        readonly survey: UpstreamPin;
        /** The per-food-code NHANES day-1 intake weights. */
        readonly intake: UpstreamPin;
    };
    /** The FNDDS extract, read from the survey download the prior reads (R50). */
    readonly fndds: TableExtractPins;
}

/** A zip's file entries, as byte streams addressed by basename. */
export interface ZipEntrySource {
    /** The basenames of every file entry, sorted. */
    readonly names: readonly string[];
    /**
     * Stream one entry.
     *
     * @param name - An entry's basename.
     * @returns The entry's decompressed bytes, or `undefined` when the archive holds no such entry.
     */
    open(name: string): Promise<Readable | undefined>;
    /** Release the archive. */
    close(): void;
}

const sourcePinsSchema = z
    .strictObject({
        srLegacy: z.strictObject({ ...upstreamPinSchema.shape, file: committedNameSchema }),
        foundation: z.strictObject({ ...upstreamPinSchema.shape, file: committedNameSchema }),
        brandedFoods: z.strictObject({
            ...upstreamPinSchema.shape,
            extract: committedNameSchema,
            extractSha256: sha256Schema,
        }),
        fnddsPrior: z.strictObject({
            label: z.string().min(1),
            survey: upstreamPinSchema,
            intake: upstreamPinSchema,
        }),
        fndds: tableExtractPinsSchema,
    })
    .refine(
        (pins) =>
            pins.fndds.upstreams['survey']?.upstreamSha256 === pins.fnddsPrior.survey.upstreamSha256 &&
            pins.fndds.upstreams['survey'].upstream === pins.fnddsPrior.survey.upstream,
        { message: 'the FNDDS extract and the popularity prior must be read from the one survey download' },
    );

/**
 * Parse `usda/sourcePins.json`. Pure. It is edited by hand, as `parsePinsText` explains.
 *
 * @param json - The file's text.
 * @returns The pins.
 * @throws {SourcePinsFormatError} when the text is not JSON or not the pins shape.
 */
export function parseSourcePins(json: string): SourcePins {
    return parsePinsText(json, sourcePinsSchema);
}

/**
 * Read a pinned file ONCE and refuse it unless its SHA-256 equals the pin.
 *
 * @param path - The file to read.
 * @param sha256 - The pinned lower-case hex SHA-256.
 * @returns The file's bytes, which are exactly the bytes that were hashed.
 * @throws {RangeError} when `sha256` is not a SHA-256 digest.
 * @throws {SourcePinMismatchError} when the file is absent or its digest differs.
 * @sideEffect Reads one file.
 */
export async function readPinnedBytes(path: string, sha256: string): Promise<Buffer> {
    if (!SHA256.test(sha256)) {
        throw new RangeError(`The pin for '${path}' is not a lower-case hex SHA-256.`);
    }

    let bytes: Buffer;

    try {
        bytes = await readFile(path);
    } catch (error) {
        if (isMissingFile(error)) {
            throw new SourcePinMismatchError(path, sha256, null);
        }

        throw error;
    }

    const actual = createHash('sha256').update(bytes).digest('hex');

    if (actual !== sha256) {
        throw new SourcePinMismatchError(path, sha256, actual);
    }

    return bytes;
}

/**
 * Expose a zip's file entries as byte streams addressed by basename.
 *
 * USDA nests every CSV one directory deep under a dated folder name, so the basename is the stable address.
 * Two entries with one basename would make that address ambiguous, so they are refused rather than resolved.
 *
 * @param bytes - The zip's bytes.
 * @returns The entry source. The caller must `close()` it.
 * @throws {ArchiveLayoutError} when the bytes are not a zip, or two entries share a basename.
 * @sideEffect Holds the archive open until `close()`.
 */
export async function zipEntrySource(bytes: Buffer): Promise<ZipEntrySource> {
    let zip: Awaited<ReturnType<typeof fromBufferPromise>>;

    try {
        zip = await fromBufferPromise(bytes, { lazyEntries: true, autoClose: false, strictFileNames: true });
    } catch (error) {
        throw new ArchiveLayoutError(error instanceof Error ? error.message : 'not a zip');
    }

    const entries = new Map<string, Entry>();

    try {
        for await (const entry of zip.eachEntry()) {
            if (entry.fileName.endsWith('/')) {
                continue;
            }

            const name = posix.basename(entry.fileName);

            if (entries.has(name)) {
                throw new ArchiveLayoutError(`two entries share the file name '${name}'`);
            }

            entries.set(name, entry);
        }
    } catch (error) {
        zip.close();

        throw error instanceof ArchiveLayoutError
            ? error
            : new ArchiveLayoutError(error instanceof Error ? error.message : 'unreadable entry table');
    }

    return {
        names: [...entries.keys()].sort(),
        open: async (name: string): Promise<Readable | undefined> => {
            const entry = entries.get(name);

            return entry === undefined ? undefined : zip.openReadStreamPromise(entry);
        },
        close: (): void => {
            zip.close();
        },
    };
}

/**
 * Open a committed archive after its bytes match their pin.
 *
 * @param path - The committed archive.
 * @param sha256 - Its pinned SHA-256.
 * @returns The entry source. The caller must `close()` it.
 * @throws {SourcePinMismatchError} before the zip reader sees a single byte, when the digest differs.
 * @throws {ArchiveLayoutError} when the pinned bytes are not a usable zip.
 * @sideEffect Reads one file and holds it open until `close()`.
 */
export async function openPinnedArchive(path: string, sha256: string): Promise<ZipEntrySource> {
    return zipEntrySource(await readPinnedBytes(path, sha256));
}
