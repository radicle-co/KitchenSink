/**
 * Drizzle definition for `ingredient_parse_cache` (plan U20 / KTD-13, KTD-14, migration 0028) — what an ENGINE
 * made of one ingredient line.
 *
 * ⚠️ The hand-authored `src/database/migrations/0028_ingredient_parse_cache.sql` is the SOURCE OF TRUTH (repo
 * convention — the in-VPC runner applies those files in filename order). Read its header before changing
 * anything here: it carries the reasoning for keying on the ENGINE rather than storing it as an attribute, the
 * four alternatives rejected, the `{version}:` prefix rule, and the erasure argument that depends on this table
 * having no owner column.
 *
 * ⛔ `parse_key` and `line_digest` are TEXT, not `uuid`: both are `{version}:{sha256hex}`, and the prefix is
 * part of the VALUE because a change to the derivation must be an enumerable re-partition rather than a silent
 * one. Derived by `@kitchensink/recipe-core/parsing/parse-key`, which is the single authority for both.
 *
 * ⛔ KTD-14 — NO OWNER COLUMN, AND THAT IS THE ERASURE ARGUMENT. This table is absent from `recipe-workers`'
 * account-erasure sweep for the same reason `recipe_ingredient_verifications` is: it carries no person-to-row
 * link. `parse.foods[].name` is a fragment of user-typed text, and the mitigation is that the row is shared
 * installation-wide and addressed by a one-way digest. Adding ANY column naming a person changes that, and
 * `parseCacheSchema.integration.test.ts` asserts the column set by EQUALITY so it cannot happen quietly. A
 * cook's own correction is a DIFFERENT table with the memo treatment (U21 / 0029), never a column here.
 */
import { sql, type InferSelectModel } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { PARSE_ENGINES, type ParseEngine } from '@kitchensink/recipe-core/parsing/parse-key';

/**
 * The controlled `engine` value set, tied to the key module's vocabulary with `satisfies` — so the column's
 * CHECK constraint and the derivation that keys on it cannot drift apart without a compile error (the
 * convention `LINE_VERIFICATION_BANDS` and `RESOLUTION_MAPPING_SCOPES` already follow).
 */
export const PARSE_CACHE_ENGINES = PARSE_ENGINES satisfies readonly ParseEngine[];

/**
 * One engine's structured output for one line — U16's `ParsedFacts`, and NEVER the wider `ParsedLine`.
 *
 * ⚠️ Deliberately opaque HERE, and that is not laziness. Inventing the shape in a schema file would make the
 * database the place that contract is defined — the exact inversion ADR-0014 forbids for wire types, and it
 * applies just as well to an engine's output. The column stores the payload verbatim, the database enforces
 * only that it is an object, and this service interprets nothing. The twin of `CorrectedParse`
 * (`ingredientParseCorrections.ts`), for the same reason.
 *
 * ⛔ CORRECTED IN U22, and the correction is worth keeping. This docstring used to say "when U16 lands, this
 * alias becomes `ParsedLine`". U16 landed, and the answer is NO — `ParsedLine.raw` is the cook's line
 * BYTE-IDENTICAL (HAZ-041), and `line_digest` below is documented as "the ONLY representation of the cook's
 * line that is stored anywhere in this table". Those two sentences cannot both be true, and the digest one
 * wins, because KTD-14's whole erasure argument depends on it: this table has no owner column and is absent
 * from the account-erasure sweep precisely because it carries no person-to-row link. `CorrectedParse` already
 * ruled the same way for the sibling table, in the same feature. The writer's half of the rule is enforced by
 * `recipe-import-core`'s `storedParseFacts.ts`, whose `strictObject` REFUSES a payload carrying `raw`.
 */
export type CachedParsePayload = Readonly<Record<string, unknown>>;

export const ingredientParseCache = pgTable(
    'ingredient_parse_cache',
    {
        /** `{version}:{sha256hex}` over `[version, lineDigest, engine, engineVersion]` — the content key. */
        parseKey: text('parse_key').primaryKey(),
        /**
         * `{version}:{sha256hex}` over the NFC-normalized, case-PRESERVING source line.
         *
         * ⛔ The ONLY representation of the cook's line that is stored anywhere in this table.
         */
        lineDigest: text('line_digest').notNull(),
        /** Which engine produced the parse. A member of the IDENTITY, not provenance beside it (KTD-13). */
        engine: text('engine').$type<ParseEngine>().notNull(),
        /** The engine's own version — CRF package + model pin, or LLM model id + prompt version. */
        engineVersion: text('engine_version').notNull(),
        /** The engine's structured output, verbatim. Stored and returned; never interpreted here. */
        parse: jsonb('parse').$type<CachedParsePayload>().notNull(),
        parsedAt: timestamp('parsed_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('ingredient_parse_cache_engine_check', sql`${table.engine} IN ('crf', 'llm')`),
        // The `{version}:` prefix is what makes a superseded generation ENUMERABLE rather than merely inert.
        check('ingredient_parse_cache_parse_key_versioned', sql`${table.parseKey} ~ '^v[0-9]+:.+$'`),
        check('ingredient_parse_cache_line_digest_versioned', sql`${table.lineDigest} ~ '^v[0-9]+:.+$'`),
        check('ingredient_parse_cache_engine_version_nonempty', sql`length(${table.engineVersion}) >= 1`),
        check('ingredient_parse_cache_parse_object', sql`jsonb_typeof(${table.parse}) = 'object'`),
        // ⛔ ONE index, TWO jobs. It ENFORCES "one row per (lineDigest, engine, engineVersion)" independently of
        // the key derivation being correct, and — `lineDigest` being leftmost — it SERVES the pipeline's hottest
        // read, "every engine's parse for this line", at no extra write cost.
        uniqueIndex('idx_parse_cache_identity').on(table.lineDigest, table.engine, table.engineVersion),
    ],
);

/** An `ingredient_parse_cache` row as selected. */
export type IngredientParseCacheRow = InferSelectModel<typeof ingredientParseCache>;
