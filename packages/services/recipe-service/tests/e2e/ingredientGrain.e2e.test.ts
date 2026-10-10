/**
 * UNIT 0 — the ingredient data model's GRAIN, asserted against a real migrated PostgreSQL.
 *
 * The owner-ruled model is one sentence: *a recipe has one or more ingredients, and an ingredient has
 * either a food or an unresolved_food.* Migration `0051_ingredient_grain.sql` is what makes that sentence
 * true of the database rather than true of a convention, and every assertion below reads a fact only a
 * migrated server can state.
 *
 * ## ⛔ Why this is a LOCAL e2e spec
 *
 * Owner ruling 2026-09-20 (`docs/CODING_STANDARDS.md` §7.1a): integration tests MOCK the database, and a test
 * that needs the real database is a LOCAL-target e2e test. Nothing here can be proved against a mock: a CHECK
 * constraint, a generated column, a partial unique index, a foreign key's delete action and a dropped table
 * are all facts about the server. A developer runs this tier with `npm run test:e2e`, and it never skips. A LOCAL
 * run proves the schema, never a deploy.
 *
 * It deliberately boots NO Nest app. The subject is the schema, so the HTTP surface would be ceremony
 * between the assertion and the thing asserted. The arm matrix of `food_lookups` lives in
 * `foodLookupArms.e2e.test.ts`.
 *
 * ## ⛔ EVERY ABSENCE HAS A POSITIVE CONTROL IN THE SAME QUERY
 *
 * "The column is gone" passes when the query is simply wrong — a typo'd `table_schema`, a predicate that
 * matches nothing, a catalog view that does not hold what the author assumed. So each absence assertion
 * below asks its predicate for a set that MIXES the things that must be gone with things that must be
 * present, and pins the whole set. A broken query then reports the missing control rather than a green
 * check over a question nobody asked.
 *
 * The pairs that carry their own control are stated where they occur. The `normalized_key` index refuses a
 * second lookup FAILURE and admits a second author DECLARATION. `RESTRICT` refuses a referenced delete and
 * admits an unreferenced one.
 *
 * Every row this file writes is scoped by {@link SCOPE} and removed in `afterAll`, so a run leaves the
 * seeded world exactly as it found it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { UNRESOLVED_FOOD_REASON_CODES } from '@kitchensink/recipe-core';

import { recipeDb } from '../support/roleDb.js';

const roleDb = recipeDb();

/** SQLSTATE `check_violation`. */
const CHECK_VIOLATION = '23514';

/**
 * The prefix every row this file writes carries, in whichever text column identifies it.
 *
 * Scoping is not tidiness: the e2e database is SEEDED, and a fixture that collides with the seeded world
 * fails as a product bug. It is also what makes `afterAll`'s cleanup expressible as four predicates
 * rather than a list of ids the test would have to carry across cases.
 */
const SCOPE = 'e2e-grain';

/** The owner every recipe this file creates belongs to — an app-user ULID, as `recipes.owner_id` holds. */
const SCOPE_OWNER = '01JGRAIN00000000000OWNER00';

/**
 * Run a statement that is expected to be REFUSED and report the server's verdict.
 *
 * ⛔ Returns a sentinel rather than throwing when the statement SUCCEEDS, so the assertion that follows
 * fails on the real outcome ("(statement succeeded)" against "23514") instead of on a thrown error whose
 * message says nothing about which direction broke. A helper that swallowed the success case would let
 * every constraint in this file be deleted with the suite still green.
 *
 * @param text - The statement.
 * @param values - Its bound parameters.
 * @returns The SQLSTATE the server raised, or a sentinel describing why there was none.
 * @sideEffect Executes SQL against the e2e database.
 */
async function sqlStateOf(text: string, values: readonly unknown[] = []): Promise<string> {
    try {
        await pool.query(text, [...values]);
    } catch (error) {
        return (error as { code?: string }).code ?? '(threw with no SQLSTATE)';
    }

    return '(statement succeeded)';
}

let pool: pg.Pool;

/**
 * Insert an `unresolved_foods` row and return its id.
 *
 * @param label - Distinguishes this row from the others a case creates; also scopes its `normalized_key`.
 * @param overrides - Column values that differ from the default failure record.
 * @returns The new row's id.
 * @sideEffect Inserts a row.
 */
