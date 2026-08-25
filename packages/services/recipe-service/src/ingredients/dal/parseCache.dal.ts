/**
 * `ParseCacheDal` — every statement over `ingredient_parse_cache` (plan U20 / KTD-13, KTD-14, migration 0028).
 *
 * DESIGN PATTERN: **Repository** over a content-addressed cache, with exactly two operations — a batch read and
 * an idempotent write. There is no update and no delete, and that is the design rather than an omission: a
 * cache row is WRITE-ONCE within its generation, and a superseded generation is reclaimed by an operator
 * (`DELETE … WHERE parse_key LIKE 'v1:%'`), never by this service.
 *
 * ## ⛔ `DO NOTHING`, NOT `DO UPDATE`, and the difference is not stylistic
 *
 * The LLM leg is not deterministic. An overwriting cache would let a row change under a comparison that already
 * cited it, so a re-run of U23's harness would silently measure different inputs and report a delta nobody
 * caused. `DO NOTHING` makes the FIRST parse of a generation stand; a corrected parse arrives as a new
 * `engineVersion` (or a `PARSE_KEY_VERSION` bump), which is a visible re-partition rather than a silent
 * rewrite. It also makes a redelivered pipeline message and two concurrent misses both benign — neither errors,
 * and neither can produce two rows, because the primary key is the content.
 *
 * ## ⛔ THE BATCH READ RETURNS EVERY ENGINE, and a `LIMIT`/`DISTINCT ON` here would be a silent bug
 *
 * KTD-13's whole point is that both engines' answers for one line coexist. Narrowing this read to one row per
 * line would hand U19's comparator a single parse, which it would then adjudicate against itself — reporting
 * `agree` on every line, forever, with nothing failing.
 *
 * ## ⚠️ `inArray(col, [])` renders `in ()`, which Postgres REJECTS
 *
 * The empty batch is a live path, not a defensive one: a recipe whose every line was answered by U21's
 * correction tier consults the cache for nothing at all. The answer is knowable without asking, and asking is a
 * syntax error — so the short circuit is correctness. Asserted in `__tests__/parseCache.dal.test.ts` with a
 * handle that throws if it is touched.
 *
 * ## ⚠️ Where the WRITER lives
 *
 * U22 runs the parse pipeline in `recipe-workers`, which cannot import this service's `src` and writes over a
 * schema-less handle — the same arrangement `verdictStore.ts` has with `recipe_ingredient_verifications`. This
 * DAL is therefore the authoritative STATEMENT SHAPE for both sides, and the properties that make two writers
 * safe are in the database (`PRIMARY KEY`, `idx_parse_cache_identity`) rather than in either process.
 */
import { inArray } from 'drizzle-orm';
import type { LineDigest, ParseEngine } from '@kitchensink/recipe-core/parsing/parse-key';

import type { RecipeDrizzle } from '../../database/database.module.js';
import { ingredientParseCache, type CachedParsePayload } from '../../database/schema/ingredientParseCache.js';

/** One engine's cached parse of one line, as this service hands it out. */
export interface CachedParse {
    /** `{version}:{sha256hex}` over the whole identity — the row's primary key. */
    readonly parseKey: string;
    /** `{version}:{sha256hex}` over the source line. The only representation of that line anywhere here. */
    readonly lineDigest: LineDigest;
    /** Which engine produced it. */
    readonly engine: ParseEngine;
    /** The engine's own version, opaque to this service. */
    readonly engineVersion: string;
    /** The engine's structured output, verbatim (U16's `ParsedLine`). */
    readonly parse: CachedParsePayload;
    /** ISO-8601, never a `Date` — the repo-wide interface rule. */
    readonly parsedAt: string;
}

/** What {@link ParseCacheDal.remember} needs. `parsedAt` is the database's, not the caller's. */
export type NewCachedParse = Omit<CachedParse, 'parsedAt'>;

export class ParseCacheDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * Every engine's cached parse for each of a batch of lines.
     *
     * ⛔ Returns EVERY engine's row, unordered — see the header. The caller groups by `lineDigest`; imposing an
     * order here would suggest a precedence this table does not have, since which engine wins is U19's
     * decision and not a property of storage.
     *
     * @param lineDigests - The lines to look up. An empty batch short-circuits without a query.
     * @returns The cached parses found. A line with no cached parse simply contributes no rows.
     * @sideEffect Reads the database.
     */
    public async findForLines(lineDigests: readonly LineDigest[]): Promise<readonly CachedParse[]> {
        if (lineDigests.length === 0) {
            return [];
        }

        const rows = await this.db
            .select()
            .from(ingredientParseCache)
            .where(inArray(ingredientParseCache.lineDigest, [...lineDigests]));

        return rows.map((row) => ({
            parseKey: row.parseKey,
            lineDigest: row.lineDigest as LineDigest,
            engine: row.engine,
            engineVersion: row.engineVersion,
            parse: row.parse,
            parsedAt: row.parsedAt.toISOString(),
        }));
    }

    /**
     * Store one engine's parse, if this generation does not already hold one for it.
     *
     * Idempotent by primary key and WRITE-ONCE: a second call for the same key is a no-op, not an overwrite and
     * not an error. See the header for why `DO NOTHING` is the correct conflict action here.
     *
     * @param entry - The parse to remember.
     * @sideEffect Writes to the database.
     */
    public async remember(entry: NewCachedParse): Promise<void> {
        await this.db
            .insert(ingredientParseCache)
            .values({
                parseKey: entry.parseKey,
                lineDigest: entry.lineDigest,
                engine: entry.engine,
                engineVersion: entry.engineVersion,
                parse: entry.parse,
            })
            .onConflictDoNothing({ target: ingredientParseCache.parseKey });
    }
}
