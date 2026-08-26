/**
 * U10 — THE RESOLUTION KNOWLEDGE BASE'S SCHEMA, ASSERTED AGAINST A REAL POSTGRES (migration 0021).
 *
 * ⛔ WHY THIS TIER, AND NOT A DRIZZLE-DEFINITION UNIT TEST. Every property this unit's correctness rests on
 * is a property of the DATABASE, and neither a mock nor a definition-only test can observe any of them:
 *
 *  1. **The partial unique indexes ARE the concurrency control.** "Independent corroboration" is a count of
 *     distinct users, and it is only that because `(normalized_key, user_id) WHERE scope='author' AND
 *     superseded_at IS NULL` makes a second live row from one author impossible. "At most one global mapping
 *     is in force per phrase" is likewise an index, not a code path. A unit test asserting the DAL "calls
 *     insert" proves neither, so both are proved here by DRIVING the collision.
 *  2. **The CHECK constraints make illegal states UNREPRESENTABLE**, and the states they exclude are exactly
 *     the ones the pure policy assumes cannot exist: a global mapping with no justification, a corroboration
 *     citing one row twice, a scope and an origin that disagree.
 *  3. **`gist_trgm_ops` is what makes tier 3 a nearest-neighbour tier** (R14). Without the index the `<->`
 *     query still returns the right answer by sequential scan and the suite stays GREEN while a
 *     per-resolution path silently becomes a full-table sort. So the index itself is asserted.
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so a machine without the harness skips in lockstep with
 * `tests/globalSetup.ts`, which applies every `src/database/migrations/*.sql` in filename order.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

/** Keys unique to this suite so its rows never collide with another integration spec's. */
const KEY = 'u10 schema plain flour';
const OTHER_KEY = 'u10 schema caster sugar';
const FOOD_A = '01JU10SCHEMA000000000FOODA';
const FOOD_B = '01JU10SCHEMA000000000FOODB';
const AUTHOR_A = '01JU10SCHEMA00000000AUTHA';
const AUTHOR_B = '01JU10SCHEMA00000000AUTHB';

/**
 * Insert a mapping, returning its id. Written long-hand so each spec's SQL is readable where it is used.
 *
 * ⛔ `source_phrase` is bound to the key for an AUTHORED row and to NULL for a `corroboration` binding.
 * 0031's `…_phrase_needs_owner` used to make any other pairing a row PostgreSQL refuses; ADR-0027 repealed
 * that CHECK, but `promoteByCorroboration` still copies nobody's words for the reason that OUTLIVED the
 * reversal — the binding CITES two rows that each carry their own phrase, so the copy bought nothing. This
 * helper mirrors the writer rather than the (now absent) constraint.
 */
