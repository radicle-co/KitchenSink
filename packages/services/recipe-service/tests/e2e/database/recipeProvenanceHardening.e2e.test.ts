/**
 * Migration 0090 — the records of what a cook stated and confirmed survive a recipe's hard delete, and the guards that keep
 * them no longer read a name a session can shadow. Asserted against a real PostgreSQL as the SERVICE role (ADR-0039).
 *
 * ⛔ WHY THIS TIER IS MANDATORY: a unit test cannot observe a trigger that read the wrong table, a foreign key whose action
 * was not changed, or a function that still resolves a name through the session's temporary schema. What is asserted:
 *
 *  1. SEARCH PATH. A session that creates a temporary table named like one the guards read (`recipes`,
 *     `recipe_source_evidence`, `account_erasure_jobs`) does not change what a guard or a rule function answers.
 *  2. RETENTION. A hard delete of a recipe keeps its attestation rows with `recipe_id` NULL and `recipe_ref` kept, and no
 *     role can DELETE a row. The one UPDATE that empties `recipe_id` is the foreign key's own, and only for a recipe that is gone.
 *  3. ERASURE SWAP. The account swap needs an erasure job in `queued` or `running` for that account.
 *  4. FROM ANOTHER PERSON. `recipe_is_from_person` also counts a past `fromPerson` attestation when the statement is NULL.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const CHECK_VIOLATION = '23514';
const TOKEN = `erased_${'c3'.repeat(16)}`;

/** The two kinds of act a row can record, in the shape the service writes them. */
const AUTHORED = { mode: 'explicit', choice: 'authored', wording: 'statementAuthored.v1', action: 'create' } as const;
const FROM_PERSON = {
    mode: 'explicit',
    choice: 'fromPerson',
    wording: 'statementFromPerson.v1',
    action: 'update',
} as const;
const CLEARED = { mode: 'explicit', choice: 'cleared', wording: null, action: 'update' } as const;