async function makeUnresolved(
    label: string,
    overrides: { readonly reasonCode?: string; readonly normalizedKey?: string } = {},
): Promise<string> {
    // No `status`: the column is generated from `reason_code`. The default reason carries no food handle.
    const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO unresolved_foods (name, source_phrase, normalized_key, reason_code)
              VALUES ($1, $2, $3, $4)
           RETURNING id`,
        [
            `${SCOPE} ${label}`,
            `${SCOPE} ${label} phrase`,
            overrides.normalizedKey ?? `${SCOPE}:${label}`,
            overrides.reasonCode ?? 'cascade_exhausted',
        ],
    );

    // Index-bound: `noUncheckedIndexedAccess` is OFF in this repository, so the compiler types this as
    // present when an empty `RETURNING` would make it `undefined`. The guard is the only thing between a
    // silently-skipped insert and a later case failing on an unrelated foreign key.
    const row = rows[0];

    if (row === undefined) {
        throw new Error(`unresolved_foods insert for "${label}" returned no row`);
    }

    return row.id;
}

/**
 * Insert a `food_lookups` row on the UNRESOLVED arm and return its id.
 *
 * @param label - Distinguishes this row from the others a case creates.
 * @returns The new lookup row's id.
 * @sideEffect Inserts two rows (the failure record and the lookup that points at it).
 */
async function makeUnresolvedLookup(label: string): Promise<string> {
    const unresolvedId = await makeUnresolved(label);
    const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO food_lookups (unresolved_food_id) VALUES ($1) RETURNING id`,
        [unresolvedId],
    );
    const row = rows[0];

    if (row === undefined) {
        throw new Error(`food_lookups insert for "${label}" returned no row`);
    }

    return row.id;
}

/**
 * Insert a `recipes` row and return its id.
 *
 * @param label - The recipe's title suffix, so a leaked row names the case that made it.
 * @returns The new recipe's id.
 * @sideEffect Inserts a row.
 */
