/**
 * The parse pipeline's STORAGE ports for the service leg (plan U8): the parse cache and the corrections
 * tier, raw SQL over the accepted worker seam. ⛔ The seam's reasoning lives ONCE, in `common/db.ts`'s
 * docstring — recipe-service's Drizzle models are its internals, so this package holds a SCHEMA-LESS handle
 * and every handler issues raw `sql` — and it is cited rather than restated here, because an earlier
 * revision of this sentence counted "five shipped handlers" and the count had already rotted.
 *
 * ⛔ The CORRECTIONS read mirrors `parseCorrections.dal.ts`'s statement DELIBERATELY, predicate for
 * predicate: `superseded_at IS NULL`, global-or-own scope, author-first ordering. Two readers with
 * different precedence would let a correction bind on the API path and not on the import path — the exact
 * drift the DAL's "the WHERE clauses ARE the authorization" note warns about. If that statement changes,
 * this one changes in the same commit.
 *
 * ⚠️ Nothing in `recipe-service` cites this file back, so that obligation is one-directional and rests on a
 * reader of the DAL noticing it. `parsePipeline.ts`'s {@link ParseCorrectionsPort} docstring names this
 * module as the shipped adapter, which is the only pointer that exists in the other direction.
 */
import type { ParseCachePort, ParseCorrectionsPort } from '@kitchensink/recipe-import-core';

/** The minimal query surface — `pg.Pool` satisfies it structurally (the `bandFeedback.ts` shape). */
export interface ParseQueryable {
    query(text: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * The parse cache over `ingredient_parse_cache` (migration 0028).
 *
 * @param pool - The recipe database pool.
 * @returns The port. @sideEffect The returned methods read/write the cache.
 */
export function createParseCachePort(pool: ParseQueryable): ParseCachePort {
    return {
        async findForLines(digests) {
            if (digests.length === 0) {
                return [];
            }

            const result = await pool.query(
                `SELECT line_digest, engine, engine_version, parse
                   FROM ingredient_parse_cache
                  WHERE line_digest = ANY($1::text[])`,
                [[...digests]],
            );

            return (
                result.rows as { line_digest: string; engine: string; engine_version: string; parse: unknown }[]
            ).map((row) => ({
                lineDigest: row.line_digest as never,
                engine: row.engine as never,
                engineVersion: row.engine_version,
                parse: row.parse,
            }));
        },
        async remember(entry) {
            // DO NOTHING: within a generation the first write wins — the cache docstring's own rule.
            await pool.query(
                `INSERT INTO ingredient_parse_cache (parse_key, line_digest, engine, engine_version, parse)
                 VALUES ($1, $2, $3, $4, $5::jsonb)
                 ON CONFLICT (parse_key) DO NOTHING`,
                [entry.parseKey, entry.lineDigest, entry.engine, entry.engineVersion, JSON.stringify(entry.parse)],
            );
        },
    };
}

/**
 * The corrections tier over `ingredient_parse_corrections` (migration 0029).
 *
 * @param pool - The recipe database pool.
 * @returns The port. @sideEffect The returned method reads the corrections.
 */
export function createParseCorrectionsPort(pool: ParseQueryable): ParseCorrectionsPort {
    return {
        async findInForce(normalizedKey, userId) {
            const result = await pool.query(
                `SELECT corrected_facts
                   FROM ingredient_parse_corrections
                  WHERE normalized_key = $1
                    AND superseded_at IS NULL
                    AND (scope = 'global' OR ($2::text IS NOT NULL AND user_id = $2))
                  ORDER BY (scope = 'author') DESC, created_at DESC, id DESC
                  LIMIT 1`,
                [normalizedKey, userId ?? null],
            );
            const row = result.rows[0] as { corrected_facts: unknown } | undefined;

            return row === undefined ? undefined : { facts: row.corrected_facts };
        },
    };
}
