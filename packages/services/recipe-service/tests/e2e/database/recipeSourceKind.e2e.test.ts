/**
 * Migration 0065 — `recipes.source_kind` and its two CHECKs, asserted against a real Docker PostgreSQL as the service
 * role (ADR-0089).
 *
 * ⛔ WHY THIS TIER IS MANDATORY: a unit test cannot observe a migration that did not apply. What is asserted:
 *
 *  1. `source_kind` exists, is NULL for a recipe that states none (the one spelling of "none"), and round-trips the
 *     three kinds the import vocabulary names.
 *  2. A value outside that vocabulary is REFUSED (`recipes_source_kind_check`).
 *  3. A web copy with no address, or one that is not `imported_public`, is REFUSED (`recipes_web_source_has_address`), so
 *     "a web copy no one can link to" cannot be written by any writer, the service included.
 *  4. A book or paid-site statement is NOT held to that rule: the CHECK constrains the web kind only.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const OWNER_ID = '01JU7SRCKIND0000000000OWNER';
const RECIPE_ID = '55555555-5555-4555-8555-000000000961';

describe('recipes.source_kind and its CHECKs (migration 0065)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE_ID]);
    });

    afterAll(async () => {
        await pool.end();
    });

    async function insert(sourceType: string, sourceUrl: string | null, sourceKind: string | null): Promise<void> {
        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, status, source_type, source_url, source_kind)
             VALUES ($1, $2, 'Source kind suite', '', 1, 1, 2, 4, 'private', 'draft', $3, $4, $5)`,
            [RECIPE_ID, OWNER_ID, sourceType, sourceUrl, sourceKind],
        );
    }

    async function storedKind(): Promise<string | null> {
        const { rows } = await pool.query<{ source_kind: string | null }>(
            `SELECT source_kind FROM recipes WHERE id = $1`,
            [RECIPE_ID],
        );

        return rows[0]?.source_kind ?? null;
    }

    it('is NULL for a recipe that states no source', async () => {
        await insert('user_created', null, null);

        expect(await storedKind()).toBeNull();
    });

    it('is NULL for the curator’s public-domain text, which carries the same label as a web copy', async () => {
        await insert('imported_public', 'https://www.gutenberg.org/cache/epub/12350/pg12350.txt', null);

        expect(await storedKind()).toBeNull();
    });

    it('round-trips a web copy: imported_public, an address and the kind', async () => {
        await insert('imported_public', 'https://example.com/recipe', 'public_web');

        expect(await storedKind()).toBe('public_web');
    });

    it.each([
        ['imported_physical', 'book'],
        ['imported_paid', 'paid_site'],
    ])('round-trips %s with the %s kind, and does not hold it to the web rule', async (sourceType, kind) => {
        await insert(sourceType, null, kind);

        expect(await storedKind()).toBe(kind);
    });

    it('refuses a kind outside the vocabulary', async () => {
        await expect(insert('imported_public', 'https://example.com/recipe', 'blog')).rejects.toThrow(
            /recipes_source_kind_check/u,
        );
    });

    it('refuses a web copy with no address', async () => {
        await expect(insert('imported_public', null, 'public_web')).rejects.toThrow(/recipes_web_source_has_address/u);
    });

    it.each(['user_created', 'imported_physical', 'imported_paid'])(
        'refuses a web copy labelled %s',
        async (sourceType) => {
            await expect(insert(sourceType, 'https://example.com/recipe', 'public_web')).rejects.toThrow(
                /recipes_web_source_has_address/u,
            );
        },
    );
});
