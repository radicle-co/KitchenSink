/**
 * Migration 0088 — `recipe_statement_attestations`, its append-only guard, its shape CHECKs and the widened capture
 * vocabulary of `recipe_source_evidence`, asserted against a real Docker PostgreSQL as the SERVICE role (ADR-0039).
 *
 * ⛔ WHY THIS TIER IS MANDATORY: a unit test cannot observe a trigger that did not fire, a CHECK that did not apply or a
 * cascade the guard swallowed. What is asserted:
 *
 *  1. The table, its comment and its guard trigger exist, and 0086's capture CHECK still has the name 0088 dropped by.
 *  2. The service role can INSERT and SELECT one row per act, in every shape the service writes.
 *  3. The shape CHECKs refuse what the service never writes: an implicit row that is not a confirmation, a confirmation
 *     that is explicit, a cleared row with a wording, a wording with no locale, a malformed wording key, a locale outside
 *     its bounds, an unknown choice or action.
 *  4. UPDATE and DELETE are refused for the service role AND the database owner (append-only for every role).
 *  4a. The one UPDATE the guard admits: `account_id` from a real id to an `erased_` token (what account erasure writes), with
 *     every other column unchanged. Any other change, a second swap and a non-token value are refused.
 *  5. Hard-deleting the recipe removes its rows (the guard lets the cascade through); a soft delete keeps them.
 *  6. A clone has NO attestation rows: they are the acts of the cook who made them.
 *  7. The widened capture CHECK accepts `editorCitation` with a book citation, and refuses it without a citation or on a
 *     web source.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const OWNER_ID = '01JU7ATTEST000000000000OWNER';
const RECIPE_ID = '99999999-9999-4999-8999-000000000c01';
const CLONE_ID = '99999999-9999-4999-8999-000000000c02';
const CHECK_VIOLATION = '23514';

interface AttestationInput {
    readonly mode: string;
    readonly choice: string;
    readonly wordingVersion: string | null;
    readonly locale: string | null;
    readonly action: string;
}

const AUTHORED: AttestationInput = {
    mode: 'explicit',
    choice: 'authored',
    wordingVersion: 'statementAuthored.v1',
    locale: 'en',
    action: 'create',
};
const CONFIRM: AttestationInput = {
    mode: 'implicit',
    choice: 'publicConfirm',
    wordingVersion: 'publicConfirm.v1',
    locale: 'en',
    action: 'setVisibility',
};
const CLEARED: AttestationInput = {
    mode: 'explicit',
    choice: 'cleared',
    wordingVersion: null,
    locale: null,
    action: 'update',
};

describe('recipe_statement_attestations (migration 0088)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM recipes WHERE id = ANY($1::uuid[])`, [[CLONE_ID, RECIPE_ID]]);
    });

    afterAll(async () => {
        await pool.end();
    });

    async function insertRecipe(id: string = RECIPE_ID, clonedFromId: string | null = null): Promise<void> {
        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, status, cloned_from_id)
             VALUES ($1, $2, 'Attestation suite', '', 1, 1, 2, 4, 'private', 'draft', $3)`,
            [id, OWNER_ID, clonedFromId],
        );
    }

    async function attest(input: AttestationInput, recipeId: string = RECIPE_ID): Promise<void> {
        await pool.query(
            `INSERT INTO recipe_statement_attestations (recipe_id, account_id, mode, choice, wording_version, locale, action)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [recipeId, OWNER_ID, input.mode, input.choice, input.wordingVersion, input.locale, input.action],
        );
    }

    async function attestationCount(recipeId: string): Promise<number> {
        const { rows } = await pool.query<{ n: string }>(
            `SELECT count(*) AS n FROM recipe_statement_attestations WHERE recipe_id = $1`,
            [recipeId],
        );

        return Number(rows[0]?.n);
    }

    it('creates the table with a comment and the append-only guard', async () => {
        const { rows } = await pool.query<{ comment: string | null; triggers: string[] }>(
            `SELECT obj_description('recipe_statement_attestations'::regclass) AS comment,
                    ARRAY(SELECT tgname::text FROM pg_trigger
                           WHERE NOT tgisinternal AND tgrelid = 'recipe_statement_attestations'::regclass) AS triggers`,
        );

        expect(rows[0]?.comment).toBeTruthy();
        expect(rows[0]?.triggers).toEqual(['trg_recipe_statement_attestations_append_only']);
    });

    it('lets the service role append and read one row per act, in every shape the service writes', async () => {
        await insertRecipe();
        await attest(AUTHORED);
        await attest({ ...AUTHORED, choice: 'publicWeb', wordingVersion: 'statementPublicWeb.v1' });
        await attest({ ...AUTHORED, choice: 'book', wordingVersion: 'statementBook.v1', action: 'update' });
        await attest({ ...AUTHORED, choice: 'fromPerson', wordingVersion: 'statementFromPerson.v1' });
        await attest(CLEARED);
        await attest(CONFIRM);

        const { rows } = await pool.query<{ choice: string; mode: string }>(
            `SELECT choice, mode FROM recipe_statement_attestations WHERE recipe_id = $1 ORDER BY choice`,
            [RECIPE_ID],
        );

        expect(rows).toEqual([
            { choice: 'authored', mode: 'explicit' },
            { choice: 'book', mode: 'explicit' },
            { choice: 'cleared', mode: 'explicit' },
            { choice: 'fromPerson', mode: 'explicit' },
            { choice: 'publicConfirm', mode: 'implicit' },
            { choice: 'publicWeb', mode: 'explicit' },
        ]);
    });

    it('stamps the instant of the act and the acting account', async () => {
        await insertRecipe();
        await attest(AUTHORED);

        const { rows } = await pool.query<{ account_id: string; recorded: boolean }>(
            `SELECT account_id, recorded_at > now() - interval '1 minute' AS recorded
               FROM recipe_statement_attestations WHERE recipe_id = $1`,
            [RECIPE_ID],
        );

        expect(rows).toEqual([{ account_id: OWNER_ID, recorded: true }]);
    });

    it.each<[string, AttestationInput]>([
        ['an implicit row that is not a confirmation', { ...AUTHORED, mode: 'implicit' }],
        ['a confirmation recorded as explicit', { ...CONFIRM, mode: 'explicit' }],
        ['a cleared row that carries a wording', { ...CLEARED, wordingVersion: 'statementAuthored.v1', locale: 'en' }],
        ['a statement with no wording', { ...AUTHORED, wordingVersion: null, locale: null }],
        ['a wording with no locale', { ...AUTHORED, locale: null }],
        ['a locale with no wording', { ...CLEARED, locale: 'en' }],
        ['a malformed wording key', { ...AUTHORED, wordingVersion: 'Statement Authored' }],
        ['a wording key with no version', { ...AUTHORED, wordingVersion: 'statementAuthored' }],
        ['a one-character locale', { ...AUTHORED, locale: 'e' }],
        ['a 36-character locale', { ...AUTHORED, locale: 'x'.repeat(36) }],
        ['an unknown choice', { ...AUTHORED, choice: 'adapted' }],
        ['an unknown action', { ...AUTHORED, action: 'delete' }],
    ])('refuses %s', async (_name, input) => {
        await insertRecipe();

        await expect(attest(input)).rejects.toMatchObject({ code: CHECK_VIOLATION });
        expect(await attestationCount(RECIPE_ID)).toBe(0);
    });

    it('accepts a locale at each bound (2 and 35 characters)', async () => {
        await insertRecipe();
        await attest({ ...AUTHORED, locale: 'en' });
        await attest({ ...AUTHORED, locale: 'x'.repeat(35) });

        expect(await attestationCount(RECIPE_ID)).toBe(2);
    });

    it('refuses UPDATE of a row as the service role and as the owner, and leaves it unchanged', async () => {
        await insertRecipe();
        await attest(AUTHORED);

        await expect(
            pool.query(`UPDATE recipe_statement_attestations SET choice = 'book' WHERE recipe_id = $1`, [RECIPE_ID]),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        await expect(
            roleDb.asOwner((client) =>
                client.query(`UPDATE recipe_statement_attestations SET locale = 'fr' WHERE recipe_id = $1`, [
                    RECIPE_ID,
                ]),
            ),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });

        const { rows } = await pool.query<{ choice: string; locale: string }>(
            `SELECT choice, locale FROM recipe_statement_attestations WHERE recipe_id = $1`,
            [RECIPE_ID],
        );

        expect(rows).toEqual([{ choice: 'authored', locale: 'en' }]);
    });

    describe('account erasure pseudonymises the account on a row: the one UPDATE the guard admits', () => {
        const TOKEN = `erased_${'a1'.repeat(16)}`;
        const OTHER_TOKEN = `erased_${'b2'.repeat(16)}`;

        async function accountsOf(recipeId: string): Promise<string[]> {
            const { rows } = await pool.query<{ account_id: string }>(
                `SELECT account_id FROM recipe_statement_attestations WHERE recipe_id = $1 ORDER BY recorded_at, id`,
                [recipeId],
            );

            return rows.map((row) => row.account_id);
        }

        it('lets account_id become an erased token, as the service role and as the owner, and nothing else moves', async () => {
            await insertRecipe();
            await attest(AUTHORED);
            await attest(CONFIRM);

            await pool.query(`UPDATE recipe_statement_attestations SET account_id = $2 WHERE recipe_id = $1`, [
                RECIPE_ID,
                TOKEN,
            ]);

            expect(await accountsOf(RECIPE_ID)).toEqual([TOKEN, TOKEN]);

            const { rows } = await pool.query<{
                choice: string;
                wording_version: string | null;
                locale: string | null;
            }>(
                `SELECT choice, wording_version, locale FROM recipe_statement_attestations
                  WHERE recipe_id = $1 ORDER BY choice`,
                [RECIPE_ID],
            );

            expect(rows).toEqual([
                { choice: 'authored', wording_version: 'statementAuthored.v1', locale: 'en' },
                { choice: 'publicConfirm', wording_version: 'publicConfirm.v1', locale: 'en' },
            ]);

            await insertRecipe(CLONE_ID);
            await attest(AUTHORED, CLONE_ID);
            await roleDb.asOwner((client) =>
                client.query(`UPDATE recipe_statement_attestations SET account_id = $2 WHERE recipe_id = $1`, [
                    CLONE_ID,
                    TOKEN,
                ]),
            );

            expect(await accountsOf(CLONE_ID)).toEqual([TOKEN]);
        });

        it('refuses a token swap that also changes any other column, and leaves the row whole', async () => {
            await insertRecipe();
            await attest(AUTHORED);

            for (const other of [
                `choice = 'book'`,
                `mode = 'implicit'`,
                `wording_version = 'statementBook.v1'`,
                `locale = 'fr'`,
                `action = 'update'`,
                `recorded_at = now() + interval '1 day'`,
                `recipe_id = '${CLONE_ID}'`,
                `id = gen_random_uuid()`,
            ]) {
                await expect(
                    pool.query(
                        `UPDATE recipe_statement_attestations SET account_id = $2, ${other} WHERE recipe_id = $1`,
                        [RECIPE_ID, TOKEN],
                    ),
                ).rejects.toMatchObject({ code: CHECK_VIOLATION });
            }

            expect(await accountsOf(RECIPE_ID)).toEqual([OWNER_ID]);
        });

        it('refuses to swap a token that is already erased, and to set a value that is not a token', async () => {
            await insertRecipe();
            await attest(AUTHORED);
            await pool.query(`UPDATE recipe_statement_attestations SET account_id = $2 WHERE recipe_id = $1`, [
                RECIPE_ID,
                TOKEN,
            ]);

            await expect(
                pool.query(`UPDATE recipe_statement_attestations SET account_id = $2 WHERE recipe_id = $1`, [
                    RECIPE_ID,
                    OTHER_TOKEN,
                ]),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
            await expect(
                pool.query(`UPDATE recipe_statement_attestations SET account_id = $2 WHERE recipe_id = $1`, [
                    RECIPE_ID,
                    OWNER_ID,
                ]),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });

            expect(await accountsOf(RECIPE_ID)).toEqual([TOKEN]);
        });

        it('refuses to set a value that is not a token, however close', async () => {
            await insertRecipe();
            await attest(AUTHORED);

            for (const value of [
                'some-other-account',
                'erased_',
                'erased_abc',
                `erased_${'A1'.repeat(16)}`,
                `erased_${'a1'.repeat(17)}`,
                `xerased_${'a1'.repeat(16)}`,
            ]) {
                await expect(
                    pool.query(`UPDATE recipe_statement_attestations SET account_id = $2 WHERE recipe_id = $1`, [
                        RECIPE_ID,
                        value,
                    ]),
                ).rejects.toMatchObject({ code: CHECK_VIOLATION });
            }

            expect(await accountsOf(RECIPE_ID)).toEqual([OWNER_ID]);
        });

        it('refuses an INSERT whose account_id looks erased but is not a token, and admits a real token', async () => {
            await insertRecipe();

            await expect(
                pool.query(
                    `INSERT INTO recipe_statement_attestations (recipe_id, account_id, mode, choice, wording_version, locale, action)
                     VALUES ($1, 'erased_nothex', 'explicit', 'authored', 'statementAuthored.v1', 'en', 'create')`,
                    [RECIPE_ID],
                ),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });

            await pool.query(
                `INSERT INTO recipe_statement_attestations (recipe_id, account_id, mode, choice, wording_version, locale, action)
                 VALUES ($1, $2, 'explicit', 'authored', 'statementAuthored.v1', 'en', 'create')`,
                [RECIPE_ID, TOKEN],
            );

            expect(await accountsOf(RECIPE_ID)).toEqual([TOKEN]);
        });

        it('still refuses DELETE of a tokenised row, and still cascades with its recipe', async () => {
            await insertRecipe();
            await attest(AUTHORED);
            await pool.query(`UPDATE recipe_statement_attestations SET account_id = $2 WHERE recipe_id = $1`, [
                RECIPE_ID,
                TOKEN,
            ]);

            await expect(
                pool.query(`DELETE FROM recipe_statement_attestations WHERE recipe_id = $1`, [RECIPE_ID]),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
            expect(await attestationCount(RECIPE_ID)).toBe(1);

            await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE_ID]);

            expect(await attestationCount(RECIPE_ID)).toBe(0);
        });
    });

    it('refuses DELETE of a row as the service role and as the owner', async () => {
        await insertRecipe();
        await attest(AUTHORED);

        await expect(
            pool.query(`DELETE FROM recipe_statement_attestations WHERE recipe_id = $1`, [RECIPE_ID]),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        await expect(
            roleDb.asOwner((client) =>
                client.query(`DELETE FROM recipe_statement_attestations WHERE recipe_id = $1`, [RECIPE_ID]),
            ),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        expect(await attestationCount(RECIPE_ID)).toBe(1);
    });

    it('removes the rows when the recipe is hard-deleted: the guard lets the ON DELETE CASCADE through', async () => {
        await insertRecipe();
        await attest(AUTHORED);
        await attest(CONFIRM);

        await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE_ID]);

        expect(await attestationCount(RECIPE_ID)).toBe(0);
    });

    it('keeps the rows when the recipe is only soft-deleted', async () => {
        await insertRecipe();
        await attest(AUTHORED);

        await pool.query(`UPDATE recipes SET deleted_at = now() WHERE id = $1`, [RECIPE_ID]);

        expect(await attestationCount(RECIPE_ID)).toBe(1);
    });

    it('copies nothing onto a clone: an attestation is the act of the cook who made it', async () => {
        await insertRecipe();
        await attest(AUTHORED);
        await attest(CONFIRM);

        await insertRecipe(CLONE_ID, RECIPE_ID);

        expect(await attestationCount(CLONE_ID)).toBe(0);
        expect(await attestationCount(RECIPE_ID)).toBe(2);
    });

    describe('the widened capture vocabulary of recipe_source_evidence', () => {
        async function evidence(over: { capture: string; sourceKind: string | null; citation: string | null }) {
            await pool.query(
                `INSERT INTO recipe_source_evidence (recipe_id, capture, source_kind, citation)
                 VALUES ($1, $2, $3, $4)`,
                [RECIPE_ID, over.capture, over.sourceKind, over.citation],
            );
        }

        it('keeps the name the migration dropped the capture CHECK by (0086 names it by PostgreSQL default)', async () => {
            const { rows } = await pool.query<{ conname: string; def: string }>(
                `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
                  WHERE conrelid = 'recipe_source_evidence'::regclass AND conname = 'recipe_source_evidence_capture_check'`,
            );

            expect(rows).toHaveLength(1);
            expect(rows[0]?.def).toContain('editorCitation');
        });

        it('accepts editorCitation for a book with a citation', async () => {
            await insertRecipe();
            await evidence({ capture: 'editorCitation', sourceKind: 'book', citation: 'The Joy of Cooking, p. 12' });

            const { rows } = await pool.query(`SELECT 1 FROM recipe_source_evidence WHERE recipe_id = $1`, [RECIPE_ID]);

            expect(rows).toHaveLength(1);
        });

        it('refuses editorCitation with no citation, and on a web source', async () => {
            await insertRecipe();

            await expect(
                evidence({ capture: 'editorCitation', sourceKind: 'book', citation: null }),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
            await expect(
                evidence({ capture: 'editorCitation', sourceKind: 'public_web', citation: 'A citation' }),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        });

        it('still refuses a capture it does not know, and keeps the three it always had', async () => {
            await insertRecipe();

            await expect(evidence({ capture: 'telepathy', sourceKind: 'book', citation: 'x' })).rejects.toMatchObject({
                code: CHECK_VIOLATION,
            });
            await expect(
                evidence({ capture: 'importFile', sourceKind: 'book', citation: 'A cookbook' }),
            ).resolves.toBeUndefined();
        });
    });
});
