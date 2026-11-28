/**
 * Migration 0098 — `recipe_held_from_readers` and `recipe_has_cook_source_evidence`, asserted against a real Docker
 * PostgreSQL as the SERVICE role (ADR-0039, ADR-0105).
 *
 * The read rule's hold has three terms: the correction hold column, cook-captured third-party evidence (rows with
 * `capture <> 'staffCorrection'`), and a private-only label read from the BOUND keys argument. Every expected value below
 * is written by hand; none is derived from the function under test or from `PRIVATE_ONLY_SOURCE_KEYS` except where a case
 * is explicitly about the bound argument.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { PRIVATE_ONLY_SOURCE_KEYS } from '@kitchensink/recipe-core';

import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const OWNER_ID = '01JU7HELDREADERS0000000OWNER';
const ID_PREFIX = '88888888-8888-4888-8888-0000002';
const rid = (n: number): string => `${ID_PREFIX}${String(n).padStart(5, '0')}`;
const KEYS = JSON.stringify(PRIVATE_ONLY_SOURCE_KEYS);

interface Evidence {
    readonly capture: 'pastedPage' | 'editorLink' | 'editorCitation' | 'importFile' | 'staffCorrection';
    readonly sourceUrl?: string;
    readonly sourceDomain?: string;
    readonly sourceKind?: 'public_web' | 'book' | 'paid_site';
    readonly citation?: string;
    readonly pasteDigest?: string;
}

const WEB: Evidence = {
    capture: 'editorLink',
    sourceUrl: 'https://www.allrecipes.com/recipe/1/soup/',
    sourceDomain: 'allrecipes.com',
    sourceKind: 'public_web',
};
const BOOK: Evidence = { capture: 'editorCitation', sourceKind: 'book', citation: 'A Cookbook, p. 3' };
const PAID: Evidence = { capture: 'editorCitation', sourceKind: 'paid_site', citation: 'Paid Site, issue 4' };
const PASTE_NO_DOMAIN: Evidence = { capture: 'pastedPage', pasteDigest: 'a'.repeat(64) };
const STAFF_BOOK: Evidence = { capture: 'staffCorrection', sourceKind: 'book', citation: 'A Cookbook, p. 3' };

describe('recipe_held_from_readers (migration 0098)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM recipes WHERE id::text LIKE $1`, [`${ID_PREFIX}%`]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Insert an own-label recipe (user_created, no kind) with its evidence in one transaction. */
    async function seed(n: number, evidence: readonly Evidence[], hold = false): Promise<string> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                      total_time_minutes, servings, visibility, status, source_type, source_correction_hold)
                 VALUES ($1, $2, 'Held suite', '', 1, 1, 2, 4, 'private', 'draft', 'user_created', $3)`,
                [rid(n), OWNER_ID, hold],
            );

            for (const e of evidence) {
                await client.query(
                    `INSERT INTO recipe_source_evidence (recipe_id, capture, source_url, source_key, source_domain,
                                                         source_kind, citation, paste_digest)
                     VALUES ($1, $2, $3, $3, $4, $5, $6, $7)`,
                    [
                        rid(n),
                        e.capture,
                        e.sourceUrl ?? null,
                        e.sourceDomain ?? null,
                        e.sourceKind ?? null,
                        e.citation ?? null,
                        e.pasteDigest ?? null,
                    ],
                );
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

        return rid(n);
    }

    async function heldOf(id: string, keys: string = KEYS): Promise<boolean | null> {
        const { rows } = await pool.query<{ held: boolean | null }>(
            `SELECT recipe_held_from_readers(r, $2::jsonb) AS held FROM recipes r WHERE r.id = $1`,
            [id, keys],
        );

        return rows[0]?.held ?? null;
    }

    async function evidenceOf(id: string): Promise<boolean | null> {
        const { rows } = await pool.query<{ e: boolean | null }>(
            `SELECT recipe_has_cook_source_evidence($1::uuid) AS e`,
            [id],
        );

        return rows[0]?.e ?? null;
    }

    /** A built row value: the label and hold only, for a direct call with no table row behind it. */
    async function builtHeld(
        sourceType: string,
        sourceKind: string | null,
        hold: boolean,
        keys: string = KEYS,
    ): Promise<boolean | null> {
        const { rows } = await pool.query<{ held: boolean | null }>(
            `SELECT recipe_held_from_readers(
                 jsonb_populate_record(NULL::recipes, $1::jsonb), $2::jsonb) AS held`,
            [
                JSON.stringify({
                    id: '88888888-8888-4888-8888-999999999999',
                    source_correction_hold: hold,
                    source_type: sourceType,
                    ...(sourceKind === null ? {} : { source_kind: sourceKind }),
                }),
                keys,
            ],
        );

        return rows[0]?.held ?? null;
    }

    it.each([
        ['cook evidence with a domain', [WEB], true],
        ['cook evidence, a book', [BOOK], true],
        ['cook evidence, a paid site', [PAID], true],
        ['a pasted page with no domain (main rule, po-confirmed)', [PASTE_NO_DOMAIN], false],
        ['no evidence', [], false],
        ['only a staffCorrection row', [STAFF_BOOK], false],
        ['staffCorrection book + cook book', [STAFF_BOOK, BOOK], true],
        ['staffCorrection book + cook pasted page with no domain', [STAFF_BOOK, PASTE_NO_DOMAIN], false],
    ] as const)('evidence term and read function on an own label: %s', async (_name, evidence, expected) => {
        const id = await seed(1, evidence);

        expect(await evidenceOf(id)).toBe(expected);
        expect(await heldOf(id)).toBe(expected);
    });

    it('does not count evidence of another recipe', async () => {
        await seed(1, [WEB]);
        const other = await seed(2, []);

        expect(await evidenceOf(other)).toBe(false);
        expect(await heldOf(other)).toBe(false);
    });

    it('is held by the hold column alone, with and without evidence', async () => {
        expect(await heldOf(await seed(1, [], true))).toBe(true);
        expect(await heldOf(await seed(2, [WEB], true))).toBe(true);
        expect(await heldOf(await seed(3, [], false))).toBe(false);
    });

    it('is held for a hold on every label, by a built row', async () => {
        for (const [type, kind] of [
            ['user_created', null],
            ['imported_public', null],
            ['imported_physical', 'book'],
            ['imported_paid', 'paid_site'],
            ['imported_public', 'public_web'],
        ] as const) {
            expect(await builtHeld(type, kind, true)).toBe(true);
        }
    });

    it.each([
        ['imported_physical', 'book', true],
        ['imported_paid', 'paid_site', true],
        ['imported_public', 'public_web', true],
        ['user_created', null, false],
        ['imported_public', null, false],
    ] as const)('label %s:%s is held=%s with the production keys (strict boolean)', async (type, kind, expected) => {
        expect(await builtHeld(type, kind, false)).toBe(expected);
    });

    it('reads the bound keys, never a constant: a label absent from the argument is not held', async () => {
        expect(await builtHeld('imported_physical', 'book', false, JSON.stringify([]))).toBe(false);
        expect(await builtHeld('imported_physical', 'book', false, JSON.stringify(['imported_physical:book']))).toBe(
            true,
        );
        expect(await builtHeld('imported_paid', 'paid_site', false, JSON.stringify(['imported_physical:book']))).toBe(
            false,
        );
    });

    it('answers strict true or false for a stored row, never NULL', async () => {
        expect(await heldOf(await seed(1, []))).toBe(false);
        expect(await heldOf(await seed(2, [BOOK]))).toBe(true);
    });

    it('equals the write-side recipe_holds_third_party_source on cook-only evidence and differs on staff-only evidence (KTD-3)', async () => {
        const cases: ReadonlyArray<readonly [number, readonly Evidence[]]> = [
            [1, [WEB]],
            [2, [BOOK]],
            [3, [PASTE_NO_DOMAIN]],
            [4, []],
        ];

        for (const [n, evidence] of cases) {
            const id = await seed(n, evidence);
            const { rows } = await pool.query<{ w: boolean }>(`SELECT recipe_holds_third_party_source($1) AS w`, [id]);

            expect(await evidenceOf(id)).toBe(rows[0]?.w);
        }

        const staffOnly = await seed(5, [STAFF_BOOK]);
        const { rows } = await pool.query<{ w: boolean }>(`SELECT recipe_holds_third_party_source($1) AS w`, [
            staffOnly,
        ]);

        expect(rows[0]?.w).toBe(true);
        expect(await evidenceOf(staffOnly)).toBe(false);
    });
});
