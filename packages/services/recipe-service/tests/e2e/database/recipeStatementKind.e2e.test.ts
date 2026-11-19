/**
 * Migration 0087 — `recipes.statement_kind`, `recipes.content_pasted_at`, their three CHECKs and the SQL function
 * `recipe_needs_statement`, asserted against a real Docker PostgreSQL as the SERVICE role (ADR-0039).
 *
 * ⛔ WHY THIS TIER IS MANDATORY: a unit test cannot observe a CHECK that did not apply, or a SQL function that disagrees
 * with the TypeScript rule it twins. What is asserted:
 *
 *  1. Both columns exist, are nullable, and carry no default (NULL is "no statement" and "no paste seen").
 *  2. `recipes_statement_kind_check`: a value outside `authored | source | fromPerson` is refused.
 *  3. `recipes_statement_authored_is_own`: `authored` is refused on any recipe that has a source label or a kind.
 *  4. `recipes_statement_kind_pairs_source_kind`: a stated source kind needs `statement_kind = 'source'`, and `source` needs
 *     a kind, so a row cannot say "a web copy" and "no statement" at once; the curator's text (no kind) takes NULL only.
 *  4b. `recipes_statement_from_person_is_own`: `fromPerson` belongs only to a cook-written recipe with no source kind.
 *  5. `recipe_needs_statement` answers exactly what `statementRequiredOf` answers over the cross product of label,
 *     statement, paste and evidence, and both answers occur.
 *  6. `recipe_is_from_person` answers exactly what `fromPersonOf` answers over the same cross product, and both occur.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
    RECIPE_STATEMENT_KINDS,
    RecipeSourceType,
    fromPersonOf,
    statementRequiredOf,
    type RecipeSourceKind,
    type RecipeStatementKind,
} from '@kitchensink/recipe-core';

import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const OWNER_ID = '01JU7STMTKIND0000000000OWNER';
const RECIPE_ID = '88888888-8888-4888-8888-000000000b01';
const PARITY_PREFIX = '88888888-8888-4888-8888-0000002';
const CHECK_VIOLATION = '23514';

/** The `source_kind` each label may carry: the 0071 pairing, restated here so a drift in either is a failing row. */
const KIND_FOR_LABEL: Readonly<Record<RecipeSourceType, RecipeSourceKind | null>> = {
    user_created: null,
    imported_public: 'public_web',
    imported_physical: 'book',
    imported_paid: 'paid_site',
};

interface Row {
    readonly id?: string;
    readonly sourceType?: string;
    readonly sourceKind?: string | null;
    readonly sourceUrl?: string | null;
    readonly statementKind?: string | null;
    readonly contentPastedAt?: string | null;
}

