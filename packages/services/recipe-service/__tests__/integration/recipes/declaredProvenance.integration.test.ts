/**
 * Declared provenance on create (004-FR-024 / 004-FR-025, ADR-0023) — integration spec against a real
 * Nest app + Docker Postgres (`tests/globalSetup.ts`).
 *
 * ## What only this tier can prove
 *
 * `provenancePolicy.test.ts` exhausts the decision as a truth table, and `recipes.schema.test.ts` pins the
 * wire shape. Neither can observe the thing that actually matters to a reader of an imported recipe: that
 * the declared `sourceUrl` and `sourceAttribution` **reach the columns**. `source_type`, `source_url` and
 * `source_attribution` are not on the `Recipe` wire response, so a mocked test asserting "the service called
 * the DAL with these fields" would still pass if the DAL dropped them — which is precisely how they were
 * dropped before this change (the DAL accepted them and no creation path ever passed them). The rows are
 * therefore read back directly through Drizzle.
 *
 * ## The two halves, and why each is driven at a different layer
 *
 * - **The DENIAL is driven over HTTP**, because the status code is the contract: an ordinary caller must get
 *   a `403` (about the caller) and not a `400` (about the body). The harness's dev-auth bypass injects
 *   `scopes: []` / `permissions: []`, which IS the ungranted principal, so this is the real path.
 * - **The ALLOW is driven through the container**, calling `RecipesService.create` with a principal that
 *   carries the curator grant. The dev-auth bypass cannot express a scope, and the alternative — widening
 *   that bypass with a scope env var — would be a production-code change made solely for a test. Going
 *   through the DI container keeps the service, the policy, the DAL, the transaction and the database in the
 *   path; only the HTTP hop and the token verification are outside it, and both are covered elsewhere.
 *
 * Guarded with `describe.skipIf(!hasDatabaseUrl)` so it is a no-op when the harness is not up.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { recipes, type RecipeRow } from '../../../src/database/schema/index.js';
import { RecipesService } from '../../../src/recipes/recipes.service.js';
import { CURATOR_IMPORT_SCOPE } from '../../../src/recipes/recipes.schema.js';
import type { CreateRecipeDto } from '../../../src/recipes/dto/createRecipe.dto.js';
import type { Principal } from '../../../src/auth/principal.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** The acting owner for every case here — also the dev-auth principal the HTTP half authenticates as. */
const CURATOR = '01JCURATOROWNERAAAAAAAAAAAA';
/** A seeded catalog ingredient (Flour) from the baseline global setup. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';

/** The public-domain source this suite declares — a real, reachable Project Gutenberg plain-text URL. */
const SOURCE_URL = 'https://www.gutenberg.org/cache/epub/12350/pg12350.txt';
/** The credit that must survive to the column and, from there, to the detail view. */
const SOURCE_ATTRIBUTION = 'The International Jewish Cook Book by Florence Kreisler Greenbaum';

/** A minimal-but-publishable create body; `over` layers the field under test on top. */
function body(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        title: 'Beet Soup, Russian Style',
        servings: 1,
        prepTimeMinutes: 0,
        cookTimeMinutes: 180,
        totalTimeMinutes: 180,
        ingredients: [{ ingredientId: FLOUR_ID, name: 'Flour', quantity: { kind: 'exact', value: 2 }, unit: 'cup' }],
        steps: [{ instruction: 'Cut one large beet and put it in the kettle.' }],
        ...over,
    };
}

/** A verified principal carrying exactly the grants given. */
function principal(grants: { scopes?: string[]; permissions?: string[] } = {}): Principal {
    return {
        userId: CURATOR,
        sub: `test:${CURATOR}`,
        scopes: grants.scopes ?? [],
        permissions: grants.permissions ?? [],
    };
}