async function makeRecipe(label: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO recipes (owner_id, title, prep_time_minutes, cook_time_minutes, total_time_minutes, servings)
              VALUES ($1, $2, 5, 10, 15, 2)
           RETURNING id`,
        [SCOPE_OWNER, `${SCOPE} ${label}`],
    );
    const row = rows[0];

    if (row === undefined) {
        throw new Error(`recipes insert for "${label}" returned no row`);
    }

    return row.id;
}

describe('the ingredient grain (0051)', () => {
    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 4 });
    });

    afterAll(async () => {
        if (pool === undefined) {
            return;
        }

        // Ordered by dependency: a recipe's delete cascades its lines, which frees the lookups, which
        // frees the failure records. Anything that outlived its owning recipe is caught by the scoped
        // predicates rather than left for the next run to trip over.
        await pool.query('DELETE FROM recipes WHERE owner_id = $1', [SCOPE_OWNER]);
        await pool.query(
            `DELETE FROM food_lookups
                   WHERE food_id LIKE $1
                      OR unresolved_food_id IN (SELECT id FROM unresolved_foods WHERE name LIKE $1)`,
            [`${SCOPE}%`],
        );
        await pool.query('DELETE FROM unresolved_foods WHERE name LIKE $1', [`${SCOPE}%`]);
        await pool.end();
    });

    describe('the old grain is GONE and the new one is present', () => {
        it('⛔ `recipe_ingredients` does not exist, and the three new tables do', async () => {
            // ONE query over a MIXED candidate set: the three tables that must exist are this assertion's
            // positive control. A predicate that matched nothing (wrong schema, wrong catalog view) would
            // report an empty set rather than passing on the absence it was asked about.
            const { rows } = await pool.query<{ table_name: string }>(
                `SELECT table_name FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = ANY($1)`,
                [['recipe_ingredients', 'ingredients', 'food_lookups', 'unresolved_foods']],
            );

            expect(rows.map((r) => r.table_name).sort()).toStrictEqual([
                'food_lookups',
                'ingredients',
                'unresolved_foods',
            ]);
        });

        it('⛔ the derived and discriminating columns are gone, and the columns that replace them are present', async () => {
            // Pairs, not a cross product: `name` must be ABSENT from `food_lookups` and PRESENT on
            // `unresolved_foods`, which a `table = ANY(...) AND column = ANY(...)` query cannot express.
            const banned: readonly (readonly [string, string])[] = [
                // Derived by following the FK — the whole point of the re-grain.
                ['ingredients', 'ingredient_name'],
                ['ingredients', 'is_user_entered'],
                // The lookup row's arm is DERIVED from its three columns, so nothing may restate it.
                ['food_lookups', 'kind'],
                ['food_lookups', 'food_resolution_status'],
                ['food_lookups', 'is_user_entered'],
                // The name and everything ranked off it moved to `unresolved_foods` or left entirely.
                ['food_lookups', 'name'],
                ['food_lookups', 'search_vector'],
                ['food_lookups', 'rank_folded'],
                ['food_lookups', 'rank_tokens'],
                ['food_lookups', 'rank_head'],
                // No table in the new grain carries a person.
                ['ingredients', 'user_id'],
                ['ingredients', 'owner_id'],
                ['food_lookups', 'user_id'],
                ['food_lookups', 'owner_id'],
                ['unresolved_foods', 'user_id'],
                ['unresolved_foods', 'owner_id'],
            ];
            const present: readonly (readonly [string, string])[] = [
                ['ingredients', 'food_lookup_id'],
                // ⛔ DISTINCT columns: the phrase lifted out of the line, and the whole raw line the
                // verification key hashes. Merging them would fail silently, because absence of a verdict
                // publishes.
                ['ingredients', 'source_phrase'],
                ['ingredients', 'source_line'],
                ['food_lookups', 'food_id'],
                ['food_lookups', 'food_variant_id'],
                ['food_lookups', 'unresolved_food_id'],
                ['food_lookups', 'food_owner_id'],
                ['unresolved_foods', 'name'],
                ['unresolved_foods', 'source_phrase'],
                ['unresolved_foods', 'normalized_key'],
                ['unresolved_foods', 'tiers_unavailable'],
            ];
            const candidates = [...banned, ...present];
            const { rows } = await pool.query<{ table_name: string; column_name: string }>(
                `SELECT c.table_name, c.column_name
                   FROM information_schema.columns c
                   JOIN unnest($1::text[], $2::text[]) AS want(t, col)
                     ON want.t = c.table_name AND want.col = c.column_name
                  WHERE c.table_schema = 'public'`,
                [candidates.map(([table]) => table), candidates.map(([, column]) => column)],
            );

            expect(rows.map((r) => `${r.table_name}.${r.column_name}`).sort()).toStrictEqual(
                present.map(([table, column]) => `${table}.${column}`).sort(),
            );
        });

        it('⛔ `rank_tokens_of` is dropped — the last ranking artefact tied to the removed name column', async () => {
            // `gen_random_uuid` is the positive control: it is a function this schema demonstrably has, so
            // a `pg_proc` query that found nothing would report its absence rather than bless the drop.
            const { rows } = await pool.query<{ proname: string }>(
                `SELECT proname FROM pg_proc WHERE proname = ANY($1)`,
                [['rank_tokens_of', 'gen_random_uuid']],
            );

            expect([...new Set(rows.map((r) => r.proname))].sort()).toStrictEqual(['gen_random_uuid']);
        });

        it('⛔ the ranking INDEXES tied to the removed name column are gone', async () => {
            // Same shape, one catalog over: a surviving index on a dropped column is impossible, but a
            // surviving index NAME on the recreated table would mean the drop-and-create left an artefact
            // of the old grain behind. `recipes_pkey` is the control.
            const { rows } = await pool.query<{ indexname: string }>(
                `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)`,
                [
                    [
                        'idx_ingredients_search_vector',
                        'idx_ingredients_name_trgm',
                        'idx_ingredients_freeform_name',
                        'idx_ingredients_food_id',
                        'idx_ingredients_food_owner',
                        'recipes_pkey',
                    ],
                ],
            );

            expect(rows.map((r) => r.indexname).sort()).toStrictEqual(['recipes_pkey']);
        });

        it('⛔ `ingredient_resolutions` now keys on the LOOKUP row, not the dead line grain', async () => {
            const { rows } = await pool.query<{ column_name: string }>(
                `SELECT column_name FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'ingredient_resolutions'
                    AND column_name = ANY($1)`,
                [['ingredient_id', 'food_lookup_id', 'tier']],
            );

            // `tier` is the control — a column this table demonstrably still has.
            expect(rows.map((r) => r.column_name).sort()).toStrictEqual(['food_lookup_id', 'tier']);
        });

        it('⛔ its foreign key is RE-ADDED, VALIDATED, and cascades — not silently dropped with the table', async () => {
            // ⛔ THE CASE THAT CATCHES A MIGRATION THAT CANNOT APPLY. Releasing the old FK was a
            // prerequisite of dropping `ingredients`, not a decision to stop constraining the column, so a
            // bare `RENAME COLUMN` would leave `food_lookup_id` referencing nothing.
            //
            // `convalidated` is the load-bearing half: the constraint is added VALID, which SCANS — and any
            // resolution event surviving the re-point holds a dead `ingredients.id`, fails the scan with
            // `23503`, and rolls the whole migration back. A migration that never applies is not a schema
            // this suite could otherwise observe at all.
            const { rows } = await pool.query<{ conname: string; convalidated: boolean; confdeltype: string }>(
                `SELECT conname, convalidated, confdeltype
                   FROM pg_constraint
                  WHERE contype = 'f' AND conrelid = 'ingredient_resolutions'::regclass`,
            );

            // `confdeltype` is `c` for CASCADE — 0035's semantics preserved exactly: the provenance of a
            // binding is meaningless once the binding is gone. `a` (NO ACTION) or `r` (RESTRICT) would each
            // be a different decision, so the letter is asserted rather than merely the constraint's
            // existence.
            expect(rows).toStrictEqual([
                {
                    conname: 'ingredient_resolutions_food_lookup_id_fkey',
                    convalidated: true,
                    confdeltype: 'c',
                },
            ]);
        });
    });

    describe('⛔ a failure record cannot contradict its own existence', () => {
        it('refuses zero attempts, and an attempt window that ends before it starts', async () => {
            // A row exists BECAUSE an attempt was made, so it cannot have had none — and it cannot have
            // last been attempted before it was first attempted.
            expect(
                await sqlStateOf(
                    `INSERT INTO unresolved_foods (name, normalized_key, reason_code, attempts)
                          VALUES ($1, $2, 'cascade_exhausted', 0)`,
                    [`${SCOPE} zero-attempts`, `${SCOPE}:zero-attempts`],
                ),
            ).toBe(CHECK_VIOLATION);

            expect(
                await sqlStateOf(
                    `INSERT INTO unresolved_foods (name, normalized_key, reason_code,
                                                   first_attempted_at, last_attempted_at)
                          VALUES ($1, $2, 'cascade_exhausted', now(), now() - interval '1 hour')`,
                    [`${SCOPE} backwards-window`, `${SCOPE}:backwards-window`],
                ),
            ).toBe(CHECK_VIOLATION);

            // The control: one attempt, and a window whose ends COINCIDE (a single attempt, which is the
            // default shape) are both admitted — so neither refusal above is a constraint that rejects
            // every row.
            const { rows } = await pool.query<{ id: string }>(
                `INSERT INTO unresolved_foods (name, normalized_key, reason_code, attempts,
                                               first_attempted_at, last_attempted_at)
                      VALUES ($1, $2, 'cascade_exhausted', 1, now(), now()) RETURNING id`,
                [`${SCOPE} one-attempt`, `${SCOPE}:one-attempt`],
            );

            expect(rows).toHaveLength(1);
        });
    });

    describe('⛔ a recipe line cannot exist without a binding', () => {
        it('refuses a line with no `food_lookup_id`, and admits the same line with one', async () => {
            const recipeId = await makeRecipe('binding');

            expect(await sqlStateOf(`INSERT INTO ingredients (recipe_id, unit) VALUES ($1, 'cup')`, [recipeId])).toBe(
                '23502',
            );

            const lookupId = await makeUnresolvedLookup('binding');
            const { rows } = await pool.query<{ id: string }>(
                `INSERT INTO ingredients (recipe_id, food_lookup_id, unit) VALUES ($1, $2, 'cup') RETURNING id`,
                [recipeId, lookupId],
            );

            expect(rows).toHaveLength(1);
        });
    });

    /**
     * The status each reason means, restated here on purpose rather than imported.
     *
     * ⛔ `status` is a column GENERATED from `reason_code`, so nothing can write the two out of step. This table
     * is the test's own statement of the mapping, so a change to the SQL `CASE` fails here even if the TypeScript
     * vocabulary moved with it. `RESOLVED` is in no row: a resolved lookup has no failure record at all.
     */
    const STATUS_OF_REASON: readonly (readonly [string, string])[] = [
        ['awaiting_source', 'PENDING'],
        ['several_candidates', 'UNRESOLVED'],
        ['author_declared', 'UNRESOLVED'],
        ['no_source_has_it', 'NOT_FOUND'],
        ['cascade_exhausted', 'NOT_FOUND'],
        ['phrase_unusable', 'NOT_FOUND'],
        ['sources_errored', 'FAILED'],
        ['cascade_unavailable', 'FAILED'],
    ];

    /** The reasons whose failure record carries the food service's handle for the pending food. */
    const REASONS_WITH_A_HANDLE: ReadonlySet<string> = new Set(['awaiting_source', 'several_candidates']);

    describe('⛔ `unresolved_foods.status` is derived from the reason, never written', () => {
        it('refuses a write to `status` — the column is generated', async () => {
            // SQLSTATE 428C9 `generated_always`: the server itself refuses the second statement of the fact.
            expect(
                await sqlStateOf(
                    `INSERT INTO unresolved_foods (name, normalized_key, status, reason_code)
                          VALUES ($1, $2, 'NOT_FOUND', 'cascade_exhausted')`,
                    [`${SCOPE} status-write`, `${SCOPE}:status-write`],
                ),
            ).toBe('428C9');
        });

        it('⛔ gives EVERY reason its status — the pin that ties the SQL to the vocabulary', async () => {
            // Driven off the exported vocabulary AND checked against the table above, so a reason added to one
            // and not the other fails: the vocabulary loop finds no table row, or the table names a reason the
            // server refuses.
            expect([...UNRESOLVED_FOOD_REASON_CODES].sort()).toStrictEqual(
                STATUS_OF_REASON.map(([reason]) => reason).sort(),
            );

            for (const [reasonCode, expected] of STATUS_OF_REASON) {
                const { rows } = await pool.query<{ status: string }>(
                    `INSERT INTO unresolved_foods (name, normalized_key, reason_code, food_handle_id,
                                                   tiers_consulted, tiers_unavailable)
                          VALUES ($1, $2, $3, $4, '{lexical}', '{lexical}') RETURNING status`,
                    [
                        `${SCOPE} reason ${reasonCode}`,
                        `${SCOPE}:reason:${reasonCode}`,
                        reasonCode,
                        REASONS_WITH_A_HANDLE.has(reasonCode) ? `${SCOPE}-handle-${reasonCode}` : null,
                    ],
                );

                expect(rows, `reason_code '${reasonCode}'`).toStrictEqual([{ status: expected }]);
            }
        });

        it('refuses a reason code outside the closed set — the generated status has no value for it', async () => {
            // SQLSTATE 23502: the CASE yields NULL for an unknown reason and the column is NOT NULL. The loop above
            // is the positive control: every known reason is admitted.
            expect(
                await sqlStateOf(
                    `INSERT INTO unresolved_foods (name, normalized_key, reason_code)
                          VALUES ($1, $2, 'invented_reason')`,
                    [`${SCOPE} bad-reason`, `${SCOPE}:bad-reason`],
                ),
            ).toBe('23502');
        });
    });

    describe('⛔ the food handle exists exactly when the reason says a food is pending', () => {
        it('refuses a pending reason with no handle, and a settled reason with one', async () => {
            expect(
                await sqlStateOf(
                    `INSERT INTO unresolved_foods (name, normalized_key, reason_code) VALUES ($1, $2, 'awaiting_source')`,
                    [`${SCOPE} pending-no-handle`, `${SCOPE}:pending-no-handle`],
                ),
            ).toBe(CHECK_VIOLATION);
            expect(
                await sqlStateOf(
                    `INSERT INTO unresolved_foods (name, normalized_key, reason_code, food_handle_id)
                          VALUES ($1, $2, 'no_source_has_it', $3)`,
                    [`${SCOPE} settled-handle`, `${SCOPE}:settled-handle`, `${SCOPE}-stray-handle`],
                ),
            ).toBe(CHECK_VIOLATION);

            // The control: each shape the rule allows is admitted.
            const pending = await pool.query(
                `INSERT INTO unresolved_foods (name, normalized_key, reason_code, food_handle_id)
                      VALUES ($1, $2, 'several_candidates', $3)`,
                [`${SCOPE} pending-handle`, `${SCOPE}:pending-handle`, `${SCOPE}-handle`],
            );
            const settled = await pool.query(
                `INSERT INTO unresolved_foods (name, normalized_key, reason_code) VALUES ($1, $2, 'no_source_has_it')`,
                [`${SCOPE} settled-no-handle`, `${SCOPE}:settled-no-handle`],
            );

            expect([pending.rowCount, settled.rowCount]).toStrictEqual([1, 1]);
        });
    });

    describe('⛔ the tiers a record names are real cascade tiers', () => {
        it('refuses an unknown tier, and an unavailable tier that was never consulted', async () => {
            // `llm` is a real tier id elsewhere, but never a link of this cascade.
            expect(
                await sqlStateOf(
                    `INSERT INTO unresolved_foods (name, normalized_key, reason_code, tiers_consulted)
                          VALUES ($1, $2, 'cascade_exhausted', '{curated,llm}')`,
                    [`${SCOPE} tier-unknown`, `${SCOPE}:tier-unknown`],
                ),
            ).toBe(CHECK_VIOLATION);
            expect(
                await sqlStateOf(
                    `INSERT INTO unresolved_foods (name, normalized_key, reason_code, tiers_consulted, tiers_unavailable)
                          VALUES ($1, $2, 'cascade_unavailable', '{curated}', '{memo}')`,
                    [`${SCOPE} tier-not-consulted`, `${SCOPE}:tier-not-consulted`],
                ),
            ).toBe(CHECK_VIOLATION);

            // The control: every cascade tier consulted, one of them down.
            const { rowCount } = await pool.query(
                `INSERT INTO unresolved_foods (name, normalized_key, reason_code, tiers_consulted, tiers_unavailable)
                      VALUES ($1, $2, 'cascade_unavailable', '{curated,lexical,memo}', '{memo}')`,
                [`${SCOPE} tier-ok`, `${SCOPE}:tier-ok`],
            );

            expect(rowCount).toBe(1);
        });
    });

    describe('⛔ `cascade_unavailable` must name the tier that was unavailable', () => {
        it('refuses an EMPTY `tiers_unavailable`', async () => {
            // ⛔ The reason `cardinality` and not `array_length(tiers_unavailable, 1)`: the latter answers
            // NULL for `'{}'`, a CHECK is satisfied when it evaluates to NULL, and the constraint would
            // therefore admit the exact row it exists to refuse. This case is what distinguishes them.
            expect(
                await sqlStateOf(
                    `INSERT INTO unresolved_foods (name, normalized_key, reason_code, tiers_consulted, tiers_unavailable)
                          VALUES ($1, $2, 'cascade_unavailable', '{lexical}', '{}')`,
                    [`${SCOPE} unavailable-empty`, `${SCOPE}:unavailable-empty`],
                ),
            ).toBe(CHECK_VIOLATION);
        });

        it('⛔ refuses a NULL `tiers_unavailable` — the NOT NULL is what makes `cardinality` safe', async () => {
            // `cardinality(NULL::text[])` is NULL, not 0. A CHECK that evaluates to NULL is SATISFIED, so
            // against a NULLABLE column this constraint would admit a `cascade_unavailable` naming no tier.
            // The column's NOT NULL is therefore load-bearing ON THE CHECK, and this case detects it being
            // relaxed.
            expect(
                await sqlStateOf(
                    `INSERT INTO unresolved_foods (name, normalized_key, reason_code, tiers_consulted, tiers_unavailable)
                          VALUES ($1, $2, 'cascade_unavailable', '{lexical}', NULL)`,
                    [`${SCOPE} unavailable-null`, `${SCOPE}:unavailable-null`],
                ),
            ).toBe('23502');
        });

        it('admits `cascade_unavailable` WITH a tier, and any other reason WITHOUT one', async () => {
            const withTier = await pool.query<{ id: string }>(
                `INSERT INTO unresolved_foods (name, normalized_key, reason_code, tiers_consulted, tiers_unavailable)
                      VALUES ($1, $2, 'cascade_unavailable', '{lexical}', '{lexical}') RETURNING id`,
                [`${SCOPE} unavailable-tier`, `${SCOPE}:unavailable-tier`],
            );

            expect(withTier.rows).toHaveLength(1);

            // The second half proves the constraint is SCOPED to `cascade_unavailable` rather than a blanket
            // "always name a tier".
            const otherReason = await pool.query<{ id: string }>(
                `INSERT INTO unresolved_foods (name, normalized_key, reason_code)
                      VALUES ($1, $2, 'no_source_has_it') RETURNING id`,
                [`${SCOPE} other-reason`, `${SCOPE}:other-reason`],
            );

            expect(otherReason.rows).toHaveLength(1);
        });
    });

    describe('⛔ `detail` is operator text with a bound', () => {
        it('refuses 501 characters and admits 500', async () => {
            expect(
                await sqlStateOf(
                    `INSERT INTO unresolved_foods (name, normalized_key, reason_code, detail)
                          VALUES ($1, $2, 'sources_errored', $3)`,
                    [`${SCOPE} detail-long`, `${SCOPE}:detail-long`, 'x'.repeat(501)],
                ),
            ).toBe(CHECK_VIOLATION);

            const { rowCount } = await pool.query(
                `INSERT INTO unresolved_foods (name, normalized_key, reason_code, detail)
                      VALUES ($1, $2, 'sources_errored', $3)`,
                [`${SCOPE} detail-ok`, `${SCOPE}:detail-ok`, 'x'.repeat(500)],
            );

            expect(rowCount).toBe(1);
        });
    });

    describe('⛔ a lookup FAILURE is shared; an author DECLARATION never is', () => {
        it('DEDUPS a second failure on the same `normalized_key`', async () => {
            const key = `${SCOPE}:shared-failure`;

            await makeUnresolved('shared-failure-first', { normalizedKey: key, reasonCode: 'no_source_has_it' });

            // A real lookup failure is a shared fact about a phrase: lines converge on one row so that one
            // resolution frees them all.
            expect(
                await sqlStateOf(
                    `INSERT INTO unresolved_foods (name, normalized_key, reason_code) VALUES ($1, $2, 'sources_errored')`,
                    [`${SCOPE} shared-failure-second`, key],
                ),
            ).toBe('23505');
        });

        it('does NOT dedup two `author_declared` rows on the same key — the control, and the whole asymmetry', async () => {
            // Two cooks writing "grandma's spice mix" do not mean the same substance. Collapsing them would
            // merge one cook's ingredient into another's, so the partial index deliberately excludes the
            // declared arm — and this case is the only thing that detects a `WHERE` clause dropped from it.
            const key = `${SCOPE}:declared`;

            for (const label of ['declared-first', 'declared-second']) {
                const { rows } = await pool.query<{ id: string }>(
                    `INSERT INTO unresolved_foods (name, normalized_key, reason_code)
                          VALUES ($1, $2, 'author_declared') RETURNING id`,
                    [`${SCOPE} ${label}`, key],
                );

                expect(rows).toHaveLength(1);
            }
        });

        it('keeps declarations out of the retry index — a declaration is not a lookup that can later succeed', async () => {
            // Read back from the catalog rather than inferred: the retry sweep's index carries the same
            // predicate as the dedup index. The dedup index is the positive control for the query.
            const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
                `SELECT indexname, indexdef FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = ANY($1)
                  ORDER BY indexname`,
                [['unresolved_foods_shared_failure_key_idx', 'unresolved_foods_status_attempted_idx']],
            );

            expect(rows.map((row) => row.indexname)).toStrictEqual([
                'unresolved_foods_shared_failure_key_idx',
                'unresolved_foods_status_attempted_idx',
            ]);

            for (const row of rows) {
                expect(row.indexdef, row.indexname).toContain("(reason_code <> 'author_declared'::text)");
            }

            // The retry read also leaves out a failure food has answered (plan 002 R13); the dedup index does not,
            // so a new cook naming the phrase still converges on the settled record and is forwarded from it.
            const [dedup, retry] = rows;

            expect(retry?.indexdef).toContain('(settled_lookup_id IS NULL)');
            expect(dedup?.indexdef).not.toContain('settled_lookup_id');
        });

        it('⛔ never settles a declaration — a declared name is not a lookup food can answer', async () => {
            const { rows } = await pool.query<{ definition: string }>(
                `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
                  WHERE conname = 'unresolved_foods_declaration_never_settles'`,
            );

            expect(rows).toHaveLength(1);
            expect(rows[0]?.definition).toContain('settled_lookup_id IS NULL');
            expect(rows[0]?.definition).toContain("'author_declared'");
        });
    });

    /**
     * ⛔ `23001`, NOT `23503`, AND THE DIFFERENCE IS THE POINT.
     *
     * `ON DELETE RESTRICT` raises `restrict_violation` (23001); `NO ACTION` — the COLUMN DEFAULT, which the
     * old `recipe_ingredients.ingredient_id` took — raises `foreign_key_violation` (23503). Asserting
     * `23503` here would therefore pass only if the delete action had been weakened back to that default,
     * which is the one mutation this constant exists to detect. The difference is not academic: a
     * `NO ACTION` violation is checked at the END of the statement and can be repaired by a later statement
     * in the same transaction, so a delete-and-reinsert slips through it; a `RESTRICT` one fires
     * immediately and cannot.
     *
     * Measured against the harness's PostgreSQL 18, not read off a table of codes.
     */
    const RESTRICT_VIOLATION = '23001';

    describe('⛔ ON DELETE RESTRICT — a binding in use cannot be removed under its referrer', () => {
        it('refuses a `food_lookups` delete while a line references it, and admits an unreferenced one', async () => {
            const recipeId = await makeRecipe('restrict-lookup');
            const referenced = await makeUnresolvedLookup('restrict-referenced');

            await pool.query(`INSERT INTO ingredients (recipe_id, food_lookup_id, unit) VALUES ($1, $2, 'g')`, [
                recipeId,
                referenced,
            ]);

            expect(await sqlStateOf(`DELETE FROM food_lookups WHERE id = $1`, [referenced])).toBe(RESTRICT_VIOLATION);

            // The control: the same statement against a lookup nothing references must SUCCEED, or the
            // refusal above proves only that deletes fail.
            const unreferenced = await makeUnresolvedLookup('restrict-unreferenced');
            const deleted = await pool.query(`DELETE FROM food_lookups WHERE id = $1`, [unreferenced]);

            expect(deleted.rowCount).toBe(1);
        });

        it('refuses an `unresolved_foods` delete while a lookup references it, and admits an unreferenced one', async () => {
            const referenced = await makeUnresolved('restrict-food-referenced');

            await pool.query(`INSERT INTO food_lookups (unresolved_food_id) VALUES ($1)`, [referenced]);

            expect(await sqlStateOf(`DELETE FROM unresolved_foods WHERE id = $1`, [referenced])).toBe(
                RESTRICT_VIOLATION,
            );

            const unreferenced = await makeUnresolved('restrict-food-unreferenced');
            const deleted = await pool.query(`DELETE FROM unresolved_foods WHERE id = $1`, [unreferenced]);

            expect(deleted.rowCount).toBe(1);
        });
    });

    describe('⛔ deleting a recipe takes its lines with it', () => {
        it('cascades to the lines, leaves the OTHER recipe untouched, and leaves the lookup rows standing', async () => {
            const doomed = await makeRecipe('cascade-doomed');
            const survivor = await makeRecipe('cascade-survivor');
            const lookupId = await makeUnresolvedLookup('cascade');

            for (const recipeId of [doomed, survivor]) {
                await pool.query(`INSERT INTO ingredients (recipe_id, food_lookup_id, unit) VALUES ($1, $2, 'tsp')`, [
                    recipeId,
                    lookupId,
                ]);
            }

            await pool.query(`DELETE FROM recipes WHERE id = $1`, [doomed]);

            const { rows } = await pool.query<{ recipe_id: string }>(
                `SELECT recipe_id FROM ingredients WHERE recipe_id = ANY($1)`,
                [[doomed, survivor]],
            );

            // Both halves in one assertion: the doomed recipe's line is gone AND the survivor's is not,
            // which no "count is zero" check can distinguish from "the insert never happened".
            expect(rows.map((r) => r.recipe_id)).toStrictEqual([survivor]);

            // The cascade reaches the LINE, never the shared binding it pointed at — a lookup freed by one
            // recipe's deletion is still the binding every other line holds.
            const lookup = await pool.query(`SELECT id FROM food_lookups WHERE id = $1`, [lookupId]);

            expect(lookup.rowCount).toBe(1);
        });
    });
});
