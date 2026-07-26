/**
 * `GET /v1/account/export` against the REAL stack (booted Nest app + Docker Postgres). The service half
 * of the GDPR Art. 15 (access) / Art. 20 (portability) export — the read-only mirror of the erasure path.
 *
 * The unit tier (`src/account/__tests__/*`, `src/account/dal/__tests__/*`) already pins the DAL's query
 * SHAPE, the pure row→export mapping, and the service's composition against fakes — exhaustively and
 * faster. None of that is re-asserted here. What is left is the one fact a fake CANNOT establish and the
 * entire endpoint exists to guarantee: that the owner-scoped `WHERE`/`INNER JOIN`s ACTUALLY isolate one
 * user's data from another's in a real Postgres, so a caller can only ever export THEIR OWN data.
 *
 * The suite seeds two owners (A = the authenticated caller via dev-bypass, B = a bystander) across every
 * owner-scoped root the export touches, then asserts A's export contains exactly A's rows — including A's
 * DRAFT, PRIVATE, and TOMBSTONED recipes and A's rating on B's recipe — and none of B's, not even B's
 * rating that sits on A's recipe.
 *
 * Runs only when the harness DB is configured — otherwise skipped in lockstep with the global setup.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import type { AccountExport } from '../../../src/account/dto/export.dto.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** The authenticated caller (dev-bypass owner) whose export every assertion is about. */
const OWNER_A = '01JEXPORTITOWNERA0000000AA';
/** A bystander whose data must NEVER appear in A's export. */
const OWNER_B = '01JEXPORTITOWNERB0000000BB';

const RECIPE_A_PUBLIC = '00000000-0000-4000-8000-0000ef000a01';
const RECIPE_A_DRAFT = '00000000-0000-4000-8000-0000ef000a02';
const RECIPE_A_DELETED = '00000000-0000-4000-8000-0000ef000a03';
const RECIPE_B_PUBLIC = '00000000-0000-4000-8000-0000ef000b01';

const COLLECTION_A = '00000000-0000-4000-8000-0000ef00ca01';
const COLLECTION_B = '00000000-0000-4000-8000-0000ef00cb01';

const OWNER_IDS = [OWNER_A, OWNER_B];