describe('recipes.statement_kind and content_pasted_at (migration 0087)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM recipes WHERE id = $1 OR id::text LIKE $2`, [RECIPE_ID, `${PARITY_PREFIX}%`]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Insert a recipe, and the evidence its stated kind needs, in ONE transaction (the 0086 backstop checks at COMMIT). */
    async function insert(over: Row = {}, evidenceRows = 0): Promise<void> {
        const client = await pool.connect();
        const id = over.id ?? RECIPE_ID;

        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                      total_time_minutes, servings, visibility, status, source_type, source_url, source_kind,
                                      statement_kind, content_pasted_at)
                 VALUES ($1, $2, 'Statement suite', '', 1, 1, 2, 4, 'private', 'draft', $3, $4, $5, $6, $7)`,
                [
                    id,
                    OWNER_ID,
                    over.sourceType ?? 'user_created',
                    over.sourceUrl ?? null,
                    over.sourceKind ?? null,
                    over.statementKind ?? null,
                    over.contentPastedAt ?? null,
                ],
            );

            if (over.sourceKind !== undefined && over.sourceKind !== null) {
                await client.query(
                    `INSERT INTO recipe_source_evidence (recipe_id, capture, source_url, source_key, source_domain, source_kind, citation)
                     VALUES ($1, $6, $2, $2, $3, $4, $5)`,
                    [
                        id,
                        over.sourceUrl ?? null,
                        over.sourceKind === 'public_web' ? 'example.com' : null,
                        over.sourceKind,
                        over.sourceKind === 'public_web' ? null : 'A cited source',
                        over.sourceKind === 'public_web' ? 'editorLink' : 'importFile',
                    ],
                );
            }

            for (let n = 0; n < evidenceRows; n += 1) {
                await client.query(
                    `INSERT INTO recipe_source_evidence (recipe_id, capture, paste_digest)
                     VALUES ($1, 'pastedPage', $2)`,
                    [id, 'a'.repeat(64)],
                );
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    it('adds both columns, nullable and with no default', async () => {
        const { rows } = await pool.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
            `SELECT column_name, is_nullable, column_default FROM information_schema.columns
              WHERE table_name = 'recipes' AND column_name IN ('statement_kind', 'content_pasted_at')
              ORDER BY column_name`,
        );

        expect(rows).toEqual([
            { column_name: 'content_pasted_at', is_nullable: 'YES', column_default: null },
            { column_name: 'statement_kind', is_nullable: 'YES', column_default: null },
        ]);
    });

    it('stores NULL for both on a recipe that says nothing', async () => {
        await insert();

        const { rows } = await pool.query(`SELECT statement_kind, content_pasted_at FROM recipes WHERE id = $1`, [
            RECIPE_ID,
        ]);

        expect(rows[0]).toEqual({ statement_kind: null, content_pasted_at: null });
    });

    it('refuses a statement kind outside the vocabulary', async () => {
        await expect(insert({ statementKind: 'family' })).rejects.toMatchObject({
            code: CHECK_VIOLATION,
            constraint: 'recipes_statement_kind_check',
        });
    });

    it('accepts authored on a cook-written recipe with no kind, and records it', async () => {
        await insert({ statementKind: 'authored' });

        const { rows } = await pool.query(`SELECT statement_kind FROM recipes WHERE id = $1`, [RECIPE_ID]);

        expect(rows[0]).toEqual({ statement_kind: 'authored' });
    });

    it('accepts fromPerson on a cook-written recipe with no kind, and records it', async () => {
        await insert({ statementKind: 'fromPerson' });

        const { rows } = await pool.query(`SELECT statement_kind FROM recipes WHERE id = $1`, [RECIPE_ID]);

        expect(rows[0]).toEqual({ statement_kind: 'fromPerson' });
    });

    // The label is `imported_*` with NO source kind (the curator's text shape), so the pairing CHECK passes and only
    // `recipes_statement_from_person_is_own` can refuse it.
    it.each([
        ['an imported_public label', { sourceType: 'imported_public' }],
        ['an imported_physical label', { sourceType: 'imported_physical' }],
        ['an imported_paid label', { sourceType: 'imported_paid' }],
    ])('refuses fromPerson on %s', async (_label, over) => {
        await expect(insert({ ...over, statementKind: 'fromPerson' })).rejects.toMatchObject({
            code: CHECK_VIOLATION,
            constraint: 'recipes_statement_from_person_is_own',
        });
    });

    it('refuses fromPerson on a recipe that states a source kind', async () => {
        await expect(
            insert({
                sourceType: 'imported_public',
                sourceKind: 'public_web',
                sourceUrl: 'https://example.com/r',
                statementKind: 'fromPerson',
            }),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it.each([
        ['an imported_public label', { sourceType: 'imported_public' }],
        ['an imported_physical label', { sourceType: 'imported_physical' }],
        ['an imported_paid label', { sourceType: 'imported_paid' }],
    ])('refuses authored on %s', async (_label, over) => {
        await expect(insert({ ...over, statementKind: 'authored' })).rejects.toMatchObject({
            code: CHECK_VIOLATION,
            constraint: 'recipes_statement_authored_is_own',
        });
    });

    it('refuses authored on a recipe that states a source kind', async () => {
        await expect(
            insert({
                sourceType: 'imported_public',
                sourceKind: 'public_web',
                sourceUrl: 'https://example.com/r',
                statementKind: 'authored',
            }),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it.each([
        ['public_web', 'imported_public', 'https://example.com/r'],
        ['book', 'imported_physical', null],
        ['paid_site', 'imported_paid', null],
    ] as const)('refuses a %s source with no statement, and accepts it with source', async (kind, sourceType, url) => {
        await expect(insert({ sourceType, sourceKind: kind, sourceUrl: url })).rejects.toMatchObject({
            code: CHECK_VIOLATION,
            constraint: 'recipes_statement_kind_pairs_source_kind',
        });

        await insert({ sourceType, sourceKind: kind, sourceUrl: url, statementKind: 'source' });
    });

    it('refuses source with no source kind, and the curator’s text (no kind) takes no statement', async () => {
        await expect(insert({ statementKind: 'source' })).rejects.toMatchObject({
            code: CHECK_VIOLATION,
            constraint: 'recipes_statement_kind_pairs_source_kind',
        });
        await expect(insert({ sourceType: 'imported_public', statementKind: 'source' })).rejects.toMatchObject({
            code: CHECK_VIOLATION,
        });

        await insert({ sourceType: 'imported_public' });
    });

    describe('recipe_needs_statement parity with statementRequiredOf', () => {
        const STATEMENTS: ReadonlyArray<RecipeStatementKind | null> = [null, ...RECIPE_STATEMENT_KINDS];

        it('agrees over label × statement × paste × evidence, and both answers occur', async () => {
            const seen = new Set<boolean>();
            const seenPerson = new Set<boolean>();
            let index = 0;

            for (const sourceType of Object.values(RecipeSourceType)) {
                const sourceKind = KIND_FOR_LABEL[sourceType];

                for (const statementKind of STATEMENTS) {
                    // Only the rows the CHECKs admit exist: a stated kind is `source`, no kind is never `source`.
                    const admitted =
                        statementKind === 'authored'
                            ? sourceType === 'user_created'
                            : (sourceKind !== null) === (statementKind === 'source');

                    if (!admitted && !(sourceType === 'imported_public' && statementKind === null)) {
                        continue;
                    }

                    // The curator's text is `imported_public` with NO kind: the one label that also exists unpaired.
                    const kinds: ReadonlyArray<RecipeSourceKind | null> =
                        sourceType === 'imported_public' && statementKind === null ? [null] : [sourceKind];

                    for (const kind of kinds) {
                        for (const pasted of [false, true]) {
                            for (const evidenceRows of [0, 1]) {
                                for (const attested of [false, true]) {
                                    index += 1;
                                    const id = `${PARITY_PREFIX}${String(index).padStart(5, '0')}`;

                                    await insert(
                                        {
                                            id,
                                            sourceType,
                                            sourceKind: kind,
                                            sourceUrl: kind === 'public_web' ? 'https://example.com/r' : null,
                                            statementKind,
                                            contentPastedAt: pasted ? '2026-11-15T00:00:00Z' : null,
                                        },
                                        evidenceRows,
                                    );

                                    if (attested) {
                                        await pool.query(
                                            `INSERT INTO recipe_statement_attestations
                                             (recipe_id, recipe_ref, account_id, mode, choice, wording_version, locale, action)
                                         VALUES ($1, $1, $2, 'explicit', 'fromPerson', 'statementFromPerson.v1', 'en', 'update')`,
                                            [id, OWNER_ID],
                                        );
                                    }

                                    const { rows } = await pool.query<{ needs: boolean; evidence: string }>(
                                        `SELECT recipe_needs_statement($1) AS needs,
                                            (SELECT count(*) FROM recipe_source_evidence WHERE recipe_id = $1) AS evidence`,
                                        [id],
                                    );
                                    const expected = statementRequiredOf({
                                        sourceType,
                                        statementKind,
                                        contentPasted: pasted,
                                        // Only the count matters to the rule; the stored rows are read back, never assumed.
                                        evidence: Array.from({ length: Number(rows[0]?.evidence) }, () => ({
                                            sourceDomain: null,
                                            sourceKind: null,
                                        })),
                                    });

                                    const person = await pool.query<{ person: boolean }>(
                                        `SELECT recipe_is_from_person($1) AS person`,
                                        [id],
                                    );

                                    const expectedPerson = fromPersonOf({
                                        statementKind,
                                        attestedFromPerson: attested,
                                    });

                                    expect(
                                        person.rows[0]?.person,
                                        `recipe_is_from_person ${String(statementKind)} attested=${String(attested)}`,
                                    ).toBe(expectedPerson);
                                    seenPerson.add(expectedPerson);
                                    expect(
                                        rows[0]?.needs,
                                        `${sourceType}/${String(kind)} statement=${String(statementKind)} pasted=${String(pasted)} evidence=${rows[0]?.evidence ?? '?'}`,
                                    ).toBe(expected);
                                    seen.add(expected);
                                }
                            }
                        }
                    }
                }
            }

            expect(seen).toEqual(new Set([true, false]));
            expect(seenPerson).toEqual(new Set([true, false]));
            expect(index).toBeGreaterThan(20);
        });

        it('answers false for a recipe that does not exist', async () => {
            const { rows } = await pool.query<{ needs: boolean; person: boolean }>(
                `SELECT recipe_needs_statement('88888888-8888-4888-8888-0000000000ff') AS needs,
                        recipe_is_from_person('88888888-8888-4888-8888-0000000000ff') AS person`,
            );

            expect(rows[0]).toEqual({ needs: false, person: false });
        });
    });
});
