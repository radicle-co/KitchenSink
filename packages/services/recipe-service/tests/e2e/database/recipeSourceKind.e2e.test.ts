/**
 * Migration 0071 — `recipes.source_kind` and its two CHECKs, asserted against a real Docker PostgreSQL as the service
 * role (ADR-0089).
 *
 * ⛔ WHY THIS TIER IS MANDATORY: a unit test cannot observe a migration that did not apply. What is asserted:
 *
 *  1. `source_kind` exists, is NULL for a recipe that states none (the one spelling of "none"), and round-trips the
 *     three kinds the import vocabulary names.
 *  2. A value outside that vocabulary is REFUSED (`recipes_source_kind_check`).
 *  3. Every kind is paired with its label (`recipes_source_kind_pairs_source_type`): `public_web` with `imported_public` AND an
 *     address, `book` with `imported_physical`, `paid_site` with `imported_paid`. No other pairing can be written by any
 *     writer, the service included.
 *  4. `PRIVATE_ONLY_SOURCE_KEYS`, bound the way account erasure binds it, agrees with `privateRuleOf` for every pair.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { PRIVATE_ONLY_SOURCE_KEYS, RECIPE_SOURCE_KINDS, privateRuleOf } from '@kitchensink/recipe-core';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const OWNER_ID = '01JU7SRCKIND0000000000OWNER';
const RECIPE_ID = '55555555-5555-4555-8555-000000000961';

describe('recipes.source_kind and its CHECKs (migration 0071)', () => {
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
        await expect(insert('imported_public', null, 'public_web')).rejects.toThrow(
            /recipes_source_kind_pairs_source_type/u,
        );
    });

    // Every kind is paired with its label: the full cross product, so a mutant that loosens one pairing fails one row.
    const LABELS = ['user_created', 'imported_public', 'imported_physical', 'imported_paid'] as const;
    const PAIRS = [
        ['public_web', 'imported_public'],
        ['book', 'imported_physical'],
        ['paid_site', 'imported_paid'],
    ] as const;

    it.each(
        PAIRS.flatMap(([kind, label]) =>
            LABELS.filter((sourceType) => sourceType !== label).map((sourceType) => [kind, sourceType] as const),
        ),
    )('refuses the kind %s labelled %s', async (kind, sourceType) => {
        await expect(insert(sourceType, 'https://example.com/recipe', kind)).rejects.toThrow(
            /recipes_source_kind_pairs_source_type/u,
        );
    });

    // The BOUND form account erasure uses (`PRIVATE_ONLY_SOURCE_KEYS`, the key built in SQL exactly as the worker builds it)
    // against `privateRuleOf`, for every pair, in a real database.
    it.each(LABELS.flatMap((sourceType) => [...RECIPE_SOURCE_KINDS, null].map((kind) => [sourceType, kind] as const)))(
        'the bound private-only keys agree with privateRuleOf for %s with kind %s',
        async (sourceType, kind) => {
            const { rows } = await pool.query<{ private_only: boolean }>(
                `SELECT (source_type || ':' || COALESCE(source_kind, '')) IN
                        (SELECT jsonb_array_elements_text($3::jsonb)) AS private_only
                   FROM (VALUES ($1::text, $2::text)) AS recipes(source_type, source_kind)`,
                [sourceType, kind, JSON.stringify(PRIVATE_ONLY_SOURCE_KEYS)],
            );

            expect(rows[0]?.private_only).toBe(privateRuleOf(sourceType, kind) === 'privateOnly');
        },
    );
});
