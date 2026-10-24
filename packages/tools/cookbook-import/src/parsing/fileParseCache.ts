/**
 * A parse cache for a tool that owns no database — `ingredient_parse_cache`'s contract over a local file.
 *
 * DESIGN PATTERN: **Adapter** over the filesystem, implementing `ParseCachePort`. The rules it must satisfy
 * are stated once, on that interface (`@kitchensink/recipe-import-core`'s `domain/parsePipeline.ts`), and the
 * identity it keys on is derived once, by `parseKey` (`@kitchensink/recipe-core/parsing/parse-key`) — this
 * module re-states neither and computes neither.
 *
 * ## Why a file, and why not a database
 *
 * ADR-0026 §6 is why this package carries no `pg` and no `drizzle-orm`, and `NO_CACHE`'s own docstring
 * states the price that leaves: both engines on every line. On a REPEATED import that price is the whole
 * corpus again — the run behind `docs/reports/2026-09-19/validatorLoopCorpusDiff.md` spent $7.15 on one
 * book. A file pays neither: no database, no wire surface, and nothing re-asked that was already answered.
 *
 * ## ⛔ The format is APPEND-ONLY JSON Lines, and that is not a style choice
 *
 * `runParsePipeline` calls `remember` once per `(line, engine)` inside a `Promise.allSettled`, so a corpus of
 * a few thousand lines is a few thousand writes. `ImportLedger` persists by rewriting the whole file and is
 * right to — it records one entry per RECIPE — but the same shape here is quadratic in the corpus. One line
 * appended per row makes each write O(1) and bounds a crash to the row in flight.
 *
 * ⚠️ `appendFileSync`, not its promise form: the pipeline's writes are concurrent, and only the synchronous
 * call is indivisible with respect to the others in this process.
 *
 * ## ⛔ The two failure modes are DIFFERENT, and collapsing them loses one of them
 *
 * A line that is not a row at all means the file is not a cache file — refused, loudly, because continuing
 * from an empty cache silently re-spends what the file existed to save. (That is `ImportLedger.load`'s
 * argument applied to a different loss: the ledger refuses because continuing DUPLICATES RECIPES.)
 *
 * A row whose `parse` payload is not this generation's shape is a different thing entirely, and this module
 * does NOT judge it: `CachedParseRow.parse` is `unknown` precisely so `readStoredParse` owns that
 * decision and reports it as an unreadable payload rather than an outage. It is handed through as read.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { PARSE_ENGINES, type ParseEngine } from '@kitchensink/recipe-core/parsing/parse-key';
import type { CachedParseRow, ParseCachePort } from '@kitchensink/recipe-import-core';
import { z } from 'zod';

/** One stored row: the identity, and the payload this module does not interpret. */
interface StoredRow {
    /** The row's primary key — `parseKey` over the identity below, derived by the pipeline. */
    readonly parseKey: string;
    /** The line the parse is about. A plain `string` here: the branded value comes from the caller. */
    readonly lineDigest: string;
    readonly engine: ParseEngine;
    readonly engineVersion: string;
    /** The payload, as read. ⛔ `unknown` — see the module header on who judges it. */
    readonly parse: unknown;
}

/**
 * The ENVELOPE, and only the envelope.
 *
 * `z.json()` on the payload accepts any JSON value while still requiring the member to be present, so a row
 * with no payload is a corrupt row rather than a cache miss nothing can explain.
 */
const storedRowSchema: z.ZodType<StoredRow> = z.strictObject({
    parseKey: z.string().min(1),
    lineDigest: z.string().min(1),
    engine: z.enum(PARSE_ENGINES),
    engineVersion: z.string().min(1),
    parse: z.json(),
});

/**
 * Read the file, treating an absent one as an empty cache.
 *
 * @param path - Where the cache lives.
 * @returns Every row it holds, in the order they were appended.
 * @throws {Error} When a line is not a row — see the module header.
 * @sideEffect Reads the filesystem.
 */
function loadRows(path: string): readonly StoredRow[] {
    if (!existsSync(path)) {
        return [];
    }

    const rows: StoredRow[] = [];

    readFileSync(path, 'utf-8')
        .split('\n')
        .forEach((text, index) => {
            if (text.trim() === '') {
                return;
            }

            const parsed = readRow(text);

            if (parsed === undefined) {
                throw new Error(
                    `cookbook-import: the parse cache at ${path} is unreadable at line ${index + 1}. Refusing ` +
                        `to continue: starting from an empty cache would re-ask every line it records.`,
                );
            }

            rows.push(parsed);
        });

    return rows;
}

/**
 * One line of the file, or nothing when it is not a row.
 *
 * @param text - The line.
 * @returns The row, or `undefined`. Pure.
 */
function readRow(text: string): StoredRow | undefined {
    let payload: unknown;

    try {
        payload = JSON.parse(text);
    } catch {
        return undefined;
    }

    const result = storedRowSchema.safeParse(payload);

    return result.success ? result.data : undefined;
}

/**
 * A parse cache backed by a local JSON Lines file.
 *
 * @param path - Where the cache lives. Non-blank, and its parent directory is created here, so a
 *   misconfigured path fails before the first engine call has been paid for rather than turning every write
 *   into a cache-tier failure the pipeline is right to swallow.
 * @returns The port.
 * @throws {Error} When the path is blank, when the file exists and is not a cache file, or when its
 *   directory cannot be created.
 * @sideEffect Reads the file and creates its parent directory; the returned methods read and append to it.
 */
export function createFileParseCache(path: string): ParseCachePort {
    if (path.trim() === '') {
        throw new Error('cookbook-import: the parse cache needs a path. Pass --no-parse-cache to run without one.');
    }

    const rows = loadRows(path);
    const written = new Set(rows.map((row) => row.parseKey));
    const byDigest = new Map<string, StoredRow[]>();

    for (const row of rows) {
        const group = byDigest.get(row.lineDigest);

        if (group === undefined) {
            byDigest.set(row.lineDigest, [row]);
        } else {
            group.push(row);
        }
    }

    mkdirSync(dirname(path), { recursive: true });

    return {
        async findForLines(digests) {
            const found: CachedParseRow[] = [];

            // ⚠️ Over the DISTINCT digests: the caller's own is reused as each row's `lineDigest`, so the
            // branded value that comes back is the one that went in and no digest is minted here.
            for (const digest of new Set(digests)) {
                for (const row of byDigest.get(digest) ?? []) {
                    found.push({
                        lineDigest: digest,
                        engine: row.engine,
                        engineVersion: row.engineVersion,
                        parse: row.parse,
                    });
                }
            }

            return found;
        },
        async remember(entry) {
            if (written.has(entry.parseKey)) {
                return;
            }

            const row: StoredRow = {
                parseKey: entry.parseKey,
                lineDigest: entry.lineDigest,
                engine: entry.engine,
                engineVersion: entry.engineVersion,
                parse: entry.parse,
            };

            // ⚠️ `mode` for the same reason `ImportLedger.persist` carries one: the README hands operators a
            // path, and this file names every line an import read.
            appendFileSync(path, `${JSON.stringify(row)}\n`, { encoding: 'utf-8', mode: 0o600 });

            written.add(row.parseKey);
            byDigest.set(row.lineDigest, [...(byDigest.get(row.lineDigest) ?? []), row]);
        },
    };
}