describe('recipe provenance hardening (migration 0090)', () => {
    // Attestation rows outlive their recipe, so each case has a recipe and an account of its own and never meets another's rows.
    let RECIPE_ID: string;
    let OWNER_ID: string;
    let pool: pg.Pool;

    beforeEach(() => {
        RECIPE_ID = randomUUID();
        OWNER_ID = `01JU7HARDEN${RECIPE_ID.slice(0, 8)}`;
    });

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM account_erasure_jobs WHERE owner_id = $1`, [OWNER_ID]);
        await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE_ID]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Swap the case's account for the erased token: the one UPDATE of `account_id` the guard ever lets through. */
    const swap = (): Promise<unknown> =>
        pool.query(`UPDATE recipe_statement_attestations SET account_id = $2 WHERE account_id = $1`, [OWNER_ID, TOKEN]);

    async function insertRecipe(statementKind: string | null = null): Promise<void> {
        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, status, statement_kind)
             VALUES ($1, $2, 'Hardening suite', '', 1, 1, 2, 4, 'private', 'draft', $3)`,
            [RECIPE_ID, OWNER_ID, statementKind],
        );
    }

    async function attest(
        act: { mode: string; choice: string; wording: string | null; action: string },
        account: string = OWNER_ID,
    ): Promise<void> {
        await pool.query(
            `INSERT INTO recipe_statement_attestations
                 (recipe_id, recipe_ref, account_id, mode, choice, wording_version, locale, action)
             VALUES ($1, $1, $2, $3, $4, $5, $6, $7)`,
            [RECIPE_ID, account, act.mode, act.choice, act.wording, act.wording === null ? null : 'en', act.action],
        );
    }

    async function rowsOf(): Promise<Array<{ recipe_id: string | null; recipe_ref: string; account_id: string }>> {
        const { rows } = await pool.query<{ recipe_id: string | null; recipe_ref: string; account_id: string }>(
            `SELECT recipe_id, recipe_ref, account_id FROM recipe_statement_attestations
              WHERE recipe_ref = $1 ORDER BY recorded_at, id`,
            [RECIPE_ID],
        );

        return rows;
    }

    describe('a temporary table of the same name changes no guard and no rule function', () => {
        /**
         * Run `body` as the database owner, on one connection that holds a temporary table, and drop the table whatever
         * happens. The owner and not the service role: this stack takes TEMPORARY from the service role, so the owner (and the
         * migrator) are the roles that can shadow a name, and the guards bind them too.
         */
        async function withTemp<T>(ddl: string, name: string, body: (client: pg.PoolClient) => Promise<T>): Promise<T> {
            return roleDb.asOwner(async (client) => {
                await client.query(ddl);

                try {
                    return await body(client);
                } finally {
                    await client.query(`DROP TABLE IF EXISTS pg_temp.${name}`);
                }
            });
        }

        it('still refuses to DELETE an evidence row while the recipe exists, with a temporary empty `recipes`', async () => {
            await insertRecipe();
            await pool.query(
                `INSERT INTO recipe_source_evidence (recipe_id, capture, source_kind, citation)
                              VALUES ($1, 'editorCitation', 'book', 'A cookbook')`,
                [RECIPE_ID],
            );

            await withTemp(`CREATE TEMP TABLE recipes (id uuid)`, 'recipes', async (client) => {
                await expect(
                    client.query(`DELETE FROM recipe_source_evidence WHERE recipe_id = $1`, [RECIPE_ID]),
                ).rejects.toMatchObject({ code: CHECK_VIOLATION });
            });

            const { rows } = await pool.query(`SELECT 1 FROM recipe_source_evidence WHERE recipe_id = $1`, [RECIPE_ID]);

            expect(rows).toHaveLength(1);
        });

        it('still refuses to empty `recipe_id` of a row whose recipe exists, with a temporary empty `recipes`', async () => {
            await insertRecipe();
            await attest(AUTHORED);

            await withTemp(`CREATE TEMP TABLE recipes (id uuid)`, 'recipes', async (client) => {
                await expect(
                    client.query(`UPDATE recipe_statement_attestations SET recipe_id = NULL WHERE recipe_ref = $1`, [
                        RECIPE_ID,
                    ]),
                ).rejects.toMatchObject({ code: CHECK_VIOLATION });
            });

            expect((await rowsOf())[0]?.recipe_id).toBe(RECIPE_ID);
        });

        it('still refuses the account swap with no erasure job, with a temporary `account_erasure_jobs` that has one', async () => {
            await insertRecipe();
            await attest(AUTHORED);

            await withTemp(
                `CREATE TEMP TABLE account_erasure_jobs (owner_id varchar(255), status text)`,
                'account_erasure_jobs',
                async (client) => {
                    await client.query(`INSERT INTO account_erasure_jobs VALUES ($1, 'running')`, [OWNER_ID]);
                    await expect(
                        client.query(`UPDATE recipe_statement_attestations SET account_id = $2 WHERE recipe_ref = $1`, [
                            RECIPE_ID,
                            TOKEN,
                        ]),
                    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
                },
            );

            expect((await rowsOf())[0]?.account_id).toBe(OWNER_ID);
        });

        it('answers the recipe rules from the real tables, not from a temporary `recipe_source_evidence` or `recipes`', async () => {
            await insertRecipe();

            await withTemp(
                `CREATE TEMP TABLE recipe_source_evidence (recipe_id uuid, source_domain text, source_kind text)`,
                'recipe_source_evidence',
                async (client) => {
                    await client.query(`INSERT INTO recipe_source_evidence VALUES ($1, 'example.com', 'public_web')`, [
                        RECIPE_ID,
                    ]);
                    const { rows } = await client.query<{ held: boolean }>(
                        `SELECT recipe_holds_third_party_source($1) AS held`,
                        [RECIPE_ID],
                    );

                    expect(rows[0]?.held).toBe(false);
                },
            );

            await withTemp(
                `CREATE TEMP TABLE recipes (id uuid, statement_kind text, source_type text, content_pasted_at timestamptz)`,
                'recipes',
                async (client) => {
                    await client.query(`INSERT INTO recipes VALUES ($1, 'fromPerson', 'user_created', now())`, [
                        RECIPE_ID,
                    ]);
                    const { rows } = await client.query<{ person: boolean; needs: boolean }>(
                        `SELECT recipe_is_from_person($1) AS person, recipe_needs_statement($1) AS needs`,
                        [RECIPE_ID],
                    );

                    expect(rows[0]).toEqual({ person: false, needs: false });
                },
            );
        });
    });

    describe('retention: the attestation rows outlive the recipe', () => {
        it('keeps every row of a hard-deleted recipe, with recipe_id NULL and recipe_ref kept', async () => {
            await insertRecipe();
            await attest(AUTHORED);
            await attest({
                mode: 'implicit',
                choice: 'publicConfirm',
                wording: 'publicConfirm.v1',
                action: 'setVisibility',
            });

            await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE_ID]);

            expect(await rowsOf()).toEqual([
                { recipe_id: null, recipe_ref: RECIPE_ID, account_id: OWNER_ID },
                { recipe_id: null, recipe_ref: RECIPE_ID, account_id: OWNER_ID },
            ]);
        });

        it('keeps the rows when the recipe is only soft-deleted', async () => {
            await insertRecipe();
            await attest(AUTHORED);
            await pool.query(`UPDATE recipes SET deleted_at = now() WHERE id = $1`, [RECIPE_ID]);

            expect(await rowsOf()).toEqual([{ recipe_id: RECIPE_ID, recipe_ref: RECIPE_ID, account_id: OWNER_ID }]);
        });

        it('refuses DELETE of a row for every role, whether or not the recipe still exists', async () => {
            await insertRecipe();
            await attest(AUTHORED);

            for (const run of [
                () => pool.query(`DELETE FROM recipe_statement_attestations WHERE recipe_ref = $1`, [RECIPE_ID]),
                () =>
                    roleDb.asOwner((client) =>
                        client.query(`DELETE FROM recipe_statement_attestations WHERE recipe_ref = $1`, [RECIPE_ID]),
                    ),
            ]) {
                await expect(run()).rejects.toMatchObject({ code: CHECK_VIOLATION });
            }

            await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE_ID]);

            await expect(
                pool.query(`DELETE FROM recipe_statement_attestations WHERE recipe_ref = $1`, [RECIPE_ID]),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
            expect(await rowsOf()).toHaveLength(1);
        });

        it('refuses any change to a row that has lost its recipe, apart from a token swap with a job', async () => {
            await insertRecipe();
            await attest(AUTHORED);
            await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE_ID]);

            for (const set of [
                `choice = 'book'`,
                `locale = 'fr'`,
                `recipe_ref = gen_random_uuid()`,
                `recipe_id = $2`,
            ]) {
                await expect(
                    pool.query(
                        `UPDATE recipe_statement_attestations SET ${set} WHERE recipe_ref = $1`,
                        set.includes('$2') ? [RECIPE_ID, RECIPE_ID] : [RECIPE_ID],
                    ),
                ).rejects.toMatchObject({});
            }

            expect(await rowsOf()).toEqual([{ recipe_id: null, recipe_ref: RECIPE_ID, account_id: OWNER_ID }]);
        });

        it('refuses a row whose recipe_ref differs from its recipe_id, and a row with no recipe_ref', async () => {
            await insertRecipe();

            await expect(
                pool.query(
                    `INSERT INTO recipe_statement_attestations
                         (recipe_id, recipe_ref, account_id, mode, choice, wording_version, locale, action)
                     VALUES ($1, gen_random_uuid(), $2, 'explicit', 'authored', 'statementAuthored.v1', 'en', 'create')`,
                    [RECIPE_ID, OWNER_ID],
                ),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
            await expect(
                pool.query(
                    `INSERT INTO recipe_statement_attestations
                         (recipe_id, account_id, mode, choice, wording_version, locale, action)
                     VALUES ($1, $2, 'explicit', 'authored', 'statementAuthored.v1', 'en', 'create')`,
                    [RECIPE_ID, OWNER_ID],
                ),
            ).rejects.toMatchObject({ code: '23502' });
        });

        it('lets erasure keep the rows of a recipe it deletes: the swap first, then the delete', async () => {
            await insertRecipe();
            await attest(AUTHORED);
            await pool.query(`INSERT INTO account_erasure_jobs (owner_id, status) VALUES ($1, 'running')`, [OWNER_ID]);

            await pool.query(`UPDATE recipe_statement_attestations SET account_id = $2 WHERE account_id = $1`, [
                OWNER_ID,
                TOKEN,
            ]);
            await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE_ID]);

            expect(await rowsOf()).toEqual([{ recipe_id: null, recipe_ref: RECIPE_ID, account_id: TOKEN }]);
        });
    });

    describe('the account swap needs an erasure job in flight for that account', () => {
        it.each(['queued', 'running'])('allows the swap while the job is %s', async (status) => {
            await insertRecipe();
            await attest(AUTHORED);
            await pool.query(`INSERT INTO account_erasure_jobs (owner_id, status) VALUES ($1, $2)`, [OWNER_ID, status]);

            await swap();

            expect((await rowsOf())[0]?.account_id).toBe(TOKEN);
        });

        it.each([
            ['there is no job', null],
            ['the job is completed', 'completed'],
            ['the job failed', 'failed'],
        ])('refuses the swap when %s', async (_name, status) => {
            await insertRecipe();
            await attest(AUTHORED);

            if (status !== null) {
                await pool.query(`INSERT INTO account_erasure_jobs (owner_id, status) VALUES ($1, $2)`, [
                    OWNER_ID,
                    status,
                ]);
            }

            await expect(swap()).rejects.toMatchObject({ code: CHECK_VIOLATION });
            expect((await rowsOf())[0]?.account_id).toBe(OWNER_ID);
        });

        it('refuses the swap when only another account has a job in flight', async () => {
            await insertRecipe();
            await attest(AUTHORED);
            await pool.query(`INSERT INTO account_erasure_jobs (owner_id, status) VALUES ('someone-else', 'running')`);

            try {
                await expect(swap()).rejects.toMatchObject({ code: CHECK_VIOLATION });
            } finally {
                await pool.query(`DELETE FROM account_erasure_jobs WHERE owner_id = 'someone-else'`);
            }
        });
    });

    describe('a registered test principal\u2019s reset swaps the account, and nothing ever deletes (ADR-0095 section 6)', () => {
        afterEach(async () => {
            await pool.query(`DELETE FROM test_reset_jobs WHERE user_id = ANY($1::text[])`, [
                [OWNER_ID, 'someone-else'],
            ]);
            await pool.query(`DELETE FROM test_principals WHERE user_id = ANY($1::text[])`, [
                [OWNER_ID, 'someone-else'],
            ]);
        });

        const register = (id: string = OWNER_ID): Promise<unknown> =>
            pool.query(`INSERT INTO test_principals (user_id) VALUES ($1)`, [id]);
        const resetJob = (status: string, id: string = OWNER_ID): Promise<unknown> =>
            pool.query(`INSERT INTO test_reset_jobs (user_id, status) VALUES ($1, $2)`, [id, status]);

        it('lets the swap through for a registered test principal while its reset is running, and keeps the row', async () => {
            await insertRecipe();
            await attest(AUTHORED);
            await register();
            await resetJob('running');

            await swap();
            await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE_ID]);

            expect(await rowsOf()).toEqual([{ recipe_id: null, recipe_ref: RECIPE_ID, account_id: TOKEN }]);
        });

        it.each([
            ['the reset is only queued', async () => (await register(), await resetJob('queued'))],
            ['the reset is completed', async () => (await register(), await resetJob('completed'))],
            ['the principal has no reset', async () => register()],
            ['the account is not registered, though a reset runs', async () => resetJob('running')],
            [
                'only another principal is registered and resetting',
                async () => (await register('someone-else'), await resetJob('running', 'someone-else')),
            ],
        ])('refuses the swap when %s', async (_name, arrange) => {
            await insertRecipe();
            await attest(AUTHORED);
            await arrange();

            await expect(swap()).rejects.toMatchObject({ code: CHECK_VIOLATION });
            expect((await rowsOf())[0]?.account_id).toBe(OWNER_ID);
        });

        it('refuses DELETE for the service role and the owner, even for a registered principal with a running reset and a running erasure', async () => {
            await insertRecipe();
            await attest(AUTHORED);
            await register();
            await resetJob('running');
            await pool.query(`INSERT INTO account_erasure_jobs (owner_id, status) VALUES ($1, 'running')`, [OWNER_ID]);

            for (const run of [
                () => pool.query(`DELETE FROM recipe_statement_attestations WHERE account_id = $1`, [OWNER_ID]),
                () =>
                    roleDb.asOwner((client) =>
                        client.query(`DELETE FROM recipe_statement_attestations WHERE account_id = $1`, [OWNER_ID]),
                    ),
            ]) {
                await expect(run()).rejects.toMatchObject({ code: CHECK_VIOLATION });
            }

            expect(await rowsOf()).toHaveLength(1);
        });
    });

    describe('recipe_is_from_person counts a past fromPerson attestation when the statement is NULL', () => {
        const personOf = async (): Promise<boolean | undefined> =>
            (await pool.query<{ person: boolean }>(`SELECT recipe_is_from_person($1) AS person`, [RECIPE_ID])).rows[0]
                ?.person;

        it('holds a recipe with no statement and a fromPerson attestation, even when a clear came after it', async () => {
            await insertRecipe(null);
            await attest(FROM_PERSON);
            await attest(CLEARED);

            expect(await personOf()).toBe(true);
        });

        it('does not hold a recipe with no statement and no fromPerson attestation', async () => {
            await insertRecipe(null);
            await attest(CLEARED);

            expect(await personOf()).toBe(false);
        });

        it('does not hold a recipe whose cook has since said "I wrote this"', async () => {
            await insertRecipe('authored');
            await attest(FROM_PERSON);

            expect(await personOf()).toBe(false);
        });

        it('still holds a recipe whose stored statement is fromPerson', async () => {
            await insertRecipe('fromPerson');

            expect(await personOf()).toBe(true);
        });
    });

    describe('a clone keeps the "from another person" fact of its source (ADR-0095 section 4)', () => {
        let CLONE_ID: string;

        beforeEach(() => {
            CLONE_ID = randomUUID();
        });

        afterEach(async () => {
            await pool.query(`DELETE FROM recipes WHERE id = $1`, [CLONE_ID]);
        });

        async function cloneRecipe(statementKind: string | null = null): Promise<void> {
            await pool.query(
                `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                      total_time_minutes, servings, visibility, status, cloned_from_id, statement_kind)
                 VALUES ($1, $2, 'Hardening clone', '', 1, 1, 2, 4, 'private', 'draft', $3, $4)`,
                [CLONE_ID, OWNER_ID, RECIPE_ID, statementKind],
            );
        }

        const cloneRows = async () =>
            (
                await pool.query<{ recipe_id: string; recipe_ref: string; account_id: string; choice: string }>(
                    `SELECT recipe_id, recipe_ref, account_id, choice FROM recipe_statement_attestations
                      WHERE recipe_ref = $1 ORDER BY recorded_at, id`,
                    [CLONE_ID],
                )
            ).rows;
        const heldOf = async (id: string): Promise<boolean | undefined> =>
            (await pool.query<{ held: boolean }>(`SELECT recipe_is_from_person($1) AS held`, [id])).rows[0]?.held;

        it('copies the fact to the clone of a recipe with no statement and a past fromPerson, keeping account and choice', async () => {
            await insertRecipe(null);
            await attest(FROM_PERSON);
            await attest(CLEARED);

            await cloneRecipe(null);

            expect(await cloneRows()).toEqual([
                { recipe_id: CLONE_ID, recipe_ref: CLONE_ID, account_id: OWNER_ID, choice: 'fromPerson' },
            ]);
            expect(await heldOf(CLONE_ID)).toBe(true);
        });

        it('keeps the copy held after the source recipe is hard-deleted', async () => {
            await insertRecipe(null);
            await attest(FROM_PERSON);
            await cloneRecipe(null);
            await pool.query(`UPDATE recipes SET cloned_from_id = NULL WHERE id = $1`, [CLONE_ID]);
            await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE_ID]);

            expect(await heldOf(CLONE_ID)).toBe(true);
        });

        it('copies nothing when the cook replaced "from another person" with "I wrote this"', async () => {
            await insertRecipe('authored');
            await attest(FROM_PERSON);
            await attest(AUTHORED);

            await cloneRecipe('authored');

            expect(await cloneRows()).toEqual([]);
            expect(await heldOf(CLONE_ID)).toBe(false);
        });

        it('copies nothing when the source has no fromPerson attestation', async () => {
            await insertRecipe(null);
            await attest(CLEARED);

            await cloneRecipe(null);

            expect(await cloneRows()).toEqual([]);
        });

        it('copies the fact when the source statement is fromPerson and the clone starts with none', async () => {
            await insertRecipe('fromPerson');
            await attest(FROM_PERSON);

            await cloneRecipe(null);

            expect(await heldOf(CLONE_ID)).toBe(true);
        });
        it('copies nothing when the clone already states "from another person" itself', async () => {
            await insertRecipe('fromPerson');
            await attest(FROM_PERSON);

            await cloneRecipe('fromPerson');

            expect(await cloneRows()).toEqual([]);
        });
    });
});
