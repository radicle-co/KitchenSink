/**
 * U10 — THE RESOLUTION KNOWLEDGE BASE'S SCHEMA, ASSERTED AGAINST A REAL POSTGRES (migration 0021).
 *
 * ⛔ WHY THIS TIER, AND NOT A DRIZZLE-DEFINITION UNIT TEST. Every property this unit's correctness rests on
 * is a property of the DATABASE, and neither a mock nor a definition-only test can observe any of them:
 *
 *  1. **The partial unique indexes ARE the concurrency control.** "Independent corroboration" is a count of
 *     distinct authors, and it is only that because `(normalized_key, author_id) WHERE scope='author' AND
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

/** Insert a mapping, returning its id. Written long-hand so each spec's SQL is readable where it is used. */
async function insertMapping(
    pool: pg.Pool,
    row: {
        key: string;
        foodId: string;
        scope: 'author' | 'global';
        origin: 'author' | 'curator' | 'corroboration';
        authorId: string | null;
        corroboratedA?: string;
        corroboratedB?: string;
    },
): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO ingredient_resolution_mappings
             (normalized_key, source_phrase, food_id, scope, origin, author_id, surfacing,
              corroborated_a, corroborated_b)
         VALUES ($1, $1, $2, $3, $4, $5, 'picker_correction', $6, $7)
         RETURNING id`,
        [
            row.key,
            row.foodId,
            row.scope,
            row.origin,
            row.authorId,
            row.corroboratedA ?? null,
            row.corroboratedB ?? null,
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
                     (normalized_key, source_phrase, food_id, scope, origin, author_id, surfacing)
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
                         (normalized_key, source_phrase, food_id, scope, origin, author_id, surfacing)
                     VALUES ($1, $1, $2, $3, $4, $5, 'picker_correction')`,
                    [KEY, FOOD_A, scope, origin, AUTHOR_A],
                ),
            ).rejects.toThrow(matcher);
        });

        it('REJECTS a global mapping that cites NO justification — the corroboration audit is not optional', async () => {
            await expect(
                pool.query(
                    `INSERT INTO ingredient_resolution_mappings
                         (normalized_key, source_phrase, food_id, scope, origin, author_id, surfacing)
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
                authorId: AUTHOR_A,
            });

            await expect(
                insertMapping(pool, {
                    key: KEY,
                    foodId: FOOD_A,
                    scope: 'global',
                    origin: 'corroboration',
                    authorId: null,
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
                authorId: AUTHOR_A,
            });

            await expect(
                pool.query('UPDATE ingredient_resolution_mappings SET superseded_by = $1 WHERE id = $1', [id]),
            ).rejects.toThrow(/supersession_forward|supersession_coherent/);

            // A retirement with NO successor is LEGAL and load-bearing: it is the shape the prescribed
            // account-erasure sweep uses to stop a user's mappings applying without replacing them.
            await expect(
                pool.query(
                    `UPDATE ingredient_resolution_mappings
                     SET superseded_at = now(), author_id = NULL, source_phrase = NULL WHERE id = $1`,
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
                authorId: AUTHOR_A,
            });

            // The SAME author correcting the SAME phrase again without retiring their first row is the write
            // that would let one account corroborate itself into a global mapping. Refused at the index.
            await expect(
                insertMapping(pool, {
                    key: KEY,
                    foodId: FOOD_B,
                    scope: 'author',
                    origin: 'author',
                    authorId: AUTHOR_A,
                }),
            ).rejects.toThrow(/idx_resolution_mappings_live_author/);

            // A DIFFERENT author is exactly what corroboration means, and is admitted.
            await expect(
                insertMapping(pool, {
                    key: KEY,
                    foodId: FOOD_A,
                    scope: 'author',
                    origin: 'author',
                    authorId: AUTHOR_B,
                }),
            ).resolves.toBeDefined();
        });

        it('frees the (phrase, author) slot once the earlier row is SUPERSEDED, so history survives', async () => {
            const first = await insertMapping(pool, {
                key: KEY,
                foodId: FOOD_A,
                scope: 'author',
                origin: 'author',
                authorId: AUTHOR_A,
            });
            const unrelated = await insertMapping(pool, {
                key: OTHER_KEY,
                foodId: FOOD_B,
                scope: 'author',
                origin: 'author',
                authorId: AUTHOR_A,
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
                    authorId: AUTHOR_A,
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
                authorId: AUTHOR_A,
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
                    authorId: AUTHOR_B,
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
                    authorId: AUTHOR_B,
                }),
            ).resolves.toBeDefined();
        });

        it('permits ONE corroboration binding per pair, so the concurrent promotion race has a loser, not an error', async () => {
            const a = await insertMapping(pool, {
                key: KEY,
                foodId: FOOD_A,
                scope: 'author',
                origin: 'author',
                authorId: AUTHOR_A,
            });
            const b = await insertMapping(pool, {
                key: KEY,
                foodId: FOOD_A,
                scope: 'author',
                origin: 'author',
                authorId: AUTHOR_B,
            });

            await insertMapping(pool, {
                key: KEY,
                foodId: FOOD_A,
                scope: 'global',
                origin: 'corroboration',
                authorId: null,
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
                    authorId: null,
                    corroboratedA: a,
                    corroboratedB: b,
                }),
            ).rejects.toThrow(/idx_resolution_mappings_(corroboration_pair|live_global)/);
        });
    });

    describe('ingredient_resolution_memos — the machine-derived tier', () => {
        it('records the model that AGREED with the resolution (R21) and keys one memo per phrase', async () => {
            await pool.query(
                `INSERT INTO ingredient_resolution_memos (normalized_key, food_id, source_phrase, verified_by)
                 VALUES ($1, $2, 'Plain Flour', 'model-v1')`,
                [KEY, FOOD_A],
            );

            // A re-verification under a newer model REPLACES the memo rather than accumulating beside it: a
            // memo is a food id, not a vector, so a newer judge's answer supersedes an older one.
            await expect(
                pool.query(
                    `INSERT INTO ingredient_resolution_memos (normalized_key, food_id, source_phrase, verified_by)
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
                `INSERT INTO ingredient_resolution_memos (normalized_key, food_id, source_phrase, verified_by)
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
 * ⛔ MIGRATION 0026 — THE MEMO TIER'S ERASABILITY, asserted against the real schema.
 *
 * 0021 shipped `ingredient_resolution_memos.source_phrase` as `NOT NULL` and with no author column beside it,
 * and its header recorded the consequence: account erasure had no predicate to sweep on, so a phrase a user
 * typed was unreachable. Owner ruling 2026-08-23 closed that by ADDING `owner_id` rather than by dropping the
 * phrase, and 0026 is that change.
 *
 * ⛔ THIS TIER, not a unit test, for the reason the file header already gives about the indexes: the
 * erasure sweep's correctness rests on properties only the database has. Specifically —
 *
 *  1. **`source_phrase` must have LOST its `NOT NULL`.** The sweep sets it to NULL. Against the 0021
 *     constraint that statement raises `23502` and fails the whole erasure job, and no mock can see it.
 *  2. **The de-identified row must SURVIVE, carrying the machine's conclusion.** A memo is keyed by
 *     `normalized_key` alone and is read by every user's cascade; the difference between "erased" and
 *     "deleted" here is the difference between de-identifying one row and un-resolving that phrase for the
 *     whole installation.
 *  3. **The sweep must be SCOPED.** Two owners can hold memos at once, and the predicate is the only thing
 *     that separates them.
 */
describe.skipIf(!hasDatabaseUrl)('ingredient_resolution_memos — erasability (migration 0026)', () => {
    const MEMO_KEY = 'u10 schema memo plain flour';
    const OTHER_MEMO_KEY = 'u10 schema memo caster sugar';
    const OWNER_A = '01JU10SCHEMA0000000OWNERA';
    const OWNER_B = '01JU10SCHEMA0000000OWNERB';

    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
    });

    afterAll(async () => {
        await pool.end();
    });

    afterEach(async () => {
        await pool.query('DELETE FROM ingredient_resolution_memos WHERE normalized_key LIKE $1', ['u10 schema memo%']);
    });

    /** Insert one memo exactly as `verdictStore.rememberAgreement` does. */
    const insertMemo = async (key: string, ownerId: string | null): Promise<void> => {
        await pool.query(
            `INSERT INTO ingredient_resolution_memos (normalized_key, food_id, source_phrase, verified_by, owner_id)
             VALUES ($1, $2, $3, 'us.amazon.nova-micro-v1:0', $4)`,
            [key, FOOD_A, `${key} as the cook typed it`, ownerId],
        );
    };

    it('accepts a NULL source_phrase — without which the erasure sweep raises 23502', async () => {
        await insertMemo(MEMO_KEY, OWNER_A);

        await expect(
            pool.query('UPDATE ingredient_resolution_memos SET source_phrase = NULL WHERE normalized_key = $1', [
                MEMO_KEY,
            ]),
        ).resolves.toBeDefined();
    });

    it('still admits a memo with no owner — the shape a pre-0026 producer sends', async () => {
        await expect(insertMemo(MEMO_KEY, null)).resolves.toBeUndefined();
    });

    it('de-identifies the erased owner’s memo while keeping the machine’s conclusion', async () => {
        await insertMemo(MEMO_KEY, OWNER_A);

        // The sweep, verbatim from `accountErasureWorker.eraseRecipeRows`.
        await pool.query(
            'UPDATE ingredient_resolution_memos SET owner_id = NULL, source_phrase = NULL WHERE owner_id = $1',
            [OWNER_A],
        );

        const { rows } = await pool.query<{
            food_id: string;
            verified_by: string;
            source_phrase: string | null;
            owner_id: string | null;
        }>(
            'SELECT food_id, verified_by, source_phrase, owner_id FROM ingredient_resolution_memos WHERE normalized_key = $1',
            [MEMO_KEY],
        );

        // ⛔ The row SURVIVES. Deleting it would un-resolve this phrase for every other user.
        expect(rows).toHaveLength(1);
        expect(rows[0]?.source_phrase).toBeNull();
        expect(rows[0]?.owner_id).toBeNull();
        expect(rows[0]?.food_id).toBe(FOOD_A);
        expect(rows[0]?.verified_by).toBe('us.amazon.nova-micro-v1:0');
    });

    it('sweeps ONLY the erased owner’s memos', async () => {
        await insertMemo(MEMO_KEY, OWNER_A);
        await insertMemo(OTHER_MEMO_KEY, OWNER_B);

        await pool.query(
            'UPDATE ingredient_resolution_memos SET owner_id = NULL, source_phrase = NULL WHERE owner_id = $1',
            [OWNER_A],
        );

        const { rows } = await pool.query<{ source_phrase: string | null; owner_id: string | null }>(
            'SELECT source_phrase, owner_id FROM ingredient_resolution_memos WHERE normalized_key = $1',
            [OTHER_MEMO_KEY],
        );

        expect(rows[0]?.owner_id).toBe(OWNER_B);
        expect(rows[0]?.source_phrase).not.toBeNull();
    });

    /**
     * ⚠️ The pair rule, which is the subtle one. The table's primary key is the normalized phrase, so two
     * users whose lines normalize alike share ONE row and the later write replaces both columns together. A
     * writer that updated the phrase while leaving the previous owner's id beside it would point erasure at
     * the wrong person: sweeping a phrase they never typed, and leaving the one they did.
     */
    it('moves owner_id and source_phrase as a pair on re-agreement', async () => {
        await insertMemo(MEMO_KEY, OWNER_A);

        await pool.query(
            `INSERT INTO ingredient_resolution_memos (normalized_key, food_id, source_phrase, verified_by, owner_id)
             VALUES ($1, $2, $3, 'us.anthropic.claude-haiku-4-5-20251001-v1:0', $4)
             ON CONFLICT (normalized_key) DO UPDATE
                SET food_id = EXCLUDED.food_id,
                    source_phrase = EXCLUDED.source_phrase,
                    verified_by = EXCLUDED.verified_by,
                    owner_id = EXCLUDED.owner_id,
                    verified_at = now()`,
            [MEMO_KEY, FOOD_B, 'the second cook’s wording', OWNER_B],
        );

        const { rows } = await pool.query<{ source_phrase: string | null; owner_id: string | null }>(
            'SELECT source_phrase, owner_id FROM ingredient_resolution_memos WHERE normalized_key = $1',
            [MEMO_KEY],
        );

        expect(rows[0]?.owner_id).toBe(OWNER_B);
        expect(rows[0]?.source_phrase).toBe('the second cook’s wording');
    });

    it('indexes owner_id partially, so the sweep is not a sequential scan', async () => {
        const { rows } = await pool.query<{ indexdef: string }>(
            `SELECT indexdef FROM pg_indexes
              WHERE tablename = 'ingredient_resolution_memos' AND indexname = 'idx_resolution_memos_owner'`,
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]?.indexdef).toMatch(/WHERE \(owner_id IS NOT NULL\)/i);
    });
});