describe.skipIf(!hasDatabaseUrl)('declared provenance on create (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let service: RecipesService;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: CURATOR });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
        service = booted.app.get(RecipesService);
    });

    afterAll(async () => {
        await pool.end();
        await booted.close();
    });

    beforeEach(async () => {
        await db.delete(recipes).where(sql`${recipes.ownerId} = ${CURATOR}`);
    });

    /** Read one recipe row directly — the provenance columns are not on the wire response. */
    async function readRow(id: string): Promise<RecipeRow> {
        const [row] = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);

        if (!row) {
            throw new Error(`recipe ${id} not found`);
        }

        return row;
    }

    it('writes the declared source to the COLUMNS when the caller holds the curator grant', async () => {
        const created = await service.create(
            principal({ scopes: [CURATOR_IMPORT_SCOPE] }),
            body({
                source: {
                    sourceType: 'imported_public',
                    sourceUrl: SOURCE_URL,
                    sourceAttribution: SOURCE_ATTRIBUTION,
                },
            }) as unknown as CreateRecipeDto,
        );

        const row = await readRow(created.id);

        expect(row.sourceType).toBe('imported_public');
        expect(row.sourceUrl).toBe(SOURCE_URL);
        expect(row.sourceAttribution).toBe(SOURCE_ATTRIBUTION);
        // A curated import is public, and C-004 must have judged it against `imported_public` rather than
        // the literal `user_created` the service used to pass — the substitution this change is made of.
        expect(row.visibility).toBe('public');
        // An import is not a substantive edit; the flag stays false until someone actually edits it.
        expect(row.hasSubstantiveEdit).toBe(false);
    });

    it('leaves the provenance columns at their defaults when no source is declared (004-FR-024)', async () => {
        const created = await service.create(
            principal({ scopes: [CURATOR_IMPORT_SCOPE] }),
            body() as unknown as CreateRecipeDto,
        );

        const row = await readRow(created.id);

        // Byte-for-byte the pre-change row: holding the grant changes NOTHING for a caller who declares
        // nothing. A mutant that defaulted a declared-source-shaped recipe to `imported_public`, or that
        // wrote `''` instead of NULL into either text column, dies here.
        expect(row.sourceType).toBe('user_created');
        expect(row.sourceUrl).toBeNull();
        expect(row.sourceAttribution).toBeNull();
    });

    it('REFUSES the declaration with 403 over HTTP when the caller holds no grant', async () => {
        const res = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
                body({
                    source: {
                        sourceType: 'imported_public',
                        sourceUrl: SOURCE_URL,
                        sourceAttribution: SOURCE_ATTRIBUTION,
                    },
                }),
            ),
        });

        expect(res.status).toBe(403);

        const error = (await res.json()) as { code: string; message: string; details?: Record<string, unknown> };

        // A `403` alone would also be produced by an ownership failure; the CODE and the named scope are
        // what make the refusal actionable rather than merely correct.
        expect(error.code).toBe('FORBIDDEN');
        expect(error.details?.['requiredScope']).toBe(CURATOR_IMPORT_SCOPE);

        // And the refusal is a REFUSAL: nothing was written under a different classification.
        const rows = await db
            .select()
            .from(recipes)
            .where(sql`${recipes.ownerId} = ${CURATOR}`);
        expect(rows).toHaveLength(0);
    });

    it('still creates an ordinary recipe over HTTP for that same ungranted caller', async () => {
        // The counterpart property, so the assertion above cannot be satisfied by a route that refuses
        // everything — `POST /api/v1/recipes` must stay open to every authenticated user.
        const res = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body()),
        });

        expect(res.status).toBe(201);

        const created = (await res.json()) as { id: string };
        expect((await readRow(created.id)).sourceType).toBe('user_created');
    });

    it('answers 400 — not 403 — for a provenance the wire does not admit at all', async () => {
        // `imported_physical` is refused by the SCHEMA, so the failure is about the body and no grant could
        // ever change it. Keeping the two failures distinguishable is the reason the shape lives in zod and
        // the grant lives in the policy.
        const res = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body({ source: { sourceType: 'imported_physical', sourceAttribution: 'A book' } })),
        });

        expect(res.status).toBe(400);
    });
});
