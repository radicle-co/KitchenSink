/**
 * Migration 0086 — `recipe_source_evidence`, its append-only guard, its clone inheritance and the deferred backstop,
 * asserted against a real Docker PostgreSQL as the SERVICE role (ADR-0039).
 *
 * ⛔ WHY THIS TIER IS MANDATORY: a unit test cannot observe a trigger that did not fire, a cascade the guard swallowed, or a
 * migration that did not apply. What is asserted:
 *
 *  1. The table, its two triggers and the backstop exist, and the table carries a comment.
 *  2. The service role can INSERT and SELECT an evidence row, but UPDATE and DELETE of one raise `check_violation`: the
 *     table is append-only for EVERY role, because the grant setup re-grants UPDATE and DELETE on every table.
 *  3. Hard-deleting the recipe still removes its rows (the guard lets the `ON DELETE CASCADE` through), and a soft delete
 *     (`deleted_at`) keeps them.
 *  4. A clone inherits its parent's rows, written by the database itself (laundering by cloning is the bypass).
 *  5. A recipe that states a source with no matching evidence row cannot COMMIT; one that has it can.
 *  6. The SQL twin answers exactly what `sourceConflictOf` answers, over the label cross product and every evidence shape.
 *     The twin is what account erasure composes: the bound private-only keys AND the database function
 *     `recipe_holds_third_party_source` (no SQL text crosses a package boundary, so recipe-core exports no SQL string).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
    PRIVATE_ONLY_SOURCE_KEYS,
    RECIPE_SOURCE_KINDS,
    RecipeSourceType,
    sourceConflictOf,
    type RecipeSourceKind,
    type SourceEvidenceFacts,
} from '@kitchensink/recipe-core';

import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const OWNER_ID = '01JU7SRCEVIDENCE000000OWNER';
const RECIPE_ID = '77777777-7777-4777-8777-000000000a01';
const CLONE_ID = '77777777-7777-4777-8777-000000000a02';
const CHECK_VIOLATION = '23514';
const PARITY_PREFIX = '77777777-7777-4777-8777-0000001';

interface EvidenceInput {
    readonly capture: 'pastedPage' | 'editorLink' | 'importFile';
    readonly sourceUrl?: string;
    readonly sourceDomain?: string;
    readonly sourceKind?: RecipeSourceKind;
    readonly citation?: string;
    readonly pasteDigest?: string;
}

const WEB: EvidenceInput = {
    capture: 'editorLink',
    sourceUrl: 'https://www.allrecipes.com/recipe/1/soup/',
    sourceDomain: 'allrecipes.com',
    sourceKind: 'public_web',
};
const DIGEST = 'a'.repeat(64);

describe('recipe_source_evidence (migration 0086)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        // The service role cannot delete evidence; deleting the recipes is what removes it, by the cascade under test.
        await pool.query(`DELETE FROM recipes WHERE id = ANY($1::uuid[]) OR id::text LIKE $2`, [
            [CLONE_ID, RECIPE_ID],
            `${PARITY_PREFIX}%`,
        ]);
    });

    afterAll(async () => {
        await pool.end();
    });

    async function insertRecipe(
        client: pg.Pool | pg.PoolClient,
        over: {
            id?: string;
            sourceType?: string;
            sourceKind?: string | null;
            sourceUrl?: string | null;
            clonedFromId?: string | null;
        } = {},
    ): Promise<void> {
        await client.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, status, source_type, source_url, source_kind,
                                  cloned_from_id)
             VALUES ($1, $2, 'Evidence suite', '', 1, 1, 2, 4, 'private', 'draft', $3, $4, $5, $6)`,
            [
                over.id ?? RECIPE_ID,
                OWNER_ID,
                over.sourceType ?? 'user_created',
                over.sourceUrl ?? null,
                over.sourceKind ?? null,
                over.clonedFromId ?? null,
            ],
        );
    }

    async function insertEvidence(
        client: pg.Pool | pg.PoolClient,
        recipeId: string,
        row: EvidenceInput,
    ): Promise<void> {
        await client.query(
            `INSERT INTO recipe_source_evidence (recipe_id, capture, source_url, source_key, source_domain, source_kind,
                                                 citation, paste_digest)
             VALUES ($1, $2, $3, $3, $4, $5, $6, $7)`,
            [
                recipeId,
                row.capture,
                row.sourceUrl ?? null,
                row.sourceDomain ?? null,
                row.sourceKind ?? null,
                row.citation ?? null,
                row.pasteDigest ?? null,
            ],
        );
    }

    async function evidenceCount(recipeId: string): Promise<number> {
        const { rows } = await pool.query<{ n: string }>(
            `SELECT count(*) AS n FROM recipe_source_evidence WHERE recipe_id = $1`,
            [recipeId],
        );

        return Number(rows[0]?.n);
    }

    /** Insert a recipe and its evidence in ONE transaction, so the deferred backstop sees both at commit. */
    async function insertRecipeWithEvidence(
        recipe: Parameters<typeof insertRecipe>[1],
        evidence: readonly EvidenceInput[],
    ): Promise<void> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            await insertRecipe(client, recipe);

            for (const row of evidence) {
                await insertEvidence(client, recipe?.id ?? RECIPE_ID, row);
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    it('creates the table with a comment, the append-only guard and the clone and backstop triggers', async () => {
        const { rows } = await pool.query<{ comment: string | null; triggers: string[] }>(
            `SELECT obj_description('recipe_source_evidence'::regclass) AS comment,
                    ARRAY(SELECT tgname::text FROM pg_trigger
                           WHERE NOT tgisinternal
                             AND tgrelid IN ('recipe_source_evidence'::regclass, 'recipes'::regclass)
                             AND tgname IN ('trg_recipe_source_evidence_append_only',
                                            'trg_recipes_clone_inherits_source_evidence',
                                            'recipes_stated_source_has_evidence')
                           ORDER BY tgname) AS triggers`,
        );

        expect(rows[0]?.comment).toBeTruthy();
        expect(rows[0]?.triggers).toEqual([
            'recipes_stated_source_has_evidence',
            'trg_recipe_source_evidence_append_only',
            'trg_recipes_clone_inherits_source_evidence',
        ]);
    });

    it('lets the service role append and read an evidence row', async () => {
        await insertRecipeWithEvidence({}, [WEB]);

        const { rows } = await pool.query<{ capture: string; source_domain: string }>(
            `SELECT capture, source_domain FROM recipe_source_evidence WHERE recipe_id = $1`,
            [RECIPE_ID],
        );

        expect(rows).toEqual([{ capture: 'editorLink', source_domain: 'allrecipes.com' }]);
    });

    it('refuses UPDATE of an evidence row as the service role, and leaves it unchanged', async () => {
        await insertRecipeWithEvidence({}, [WEB]);

        await expect(
            pool.query(`UPDATE recipe_source_evidence SET source_domain = NULL WHERE recipe_id = $1`, [RECIPE_ID]),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });

        const { rows } = await pool.query<{ source_domain: string }>(
            `SELECT source_domain FROM recipe_source_evidence WHERE recipe_id = $1`,
            [RECIPE_ID],
        );

        expect(rows[0]?.source_domain).toBe('allrecipes.com');
    });

    it('refuses DELETE of an evidence row as the service role, and as the database owner', async () => {
        await insertRecipeWithEvidence({}, [WEB]);

        await expect(
            pool.query(`DELETE FROM recipe_source_evidence WHERE recipe_id = $1`, [RECIPE_ID]),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        await expect(
            roleDb.asOwner((client) =>
                client.query(`DELETE FROM recipe_source_evidence WHERE recipe_id = $1`, [RECIPE_ID]),
            ),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        expect(await evidenceCount(RECIPE_ID)).toBe(1);
    });

    it('removes the rows when the recipe is hard-deleted: the guard lets the ON DELETE CASCADE through', async () => {
        await insertRecipeWithEvidence({}, [WEB, { capture: 'pastedPage', pasteDigest: DIGEST }]);

        await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE_ID]);

        expect(await evidenceCount(RECIPE_ID)).toBe(0);
    });

    it('keeps the rows when the recipe is only soft-deleted', async () => {
        await insertRecipeWithEvidence({}, [WEB]);

        await pool.query(`UPDATE recipes SET deleted_at = now() WHERE id = $1`, [RECIPE_ID]);

        expect(await evidenceCount(RECIPE_ID)).toBe(1);
    });

    it('copies the parent’s evidence onto a clone, keeping the original instant, even for a cleared source', async () => {
        await insertRecipeWithEvidence({}, [WEB]);
        // The cook cleared the statement: the recipe now reads as their own, and the evidence stays.
        await pool.query(
            `UPDATE recipes SET source_type = 'user_created', source_url = NULL, source_kind = NULL,
                                source_attribution = NULL WHERE id = $1`,
            [RECIPE_ID],
        );

        await insertRecipe(pool, { id: CLONE_ID, clonedFromId: RECIPE_ID });

        const { rows } = await pool.query<{ source_domain: string; same_instant: boolean }>(
            `SELECT c.source_domain, c.recorded_at = p.recorded_at AS same_instant
               FROM recipe_source_evidence c
               JOIN recipe_source_evidence p ON p.recipe_id = $2
              WHERE c.recipe_id = $1`,
            [CLONE_ID, RECIPE_ID],
        );

        expect(rows).toEqual([{ source_domain: 'allrecipes.com', same_instant: true }]);
    });

    it('copies nothing onto a recipe that is not a clone', async () => {
        await insertRecipeWithEvidence({}, [WEB]);
        await insertRecipe(pool, { id: CLONE_ID });

        expect(await evidenceCount(CLONE_ID)).toBe(0);
    });

    describe('the deferred backstop (recipes_stated_source_has_evidence)', () => {
        it('refuses to COMMIT a recipe that states a web source with no evidence', async () => {
            await expect(
                insertRecipe(pool, {
                    sourceType: 'imported_public',
                    sourceKind: 'public_web',
                    sourceUrl: WEB.sourceUrl ?? null,
                }),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });

            const { rows } = await pool.query(`SELECT 1 FROM recipes WHERE id = $1`, [RECIPE_ID]);

            expect(rows).toHaveLength(0);
        });

        it('refuses a stated source whose evidence names a DIFFERENT address', async () => {
            await expect(
                insertRecipeWithEvidence(
                    { sourceType: 'imported_public', sourceKind: 'public_web', sourceUrl: WEB.sourceUrl ?? null },
                    [{ ...WEB, sourceUrl: 'https://www.allrecipes.com/recipe/2/other/' }],
                ),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        });

        it('commits a stated source when the matching evidence is written in the same transaction', async () => {
            await insertRecipeWithEvidence(
                { sourceType: 'imported_public', sourceKind: 'public_web', sourceUrl: WEB.sourceUrl ?? null },
                [WEB],
            );

            expect(await evidenceCount(RECIPE_ID)).toBe(1);
        });

        it('commits a book and a paid site, whose address is NULL on both sides', async () => {
            await insertRecipeWithEvidence({ sourceType: 'imported_physical', sourceKind: 'book' }, [
                { capture: 'importFile', sourceKind: 'book', citation: 'A cookbook' },
            ]);

            expect(await evidenceCount(RECIPE_ID)).toBe(1);
        });

        it('refuses an UPDATE that states a source, when no evidence matches at commit', async () => {
            await insertRecipe(pool);

            await expect(
                pool.query(
                    `UPDATE recipes SET source_type = 'imported_public', source_kind = 'public_web', source_url = $2
                      WHERE id = $1`,
                    [RECIPE_ID, WEB.sourceUrl],
                ),
            ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        });

        it('lets a clone of a stated source commit: the inheritance trigger runs before the deferred check', async () => {
            await insertRecipeWithEvidence(
                { sourceType: 'imported_public', sourceKind: 'public_web', sourceUrl: WEB.sourceUrl ?? null },
                [WEB],
            );

            await insertRecipe(pool, {
                id: CLONE_ID,
                sourceType: 'imported_public',
                sourceKind: 'public_web',
                sourceUrl: WEB.sourceUrl ?? null,
                clonedFromId: RECIPE_ID,
            });

            expect(await evidenceCount(CLONE_ID)).toBe(1);
        });
    });

    describe('the SQL twin (bound private-only keys + recipe_holds_third_party_source) parity with sourceConflictOf (the label cross product × every evidence shape)', () => {
        const SHAPES: ReadonlyArray<{ readonly name: string; readonly rows: readonly EvidenceInput[] }> = [
            { name: 'none', rows: [] },
            { name: 'web', rows: [WEB] },
            {
                name: 'a pasted page naming a site',
                rows: [{ capture: 'pastedPage', pasteDigest: DIGEST, sourceDomain: 'example.com' }],
            },
            { name: 'a pasted page naming nothing', rows: [{ capture: 'pastedPage', pasteDigest: DIGEST }] },
            { name: 'a book', rows: [{ capture: 'importFile', sourceKind: 'book', citation: 'A cookbook' }] },
            {
                name: 'a paid site, by citation only',
                rows: [{ capture: 'importFile', sourceKind: 'paid_site', citation: 'Paid Site' }],
            },
        ];

        /** Whether the recipes table accepts the pair (`recipes_source_kind_pairs_source_type`). */
        function pairs(sourceType: RecipeSourceType, sourceKind: RecipeSourceKind | null): boolean {
            switch (sourceKind) {
                case null:
                    return true;
                case 'public_web':
                    return sourceType === RecipeSourceType.IMPORTED_PUBLIC;
                case 'book':
                    return sourceType === RecipeSourceType.IMPORTED_PHYSICAL;
                case 'paid_site':
                    return sourceType === RecipeSourceType.IMPORTED_PAID;
            }
        }

        /** The evidence facts a row gives the TypeScript rule. */
        function factsOf(row: EvidenceInput): SourceEvidenceFacts {
            return { sourceDomain: row.sourceDomain ?? null, sourceKind: row.sourceKind ?? null };
        }

        /** The evidence row that backs the recipe's own stated kind (the backstop demands one). */
        function backing(sourceKind: RecipeSourceKind | null): readonly EvidenceInput[] {
            switch (sourceKind) {
                case null:
                    return [];
                case 'public_web':
                    return [WEB];
                case 'book':
                    return [{ capture: 'importFile', sourceKind: 'book', citation: 'A cookbook' }];
                case 'paid_site':
                    return [{ capture: 'importFile', sourceKind: 'paid_site', citation: 'Paid Site' }];
            }
        }

        it('agrees on every combination, and holds at least one and releases at least one', async () => {
            const seen = new Set<boolean>();
            let index = 0;

            for (const sourceType of Object.values(RecipeSourceType)) {
                for (const sourceKind of [...RECIPE_SOURCE_KINDS, null]) {
                    if (!pairs(sourceType, sourceKind)) {
                        continue;
                    }

                    for (const shape of SHAPES) {
                        index += 1;
                        const id = `${PARITY_PREFIX}${String(index).padStart(5, '0')}`;
                        const url = sourceKind === 'public_web' ? (WEB.sourceUrl ?? null) : null;
                        const evidence = [...backing(sourceKind), ...shape.rows];

                        await insertRecipeWithEvidence({ id, sourceType, sourceKind, sourceUrl: url }, evidence);

                        const { rows } = await pool.query<{ conflict: boolean }>(
                            `SELECT ((r.source_type || ':' || COALESCE(r.source_kind, '')) NOT IN
                                         (SELECT jsonb_array_elements_text($2::jsonb))
                                     AND recipe_holds_third_party_source(r.id)) AS conflict
                               FROM recipes r WHERE r.id = $1`,
                            [id, JSON.stringify(PRIVATE_ONLY_SOURCE_KEYS)],
                        );
                        const expected = sourceConflictOf({
                            evidence: evidence.map(factsOf),
                            sourceType,
                            sourceKind,
                            verifiedSiteClaims: [],
                        });

                        expect(rows[0]?.conflict, `${sourceType}/${String(sourceKind)} with ${shape.name}`).toBe(
                            expected,
                        );
                        seen.add(expected);
                    }
                }
            }

            expect(seen).toEqual(new Set([true, false]));
        });
    });
});
