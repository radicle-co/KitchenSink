/**
 * U20 — THE PARSE CACHE'S SCHEMA, ASSERTED AGAINST A REAL POSTGRES (migration 0028).
 *
 * ⛔ WHY THIS TIER, and why the unit suite beside `parseKey.ts` is not enough. Every property below is a
 * property of the DATABASE, and the code that depends on them lives in a DIFFERENT PACKAGE — U22's pipeline
 * runs in `recipe-workers` over a schema-less handle, while the SQL that creates the table ships from
 * recipe-service. That cross-package seam is exactly where "the migration was filed in the wrong place" hides:
 * the worker's unit suite is green against a mock, and the deploy is green because the migration runner applied
 * whatever it was given. Only a real database, migrated by the real runner, can observe that this table exists
 * at all. _A constraint is not believed until a real database has refused something._
 *
 * What is asserted, and why each one is load-bearing rather than tidy:
 *
 *  1. **KTD-13 — the same line under two engines is TWO rows.** The nearest precedent,
 *     `recipe_ingredient_verifications`, stores its `model_id` as an ATTRIBUTE, and that is right for a
 *     judgement. A COMPARISON pipeline needs both engines' answers to coexist; keyed that way the second
 *     engine's answer would overwrite the first and U19's comparator would have nothing to compare.
 *  2. **The `(line_digest, engine, engine_version)` UNIQUE index is the invariant, INDEPENDENTLY of the key
 *     derivation.** `parse_key` is a digest of exactly that triple, so in a correct world the index can never
 *     fire. It exists because a second writer, a hand-written statement, or a bug in the derivation would
 *     otherwise produce two rows for one identity, and the comparator would silently adjudicate a duplicate.
 *  3. **A version bump partitions cleanly and the old generation stays REACHABLE.** Both key columns carry the
 *     `{version}:` prefix, so a superseded generation is enumerable (`LIKE 'v1:%'`) rather than invisible.
 *     Without that, a derivation change makes every stored row unreachable while every new row collides with
 *     nothing — nothing errors, the cache just stops hitting, and the only symptom is an engine bill.
 *  4. **KTD-14 — the table holds a digest and a parse, and NO owner link.** That is the whole reason it is
 *     absent from the account-erasure sweep, exactly as `recipe_ingredient_verifications` is. Its `foods[].name`
 *     is a fragment of user-typed text; the mitigation is that the row is shared installation-wide and
 *     addressed by a digest, so it carries no person-to-row link to erase. Asserted, never assumed — and
 *     asserted as SET EQUALITY, so ANY new column reds this test rather than only the four names someone
 *     thought to deny.
 *  5. **The engine vocabulary and the non-empty engine version are the OTHER writer's floor.** An unrecognised
 *     engine is a cached parse no reader can interpret; an unversioned one can never be re-partitioned out.
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so a machine without the harness skips in lockstep with
 * `tests/globalSetup.ts`, which applies every `src/database/migrations/*.sql` in filename order.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/**
 * Digests unique to this suite, so its rows never collide with another spec's.
 *
 * Shaped like the real thing — `{version}:{hex}` — because both the prefix query and the version-bump
 * assertion below are about that shape.
 */
const LINE_A = 'v1:u20parsecache00000000000000000000000000000000000000000000000a';
const LINE_B = 'v1:u20parsecache00000000000000000000000000000000000000000000000b';
/** The SAME line, in the NEXT generation — what a `PARSE_KEY_VERSION` bump produces. */
const LINE_A_V2 = 'v2:u20parsecache00000000000000000000000000000000000000000000000a';

const KEY_CRF = 'v1:u20key0000000000000000000000000000000000000000000000000000crf';
const KEY_LLM = 'v1:u20key0000000000000000000000000000000000000000000000000000llm';
const KEY_B = 'v1:u20key000000000000000000000000000000000000000000000000000000b';
const KEY_V2 = 'v2:u20key0000000000000000000000000000000000000000000000000000crf';
/** A DIFFERENT key over the SAME identity — what a derivation bug or a second writer would produce. */
const KEY_DUPLICATE_IDENTITY = 'v1:u20key000000000000000000000000000000000000000000000000000dup';