describe.skipIf(!hasDatabaseUrl)('account export HTTP (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;

    beforeAll(async () => {
        // Lift the export rate cap OFF this suite (default 10/min) so a re-run within the same minute is
        // never throttled into a spurious failure. Set BEFORE bootRecipeApp reads env at AppModule import.
        process.env['RATE_LIMIT_EXPORT'] = '1000';

        booted = await bootRecipeApp({ devAuthUserId: OWNER_A });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

        await cleanup();
        await seed();
    });

    afterAll(async () => {
        await cleanup();
        await pool.end();
        await booted?.close();
    });

    /** Remove every row this suite owns, children-first, so it is idempotent across re-runs. */
    async function cleanup(): Promise<void> {
        await pool.query('DELETE FROM recipe_ratings WHERE user_id = ANY($1)', [OWNER_IDS]);
        // Ratings/photos/versions/memberships cascade from recipes; collections cascade their memberships.
        await pool.query('DELETE FROM recipes WHERE owner_id = ANY($1)', [OWNER_IDS]);
        await pool.query('DELETE FROM collections WHERE owner_id = ANY($1)', [OWNER_IDS]);
        await pool.query('DELETE FROM author_handles WHERE user_id = ANY($1)', [OWNER_IDS]);
    }

    /** Insert a recipe with the non-null columns the schema requires. */
    async function insertRecipe(
        id: string,
        ownerId: string,
        overrides: { visibility?: string; status?: string; deletedAt?: string | null } = {},
    ): Promise<void> {
        await pool.query(
            `INSERT INTO recipes
                (id, owner_id, title, prep_time_minutes, cook_time_minutes, total_time_minutes, servings,
                 visibility, status, deleted_at)
             VALUES ($1, $2, $3, 5, 10, 15, 4, $4, $5, $6)`,
            [
                id,
                ownerId,
                `Recipe ${id.slice(-3)}`,
                overrides.visibility ?? 'public',
                overrides.status ?? 'published',
                overrides.deletedAt ?? null,
            ],
        );
    }

    /** Seed both owners across every owner-scoped root the export reads. */
    async function seed(): Promise<void> {
        // Recipes: A owns a public, a DRAFT, and a TOMBSTONED recipe; B owns one public recipe.
        await insertRecipe(RECIPE_A_PUBLIC, OWNER_A);
        await insertRecipe(RECIPE_A_DRAFT, OWNER_A, { status: 'draft', visibility: 'private' });
        await insertRecipe(RECIPE_A_DELETED, OWNER_A, { deletedAt: '2026-03-01T00:00:00.000Z' });
        await insertRecipe(RECIPE_B_PUBLIC, OWNER_B);

        // Collections + memberships, one per owner.
        await pool.query('INSERT INTO collections (id, owner_id, name) VALUES ($1, $2, $3)', [
            COLLECTION_A,
            OWNER_A,
            'A collection',
        ]);
        await pool.query('INSERT INTO collections (id, owner_id, name) VALUES ($1, $2, $3)', [
            COLLECTION_B,
            OWNER_B,
            'B collection',
        ]);
        await pool.query('INSERT INTO recipe_collections (collection_id, recipe_id) VALUES ($1, $2)', [
            COLLECTION_A,
            RECIPE_A_PUBLIC,
        ]);
        await pool.query('INSERT INTO recipe_collections (collection_id, recipe_id) VALUES ($1, $2)', [
            COLLECTION_B,
            RECIPE_B_PUBLIC,
        ]);

        // Ratings: A rates B's recipe (must appear in A's export — the cross-recipe erasure root); B rates
        // A's recipe (must NOT appear in A's export).
        await pool.query('INSERT INTO recipe_ratings (recipe_id, user_id, stars) VALUES ($1, $2, 5)', [
            RECIPE_B_PUBLIC,
            OWNER_A,
        ]);
        await pool.query('INSERT INTO recipe_ratings (recipe_id, user_id, stars) VALUES ($1, $2, 3)', [
            RECIPE_A_PUBLIC,
            OWNER_B,
        ]);

        // Photos: one per owner's recipe.
        await pool.query('INSERT INTO recipe_photos (recipe_id, s3_key, content_type) VALUES ($1, $2, $3)', [
            RECIPE_A_PUBLIC,
            `recipes/${OWNER_A}/photos/a.jpg`,
            'image/jpeg',
        ]);
        await pool.query('INSERT INTO recipe_photos (recipe_id, s3_key, content_type) VALUES ($1, $2, $3)', [
            RECIPE_B_PUBLIC,
            `recipes/${OWNER_B}/photos/b.jpg`,
            'image/jpeg',
        ]);

        // Versions: one per owner's recipe (snapshot is a non-null jsonb; content is irrelevant here).
        await pool.query(
            `INSERT INTO recipe_versions (recipe_id, version_number, snapshot, created_by)
             VALUES ($1, 1, '{}'::jsonb, $2)`,
            [RECIPE_A_PUBLIC, OWNER_A],
        );
        await pool.query(
            `INSERT INTO recipe_versions (recipe_id, version_number, snapshot, created_by)
             VALUES ($1, 1, '{}'::jsonb, $2)`,
            [RECIPE_B_PUBLIC, OWNER_B],
        );

        // Author handles, one per owner.
        await pool.query(
            'INSERT INTO author_handles (user_id, display_name, source_timestamp) VALUES ($1, $2, now())',
            [OWNER_A, 'Owner A'],
        );
        await pool.query(
            'INSERT INTO author_handles (user_id, display_name, source_timestamp) VALUES ($1, $2, now())',
            [OWNER_B, 'Owner B'],
        );
    }

    async function fetchExport(): Promise<{ status: number; body: AccountExport }> {
        const response = await fetch(`${baseUrl}/v1/account/export`);

        return { status: response.status, body: (await response.json()) as AccountExport };
    }

    it('answers 200 and scopes the document to the authenticated owner', async () => {
        const { status, body } = await fetchExport();

        expect(status).toBe(200);
        expect(body.ownerId).toBe(OWNER_A);
        expect(Number.isNaN(Date.parse(body.exportedAt))).toBe(false);
    });

    it("returns ALL of the owner's recipes — public, private/draft, AND tombstoned — and none of another owner's", async () => {
        const { body } = await fetchExport();

        const ids = body.recipes.map((recipe) => recipe.id).sort();
        expect(ids).toEqual([RECIPE_A_PUBLIC, RECIPE_A_DRAFT, RECIPE_A_DELETED].sort());
        expect(ids).not.toContain(RECIPE_B_PUBLIC);

        // Every recipe is the caller's, and the tombstoned one carries its deletedAt (faithful mirror).
        expect(body.recipes.every((recipe) => recipe.ownerId === OWNER_A)).toBe(true);
        const deleted = body.recipes.find((recipe) => recipe.id === RECIPE_A_DELETED);
        expect(deleted?.deletedAt).not.toBeNull();
    });

    it("returns only the owner's collections, with only their own memberships embedded", async () => {
        const { body } = await fetchExport();

        expect(body.collections.map((collection) => collection.id)).toEqual([COLLECTION_A]);
        expect(body.collections[0]?.recipes.map((member) => member.recipeId)).toEqual([RECIPE_A_PUBLIC]);
    });

    it("returns the owner's ratings on ANY recipe (incl. another user's), and never another user's rating on the owner's recipe", async () => {
        const { body } = await fetchExport();

        // A's rating lives on B's recipe — it is A's data and must be present.
        expect(body.ratings).toHaveLength(1);
        expect(body.ratings[0]).toMatchObject({ recipeId: RECIPE_B_PUBLIC, userId: OWNER_A });
        // B's rating sits on A's recipe but is NOT A's data — it must be absent.
        expect(body.ratings.every((rating) => rating.userId === OWNER_A)).toBe(true);
    });

    it('returns only the photos, versions, and author handles belonging to the owner', async () => {
        const { body } = await fetchExport();

        expect(body.photos.map((photo) => photo.recipeId)).toEqual([RECIPE_A_PUBLIC]);
        expect(body.photos[0]?.url).toContain(`recipes/${OWNER_A}/photos/a.jpg`);

        expect(body.versions.map((version) => version.recipeId)).toEqual([RECIPE_A_PUBLIC]);
        expect(body.versions.every((version) => version.createdBy === OWNER_A)).toBe(true);

        expect(body.authorHandles.map((handle) => handle.userId)).toEqual([OWNER_A]);
        expect(body.authorHandles[0]?.displayName).toBe('Owner A');
    });
});