async function insertMapping(
    pool: pg.Pool,
    row: {
        key: string;
        foodId: string;
        scope: 'author' | 'global';
        origin: 'author' | 'curator' | 'corroboration';
        userId: string | null;
        corroboratedA?: string;
        corroboratedB?: string;
    },
): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO ingredient_resolution_mappings
             (normalized_key, source_phrase, food_id, scope, origin, user_id, surfacing,
              corroborated_a, corroborated_b)
         VALUES ($1, $8, $2, $3, $4, $5, 'picker_correction', $6, $7)
         RETURNING id`,
        [
            row.key,
            row.foodId,
            row.scope,
            row.origin,
            row.userId,
            row.corroboratedA ?? null,
            row.corroboratedB ?? null,
            row.userId === null ? null : row.key,
        ],
    );

    return rows[0]!.id;
}

describe.skipIf(!hasDatabaseUrl)('migration 0021 — the resolution knowledge base', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
    });

    afterEach(async () => {
        // Ordered: corroboration rows reference author rows, so clear the citing rows first.
        await pool.query(
            `DELETE FROM ingredient_resolution_mappings
             WHERE normalized_key LIKE 'u10 schema%' AND origin = 'corroboration'`,
        );
        await pool.query('DELETE FROM ingredient_resolution_mappings WHERE normalized_key LIKE $1', ['u10 schema%']);
        await pool.query('DELETE FROM ingredient_resolution_memos WHERE normalized_key LIKE $1', ['u10 schema%']);
    });

    afterAll(async () => {
        await pool.end();
    });

    describe('ingredient_resolution_mappings — the curated, human-authored tier', () => {
        it('accepts a well-formed author-scoped mapping and is born LIVE', async () => {
            const { rows } = await pool.query<{
                id: string;
                scope: string;
                origin: string;
                superseded_at: Date | null;
                created_at: Date;
            }>(
                `INSERT INTO ingredient_resolution_mappings
                     (normalized_key, source_phrase, food_id, scope, origin, user_id, surfacing)
                 VALUES ($1, 'Plain Flour', $2, 'author', 'author', $3, 'picker_correction')
                 RETURNING id, scope, origin, superseded_at, created_at`,
                [KEY, FOOD_A, AUTHOR_A],
            );

            expect(rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
            expect(rows[0]!.scope).toBe('author');
            // If `superseded_at` defaulted to anything but NULL, every row would be born retired and BOTH
            // partial unique indexes would police an empty set.
            expect(rows[0]!.superseded_at).toBeNull();
            expect(rows[0]!.created_at).toBeInstanceOf(Date);
        });

        it.each([
            ['a scope outside the enum', 'installation', 'author', /scope_check/],
            ['an origin outside the enum', 'author', 'oracle', /origin_check/],
            ['a global scope with an author origin', 'global', 'author', /scope_origin_agree/],
            ['an author scope with a curator origin', 'author', 'curator', /scope_origin_agree/],
        ])('REJECTS %s', async (_label, scope, origin, matcher) => {
            await expect(
                pool.query(
                    `INSERT INTO ingredient_resolution_mappings
                         (normalized_key, source_phrase, food_id, scope, origin, user_id, surfacing)
                     VALUES ($1, $1, $2, $3, $4, $5, 'picker_correction')`,
                    [KEY, FOOD_A, scope, origin, AUTHOR_A],
                ),
            ).rejects.toThrow(matcher);
        });

        it('REJECTS a global mapping that cites NO justification — the corroboration audit is not optional', async () => {
            await expect(
                pool.query(
                    `INSERT INTO ingredient_resolution_mappings
                         (normalized_key, source_phrase, food_id, scope, origin, user_id, surfacing)
                     VALUES ($1, $1, $2, 'global', 'corroboration', NULL, 'corroboration')`,
                    [KEY, FOOD_A],
                ),
            ).rejects.toThrow(/corroboration_cites_both/);
        });

        it('REJECTS a corroboration citing ONE row twice — an author cannot corroborate themselves', async () => {
            const own = await insertMapping(pool, {
                key: KEY,
                foodId: FOOD_A,
                scope: 'author',
                origin: 'author',
                userId: AUTHOR_A,
            });

            await expect(
                insertMapping(pool, {
                    key: KEY,
                    foodId: FOOD_A,
                    scope: 'global',
                    origin: 'corroboration',
                    userId: null,
                    corroboratedA: own,
                    corroboratedB: own,
                }),
            ).rejects.toThrow(/corroboration_distinct/);
        });

        it('REJECTS a successor recorded with no retirement, but ALLOWS a retirement with no successor', async () => {
            const id = await insertMapping(pool, {
                key: KEY,
                foodId: FOOD_A,
                scope: 'author',
                origin: 'author',
                userId: AUTHOR_A,
            });

            await expect(
                pool.query('UPDATE ingredient_resolution_mappings SET superseded_by = $1 WHERE id = $1', [id]),
            ).rejects.toThrow(/supersession_forward|supersession_coherent/);

            // ⚠️ A retirement with NO successor is LEGAL, and it stays asserted even though the erasure
            // sweep that used to produce it is gone (ADR-0027). The asymmetry is still load-bearing: a
            // curator's supersession and a concurrent-race loser both retire a row with nothing to point at,
            // and a constraint written the obvious way (`superseded_at IS NULL = superseded_by IS NULL`)
            // would refuse them. Nulling both identifying columns in the same statement is now merely a
            // legal row shape rather than a prescribed one — which is itself worth pinning, since ADR-0027
            // repealed the CHECK that used to forbid one half of it.
            await expect(
                pool.query(
                    `UPDATE ingredient_resolution_mappings
                     SET superseded_at = now(), user_id = NULL, source_phrase = NULL WHERE id = $1`,
                    [id],
                ),
            ).resolves.toBeDefined();
        });

        it('permits ONE live author-scoped mapping per (phrase, author) — the corroboration counter IS this index', async () => {
            await insertMapping(pool, {
                key: KEY,
                foodId: FOOD_A,
                scope: 'author',
                origin: 'author',
                userId: AUTHOR_A,
            });

            // The SAME author correcting the SAME phrase again without retiring their first row is the write
            // that would let one account corroborate itself into a global mapping. Refused at the index.
            await expect(
                insertMapping(pool, {
                    key: KEY,
                    foodId: FOOD_B,
                    scope: 'author',
                    origin: 'author',
                    userId: AUTHOR_A,
                }),
            ).rejects.toThrow(/idx_resolution_mappings_live_user/);

            // A DIFFERENT author is exactly what corroboration means, and is admitted.
            await expect(
                insertMapping(pool, {
                    key: KEY,
                    foodId: FOOD_A,
                    scope: 'author',
                    origin: 'author',
                    userId: AUTHOR_B,
                }),
            ).resolves.toBeDefined();
        });

        it('frees the (phrase, author) slot once the earlier row is SUPERSEDED, so history survives', async () => {
            const first = await insertMapping(pool, {
                key: KEY,
                foodId: FOOD_A,
                scope: 'author',
                origin: 'author',
                userId: AUTHOR_A,
            });
            const unrelated = await insertMapping(pool, {
                key: OTHER_KEY,
                foodId: FOOD_B,
                scope: 'author',
                origin: 'author',
                userId: AUTHOR_A,
            });

            await pool.query(
                'UPDATE ingredient_resolution_mappings SET superseded_at = now(), superseded_by = $2 WHERE id = $1',
                [first, unrelated],
            );

            // R20's "a later correction supersedes it rather than being refused" — the author may now write a
            // fresh live row for the same phrase…
            await expect(
                insertMapping(pool, {
                    key: KEY,
                    foodId: FOOD_B,
                    scope: 'author',
                    origin: 'author',
                    userId: AUTHOR_A,
                }),
            ).resolves.toBeDefined();

            // …and the retired row is still readable, which is what makes the trail an audit trail.
            const { rows } = await pool.query('SELECT id FROM ingredient_resolution_mappings WHERE id = $1', [first]);

            expect(rows).toHaveLength(1);
        });

        it('permits AT MOST ONE live GLOBAL mapping per phrase, so tier 1 is deterministic', async () => {
            await insertMapping(pool, {
                key: KEY,
                foodId: FOOD_A,
                scope: 'global',
                origin: 'curator',
                userId: AUTHOR_A,
            });

            // Two live global rows naming different foods is the state in which "which mapping wins?" has no
            // answer. Refused here, so supersession is the ONLY way a global mapping can be replaced — which
            // is what makes the scope policy's supersession gate unbypassable.
            await expect(
                insertMapping(pool, {
                    key: KEY,
                    foodId: FOOD_B,
                    scope: 'global',
                    origin: 'curator',
                    userId: AUTHOR_B,
                }),
            ).rejects.toThrow(/idx_resolution_mappings_live_global/);

            // An AUTHOR-scoped row for the same phrase is untouched by that index: a user's own correction
            // coexists with the global one, and outranks it for that user.
            await expect(
                insertMapping(pool, {
                    key: KEY,
                    foodId: FOOD_B,
                    scope: 'author',
                    origin: 'author',
                    userId: AUTHOR_B,
                }),
            ).resolves.toBeDefined();
        });

        it('permits ONE corroboration binding per pair, so the concurrent promotion race has a loser, not an error', async () => {
            const a = await insertMapping(pool, {
                key: KEY,
                foodId: FOOD_A,
                scope: 'author',
                origin: 'author',
                userId: AUTHOR_A,
            });
            const b = await insertMapping(pool, {
                key: KEY,
                foodId: FOOD_A,
                scope: 'author',
                origin: 'author',
                userId: AUTHOR_B,
            });

            await insertMapping(pool, {
                key: KEY,
                foodId: FOOD_A,
                scope: 'global',
                origin: 'corroboration',
                userId: null,
                corroboratedA: a,
                corroboratedB: b,
            });

            // The second promoter's INSERT conflicts and — with ON CONFLICT DO NOTHING — returns ZERO ROWS,
            // which reads as "somebody else already promoted this". Asserted here without the clause so the
            // conflict itself is visible; the DAL adds the clause.
            await expect(
                insertMapping(pool, {
                    key: KEY,
                    foodId: FOOD_A,
                    scope: 'global',
                    origin: 'corroboration',
                    userId: null,
                    corroboratedA: a,
                    corroboratedB: b,
                }),
            ).rejects.toThrow(/idx_resolution_mappings_(corroboration_pair|live_global)/);
        });
    });

    describe('ingredient_resolution_memos — the machine-derived tier', () => {
        it('records the model that AGREED with the resolution (R21) and keys one memo per phrase', async () => {
            await pool.query(
                `INSERT INTO ingredient_resolution_memos
                     (normalized_key, food_id, source_phrase, verified_by)
                 VALUES ($1, $2, 'Plain Flour', 'model-v1')`,
                [KEY, FOOD_A],
            );

            // A re-verification under a newer model REPLACES the memo rather than accumulating beside it: a
            // memo is a food id, not a vector, so a newer judge's answer supersedes an older one.
            await expect(
                pool.query(
                    `INSERT INTO ingredient_resolution_memos
                         (normalized_key, food_id, source_phrase, verified_by)
                     VALUES ($1, $2, 'Plain Flour', 'model-v2')
                     ON CONFLICT (normalized_key)
                     DO UPDATE SET food_id = EXCLUDED.food_id, verified_by = EXCLUDED.verified_by,
                                   verified_at = now()`,
                    [KEY, FOOD_B],
                ),
            ).resolves.toBeDefined();

            const { rows } = await pool.query<{ food_id: string; verified_by: string }>(
                'SELECT food_id, verified_by FROM ingredient_resolution_memos WHERE normalized_key = $1',
                [KEY],
            );

            expect(rows).toHaveLength(1);
            expect(rows[0]).toEqual({ food_id: FOOD_B, verified_by: 'model-v2' });
        });

        it('carries a GiST trigram index — what makes the near-twin lookup a NEAREST-NEIGHBOUR search', async () => {
            // R14 forbids equality-only matching. Without this index the `<->` query below still returns the
            // right answer by sequential scan, so the suite would stay green while a per-resolution path
            // became a full-table sort. The index is therefore asserted directly.
            const { rows } = await pool.query<{ indexdef: string }>(
                `SELECT indexdef FROM pg_indexes
                 WHERE tablename = 'ingredient_resolution_memos' AND indexname = 'idx_resolution_memos_key_trgm'`,
            );

            expect(rows).toHaveLength(1);
            expect(rows[0]!.indexdef).toContain('gist');
            expect(rows[0]!.indexdef).toContain('gist_trgm_ops');
        });

        it('answers a NEAR-TWIN phrase the knowledge base has never seen verbatim (R14 / AE8)', async () => {
            await pool.query(
                `INSERT INTO ingredient_resolution_memos
                     (normalized_key, food_id, source_phrase, verified_by)
                 VALUES ($1, $2, 'All-purpose flour', 'model-v1')`,
                ['u10 schema all-purpose flour', FOOD_A],
            );

            const { rows } = await pool.query<{ food_id: string; sim: number }>(
                `SELECT food_id, similarity(normalized_key, $1) AS sim
                 FROM ingredient_resolution_memos
                 WHERE normalized_key LIKE 'u10 schema%'
                 ORDER BY normalized_key <-> $1
                 LIMIT 1`,
                ['u10 schema all purpose flour'],
            );

            expect(rows).toHaveLength(1);
            expect(rows[0]!.food_id).toBe(FOOD_A);
            expect(Number(rows[0]!.sim)).toBeGreaterThan(0.5);
        });
    });
});

/**
 * ⛔ THE MEMO TIER IS IMPERSONAL BY CONSTRUCTION (owner ruling 2026-08-25, ADR-0027, migration 0033).
 *
 * ## What this block replaces
 *
 * Six cases stood here, under the heading "erasability (migration 0026)". They asserted that
 * `ingredient_resolution_memos` carried an `owner_id`, that its `source_phrase` had lost the `NOT NULL`
 * 0021 gave it so a sweep could clear it, that the sweep de-identified the row while keeping the machine's
 * conclusion, that it was scoped to one owner, that the two columns moved as a PAIR on re-agreement, and
 * that the sweep's predicate was indexed.
 *
 * Every one of those was about apparatus that migration 0033 removed. The owner ruled that an ingredient
 * phrase is not private data, so 0026's person link — which its own header called *"a person-to-row link it
 * did not hold before"*, added solely to give erasure a predicate — became the single identifying field on
 * an otherwise impersonal row, and went.
 *
 * ## ⛔ Their coverage INVERTS, and the inverse is the stronger claim
 *
 * The old cases could only fail if the erasure apparatus were removed. These fail if it comes BACK — which
 * is the live risk after a reversal, because the two sibling correction tiers DO still carry a user id and
 * re-adding one here looks like restoring a symmetry rather than reintroducing a person.
 */
describe.skipIf(!hasDatabaseUrl)('ingredient_resolution_memos — impersonal by construction (ADR-0027)', () => {
    const MEMO_KEY = 'u10 schema memo plain flour';
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
    });

    afterEach(async () => {
        await pool.query('DELETE FROM ingredient_resolution_memos WHERE normalized_key = $1', [MEMO_KEY]);
    });

    afterAll(async () => {
        await pool.end();
    });

    it('⛔ carries NO column that identifies a person', async () => {
        const { rows } = await pool.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'ingredient_resolution_memos'
              ORDER BY column_name`,
        );
        const columns = rows.map((row) => row.column_name);

        // ⚠️ Non-vacuity first: the table really is there and really does carry its own four columns, so an
        // absent person column is a schema fact rather than an empty result set.
        expect(columns).toEqual(['food_id', 'normalized_key', 'source_phrase', 'verified_at', 'verified_by']);
    });

    it('⛔ carries NO sweep-predicate index and NO phrase-needs-owner CHECK', async () => {
        const indexes = await pool.query<{ indexname: string }>(
            `SELECT indexname FROM pg_indexes WHERE tablename = 'ingredient_resolution_memos'`,
        );
        const checks = await pool.query<{ conname: string }>(
            `SELECT conname FROM pg_constraint
              WHERE conrelid = 'ingredient_resolution_memos'::regclass AND contype = 'c'`,
        );

        // The trigram index and the primary key remain — they are what the tier is FOR.
        expect(indexes.rows.map((row) => row.indexname)).toContain('idx_resolution_memos_key_trgm');
        expect(indexes.rows.map((row) => row.indexname)).not.toContain('idx_resolution_memos_owner');
        // ⛔ 0031's `…_phrase_needs_owner` is gone. Migration 0033 drops it EXPLICITLY (its §1), so the
        // reversal of 0031 is visible in ONE place rather than as an implied side effect — PostgreSQL would
        // also have dropped it along with the column, but a reader should not have to know that to follow
        // the migration. Asserted here rather than assumed by either route.
        expect(checks.rows.map((row) => row.conname)).not.toContain('ingredient_resolution_memos_phrase_needs_owner');
    });

    it('⛔ ACCEPTS a phrase that belongs to nobody — the shape 0031 refused', async () => {
        await expect(
            pool.query(
                `INSERT INTO ingredient_resolution_memos (normalized_key, food_id, source_phrase, verified_by)
                 VALUES ($1, $2, $3, 'us.anthropic.claude-haiku-4-5-20251001-v1:0')`,
                [MEMO_KEY, FOOD_A, 'a cook’s wording, remembered'],
            ),
        ).resolves.toBeDefined();

        const { rows } = await pool.query<{ source_phrase: string | null; verified_by: string }>(
            'SELECT source_phrase, verified_by FROM ingredient_resolution_memos WHERE normalized_key = $1',
            [MEMO_KEY],
        );

        expect(rows).toHaveLength(1);
        // The phrase is kept because it is 0021's two-way door, not because anybody is being attributed.
        expect(rows[0]?.source_phrase).toBe('a cook’s wording, remembered');
        expect(rows[0]?.verified_by).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0');
    });

    it('⚠️ keeps `source_phrase` NULLABLE, which is not the same as keeping it erasable', async () => {
        // 0026 relaxed the `NOT NULL` so a sweep could clear the column, and 0033 removed the sweep — but the
        // relaxation STAYS, for two reasons that have nothing to do with privacy. 0031's backfill already
        // nulled this column on every ownerless memo, so `SET NOT NULL` would fail on real data; and a memo
        // whose phrase normalizes to nothing has none to store.
        await expect(
            pool.query(
                `INSERT INTO ingredient_resolution_memos (normalized_key, food_id, source_phrase, verified_by)
                 VALUES ($1, $2, NULL, 'us.anthropic.claude-haiku-4-5-20251001-v1:0')`,
                [MEMO_KEY, FOOD_A],
            ),
        ).resolves.toBeDefined();
    });
});