const CRF_VERSION = 'crf-ingredient-phrase-tagger@0.1.0';
const LLM_VERSION = 'amazon.nova-micro-v1:0+prompt@1';

/** A parse payload shaped like U16's `ParsedLine` will be. The column stores it verbatim and reads nothing. */
const PARSE = { quantity: { kind: 'exact', value: 2 }, unit: 'cup', foods: [{ name: 'flour', prep: null }] };

describe.skipIf(!hasDatabaseUrl)('U20 parse cache schema (migration 0028)', () => {
    let pool: pg.Pool;

    /**
     * Insert one cache row.
     *
     * @param parseKey - The row's primary key.
     * @param overrides - Column values to vary from the baseline.
     * @returns The query result.
     * @sideEffect Writes to the test database.
     */
    const insert = (parseKey: string, overrides: Record<string, unknown> = {}): Promise<pg.QueryResult> => {
        const row = {
            line_digest: LINE_A,
            engine: 'crf',
            engine_version: CRF_VERSION,
            parse: PARSE,
            ...overrides,
        };

        return pool.query(
            `INSERT INTO ingredient_parse_cache (parse_key, line_digest, engine, engine_version, parse)
             VALUES ($1, $2, $3, $4, $5)`,
            [parseKey, row.line_digest, row.engine, row.engine_version, JSON.stringify(row.parse)],
        );
    };

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM ingredient_parse_cache WHERE line_digest = ANY($1)`, [
            [LINE_A, LINE_B, LINE_A_V2],
        ]);
    });

    afterAll(async () => {
        await pool.end();
    });

    it('exists, and stores the parse verbatim as structured JSON', async () => {
        // The whole point of this tier: the table SHIPS from this package while U22's pipeline that writes it
        // lives in recipe-workers, which ships no migration SQL and no runner. Filed there, nothing would ever
        // have applied it, and every unit suite would have stayed green.
        await insert(KEY_CRF);

        const { rows } = await pool.query<{ parse: unknown; engine: string; engine_version: string }>(
            `SELECT parse, engine, engine_version FROM ingredient_parse_cache WHERE parse_key = $1`,
            [KEY_CRF],
        );

        expect(rows[0]).toEqual({ parse: PARSE, engine: 'crf', engine_version: CRF_VERSION });
    });

    it('holds TWO rows for one line under two engines — KTD-13', async () => {
        // ⛔ The property the whole key design exists for. If the engine were an attribute rather than a member
        // of the identity, the LLM's answer would overwrite the CRF's and the comparator would adjudicate one
        // answer against itself.
        await insert(KEY_CRF, { engine: 'crf', engine_version: CRF_VERSION });
        await insert(KEY_LLM, { engine: 'llm', engine_version: LLM_VERSION });

        const { rows } = await pool.query<{ engine: string }>(
            `SELECT engine FROM ingredient_parse_cache WHERE line_digest = $1 ORDER BY engine`,
            [LINE_A],
        );

        expect(rows.map((row) => row.engine)).toEqual(['crf', 'llm']);
    });

    it('re-partitions a CRF version bump WITHOUT touching the LLM half', async () => {
        // KTD-13's second half: a CRF version bump invalidates only CRF rows. The LLM row survives to be
        // re-compared against the new CRF pairing, so a version bump costs one engine call per line, not two.
        await insert(KEY_CRF, { engine: 'crf', engine_version: CRF_VERSION });
        await insert(KEY_LLM, { engine: 'llm', engine_version: LLM_VERSION });
        await insert(KEY_B, { engine: 'crf', engine_version: 'crf-ingredient-phrase-tagger@0.2.0' });

        const { rows } = await pool.query<{ engine: string; engine_version: string }>(
            `SELECT engine, engine_version FROM ingredient_parse_cache
              WHERE line_digest = $1 ORDER BY engine, engine_version`,
            [LINE_A],
        );

        expect(rows).toEqual([
            { engine: 'crf', engine_version: CRF_VERSION },
            { engine: 'crf', engine_version: 'crf-ingredient-phrase-tagger@0.2.0' },
            { engine: 'llm', engine_version: LLM_VERSION },
        ]);
    });

    it('is keyed on the CONTENT, so re-caching the same parse is idempotent by primary key', async () => {
        // The property that makes a redelivered pipeline message safe: writing the same parse again must not
        // error and must not duplicate. `ON CONFLICT DO NOTHING` is the write, so the FIRST parse of a
        // generation stands — see the migration header for why a cache row is write-once.
        await insert(KEY_CRF);

        await pool.query(
            `INSERT INTO ingredient_parse_cache (parse_key, line_digest, engine, engine_version, parse)
             VALUES ($1, $2, 'crf', $3, $4)
             ON CONFLICT (parse_key) DO NOTHING`,
            [KEY_CRF, LINE_A, CRF_VERSION, JSON.stringify({ foods: [{ name: 'REWRITTEN', prep: null }] })],
        );

        const { rows } = await pool.query<{ parse: unknown; count: string }>(
            `SELECT parse, count(*) OVER () AS count FROM ingredient_parse_cache WHERE line_digest = $1`,
            [LINE_A],
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]?.parse).toEqual(PARSE);
    });

    it('REFUSES a bare duplicate primary key, so a non-upserting writer fails loudly', async () => {
        await insert(KEY_CRF);

        await expect(insert(KEY_CRF)).rejects.toThrow(/duplicate key|ingredient_parse_cache_pkey/u);
    });

    it('REFUSES a SECOND row for one (line_digest, engine, engine_version), whatever its key says', async () => {
        // ⛔ Not redundant with the primary key. `parse_key` is a digest OF this triple, so in a correct world
        // this index can never fire — which is exactly why it is here. A derivation bug, a hand-written
        // statement or a second writer keyed differently would otherwise produce two rows for one identity, and
        // the comparator would silently adjudicate a duplicate as if it were a second engine's answer.
        await insert(KEY_CRF);

        await expect(insert(KEY_DUPLICATE_IDENTITY)).rejects.toThrow(/idx_parse_cache_identity/u);
    });

    it('keeps a superseded generation REACHABLE by prefix', async () => {
        // ⛔ The version-bump rule's payoff, and the reason both key columns carry `{version}:` rather than the
        // prefix living only in front of the digest. A bump makes the old generation INERT; without an
        // enumerable prefix it would also be invisible, and nobody could measure or reclaim it.
        await insert(KEY_CRF, { line_digest: LINE_A });
        await insert(KEY_V2, { line_digest: LINE_A_V2 });

        const superseded = await pool.query<{ parse_key: string }>(
            `SELECT parse_key FROM ingredient_parse_cache
              WHERE line_digest LIKE 'v1:%' AND line_digest = ANY($1)`,
            [[LINE_A, LINE_A_V2]],
        );
        const current = await pool.query<{ parse_key: string }>(
            `SELECT parse_key FROM ingredient_parse_cache
              WHERE line_digest LIKE 'v2:%' AND line_digest = ANY($1)`,
            [[LINE_A, LINE_A_V2]],
        );

        expect(superseded.rows.map((row) => row.parse_key)).toEqual([KEY_CRF]);
        expect(current.rows.map((row) => row.parse_key)).toEqual([KEY_V2]);
    });

    it.each([['pycrfsuite'], ['CRF'], ['bedrock'], ['']])(
        'REFUSES the unrecognised engine %s — no reader has an interpretation for one',
        async (engine) => {
            await expect(insert(KEY_CRF, { engine })).rejects.toThrow(/ingredient_parse_cache_engine_check/u);
        },
    );

    it('REFUSES an empty engine version, which could never be re-partitioned out', async () => {
        // An unversioned parse is a row a version bump cannot reach: it belongs to no generation, so it is
        // served forever. The pure key module is deliberately TOTAL and does not validate this; the database is
        // where the floor lives, which is why it is asserted here rather than in the unit suite.
        await expect(insert(KEY_CRF, { engine_version: '' })).rejects.toThrow(
            /ingredient_parse_cache_engine_version_nonempty/u,
        );
    });

    it.each([[''], ['abc123'], ['v:abc123'], ['1:abc123'], ['deadbeef:abc']])(
        'REFUSES the unversioned line digest %s',
        async (lineDigest) => {
            // ⛔ Two failures in one constraint, both silent.
            //
            // `''` is a misconfigured digest port: every line maps to ONE row, and one line's parse is served
            // for the whole corpus. An UNPREFIXED digest is subtler — the row is fine, but it belongs to no
            // generation, so a `PARSE_KEY_VERSION` bump cannot enumerate it and it is served forever.
            //
            // The shape is a DERIVED, machine-written value, so a malformed one is a code defect that must be
            // loud rather than absorbed — the reasoning `verification_spend_period_format` already establishes.
            await expect(insert(KEY_CRF, { line_digest: lineDigest })).rejects.toThrow(
                /ingredient_parse_cache_line_digest_versioned/u,
            );
        },
    );

    it.each([[''], ['abc123'], ['v:abc123']])('REFUSES the unversioned parse key %s', async (parseKey) => {
        // Same invariant on the primary key. `WHERE parse_key LIKE 'v1:%'` is how a superseded generation is
        // measured and reclaimed; a row that does not carry a version is invisible to it.
        await expect(insert(parseKey)).rejects.toThrow(/ingredient_parse_cache_parse_key_versioned/u);
    });

    it.each([['"just a string"'], ['[1, 2]'], ['null'], ['42']])(
        'REFUSES the non-object parse %s — the column holds STRUCTURED output, not text',
        async (json) => {
            await expect(
                pool.query(
                    `INSERT INTO ingredient_parse_cache (parse_key, line_digest, engine, engine_version, parse)
                     VALUES ($1, $2, 'crf', $3, $4::jsonb)`,
                    [KEY_CRF, LINE_A, CRF_VERSION, json],
                ),
            ).rejects.toThrow(/ingredient_parse_cache_parse_object/u);
        },
    );

    it('holds NO owner link and no user-identifying column — KTD-14, the erasure argument', async () => {
        // ⛔ This table is absent from the account-erasure sweep, and this assertion IS the argument for that.
        // A `owner_id`/`user_id`/`recipe_id` column would make the row person-linked, and the sweep would have
        // to grow a step it has no idea it is missing — the same retrofit `ingredient_resolution_mappings` and
        // `ingredient_resolution_memos` both needed.
        //
        // ⚠️ SET EQUALITY, not a denylist. A denylist only catches the names someone thought of; this catches
        // ANY new column, so adding one must be a deliberate act that reds this test — at which point whoever
        // adds it owes an erasure decision, which is exactly the conversation that did not happen twice before.
        const { rows } = await pool.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
              WHERE table_name = 'ingredient_parse_cache' ORDER BY column_name`,
        );

        expect(rows.map((row) => row.column_name)).toEqual([
            'engine',
            'engine_version',
            'line_digest',
            'parse',
            'parse_key',
            'parsed_at',
        ]);
    });

    it('stores no raw source line — the line survives only as a digest', async () => {
        // The narrower half of KTD-14, stated positively: the ONLY representation of the cook's text in this
        // table is a one-way digest. Named columns are denied explicitly so the intent is readable at the
        // point of failure, even though the set equality above subsumes them.
        const { rows } = await pool.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns WHERE table_name = 'ingredient_parse_cache'`,
        );
        const columns = rows.map((row) => row.column_name);

        expect(columns).not.toContain('source_line');
        expect(columns).not.toContain('raw_line');
        expect(columns).not.toContain('owner_id');
        expect(columns).not.toContain('author_id');
    });

    it('serves the comparator read — both engines for one line — from the identity index', async () => {
        // ⛔ Asserted rather than assumed: without the index the query still returns the right answer by
        // sequential scan, so the suite stays green while the pipeline's hottest read degrades silently as the
        // table grows. `line_digest` is the index's LEFTMOST column, which is what makes it serve this read as
        // well as enforce the uniqueness above — one index, two jobs, and no second write cost.
        const { rows } = await pool.query<{ indexdef: string }>(
            `SELECT indexdef FROM pg_indexes
              WHERE tablename = 'ingredient_parse_cache' AND indexname = 'idx_parse_cache_identity'`,
        );

        expect(rows[0]?.indexdef).toMatch(/UNIQUE INDEX .* \(line_digest, engine, engine_version\)/u);
    });
});
