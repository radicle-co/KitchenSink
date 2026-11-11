/**
 * A pasted web link as the recipe's source (ADR-0089) — the HTTP contract against a real Nest app and a real PostgreSQL
 * (`tests/globalSetup.ts`), the service role, the migrated schema and its CHECKs.
 *
 * ## What only this tier can prove
 *
 * The mocked integration tier (`sourceStatement.integration.test.ts`) proves the service hands the DAL the right columns. It
 * cannot prove they survive `recipes_source_kind_pairs_source_type`, that the first-publish trigger really closes the
 * correction window, or that a clone really carries its source. The source columns are not all on the wire response, so the
 * rows are read back through Drizzle.
 *
 * The caller over HTTP is the harness's dev-auth principal: a free cook with no grants. The curator-grant case goes through
 * the container (`RecipesService.create` with a granted principal), because the dev-auth bypass cannot express a scope.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { recipes, type RecipeRow } from '../../../src/database/schema/index.js';
import { RecipesService } from '../../../src/recipes/recipes.service.js';
import { CURATOR_IMPORT_SCOPE, createRecipeRequestSchema } from '../../../src/recipes/recipes.schema.js';
import type { Principal } from '../../../src/auth/principal.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();

const COOK = '01JSRCSTATEMENTCOOKAAAAAA1';
/** A seeded catalog ingredient (Flour) from the baseline global setup. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';
const LINK = 'https://www.allrecipes.com/recipe/1/soup/';
const STATEMENT = { kind: 'public_web', citation: LINK } as const;

/** A minimal-but-publishable create body; `over` layers the field under test on top. */
function body(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        title: 'Tomato Soup',
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 20,
        totalTimeMinutes: 25,
        cuisine: 'Italian',
        ingredients: [{ ingredientId: FLOUR_ID, quantity: { kind: 'exact', value: 2 }, unit: 'cup' }],
        steps: [{ instruction: 'Simmer.' }],
        ...over,
    };
}

function principal(scopes: string[] = []): Principal {
    return {
        userId: COOK,
        sub: `test:${COOK}`,
        scopes,
        permissions: [],
        roles: [],
        principalKind: 'real',
        containment: 'enforce',
    };
}

describe('a pasted web link as the recipe source (e2e)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let service: RecipesService;

    beforeAll(async () => {
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: COOK });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = createRecipeDrizzle(pool);
        service = booted.app.get(RecipesService);
    });

    afterAll(async () => {
        await pool.end();
        await booted.close();
    });

    beforeEach(async () => {
        // Clones first: `cloned_from_id` has no cascade.
        await db.delete(recipes).where(sql`${recipes.ownerId} = ${COOK} AND ${recipes.clonedFromId} IS NOT NULL`);
        await db.delete(recipes).where(sql`${recipes.ownerId} = ${COOK}`);
    });

    async function send(
        method: string,
        path: string,
        payload?: unknown,
    ): Promise<{ status: number; json: Record<string, unknown> }> {
        const res = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { 'content-type': 'application/json' },
            ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
        const text = await res.text();

        return { status: res.status, json: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>) };
    }

    async function readRow(id: string): Promise<RecipeRow> {
        const [row] = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);

        if (!row) {
            throw new Error(`recipe ${id} not found`);
        }

        return row;
    }

    /** Create a recipe over HTTP and return its id and version. */
    async function create(over: Record<string, unknown>): Promise<{ id: string; version: number }> {
        const { status, json } = await send('POST', '/api/v1/recipes', body(over));

        expect(status).toBe(201);

        return { id: json['id'] as string, version: json['currentVersion'] as number };
    }

    it('create with a statement is a private web copy of the registrable domain', async () => {
        const { id } = await create({ statement: STATEMENT, visibility: 'private' });
        const row = await readRow(id);

        expect(row).toMatchObject({
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: LINK,
            sourceAttribution: 'allrecipes.com',
            visibility: 'private',
        });
    });

    it('returns the kind on the wire, so a client can judge the source', async () => {
        const { json } = await send('POST', '/api/v1/recipes', body({ statement: STATEMENT, visibility: 'private' }));

        expect(json).toMatchObject({ sourceKind: 'public_web', sourceType: 'imported_public' });
    });

    it('create PUBLIC with a statement is refused 400 INVALID_VISIBILITY, and nothing is written', async () => {
        const { status, json } = await send('POST', '/api/v1/recipes', body({ statement: STATEMENT }));

        expect(status).toBe(400);
        expect(json['code']).toBe('INVALID_VISIBILITY');
        expect(await db.select().from(recipes).where(eq(recipes.ownerId, COOK))).toHaveLength(0);
    });

    it('a statement together with `source` is a 400', async () => {
        const { status } = await send(
            'POST',
            '/api/v1/recipes',
            body({
                visibility: 'private',
                statement: STATEMENT,
                source: { sourceType: 'imported_public', sourceUrl: 'https://example.com/b', sourceAttribution: 'A' },
            }),
        );

        expect(status).toBe(400);
    });

    it('a caller holding the curator grant who states a link gets a web copy, never the curator reading', async () => {
        const created = await service.create(
            principal([CURATOR_IMPORT_SCOPE]),
            createRecipeRequestSchema.parse(body({ statement: STATEMENT, visibility: 'private' })),
            undefined,
        );
        const row = await readRow(created.id);

        expect(row).toMatchObject({
            sourceKind: 'public_web',
            visibility: 'private',
            sourceAttribution: 'allrecipes.com',
        });
    });

    it('PATCH a statement onto a public draft makes it private in the same write', async () => {
        const { id, version } = await create({ status: 'draft', visibility: 'public' });

        const { status } = await send('PATCH', `/api/v1/recipes/${id}`, {
            expectedVersion: version,
            statement: STATEMENT,
        });

        expect(status).toBe(200);
        expect(await readRow(id)).toMatchObject({
            visibility: 'private',
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: LINK,
        });
    });

    it('PATCH null clears the statement, back to a recipe the cook wrote', async () => {
        const { id, version } = await create({ status: 'draft', visibility: 'private', statement: STATEMENT });

        const { status } = await send('PATCH', `/api/v1/recipes/${id}`, { expectedVersion: version, statement: null });

        expect(status).toBe(200);
        expect(await readRow(id)).toMatchObject({
            sourceType: 'user_created',
            sourceKind: null,
            sourceUrl: null,
            sourceAttribution: null,
            visibility: 'private',
        });
    });

    it('after the first publish a statement is refused 403 SOURCE_LOCKED, and the source is untouched', async () => {
        const { id, version } = await create({ visibility: 'private', statement: STATEMENT });

        const { status, json } = await send('PATCH', `/api/v1/recipes/${id}`, {
            expectedVersion: version,
            statement: null,
        });

        expect(status).toBe(403);
        expect(json['code']).toBe('FORBIDDEN');
        expect((json['details'] as { reason?: string } | undefined)?.reason).toBe('SOURCE_LOCKED');
        expect(await readRow(id)).toMatchObject({ sourceKind: 'public_web', sourceUrl: LINK });
    });

    it('set-visibility public on a web copy is refused, and it stays private', async () => {
        const { id } = await create({ visibility: 'private', statement: STATEMENT });

        const { status, json } = await send('PATCH', `/api/v1/recipes/${id}/visibility`, { visibility: 'public' });

        expect(status).toBe(400);
        expect(json['code']).toBe('INVALID_VISIBILITY');
        expect((await readRow(id)).visibility).toBe('private');
    });

    it('a clone of a web copy carries the source and cannot clear it', async () => {
        const { id } = await create({ visibility: 'private', statement: STATEMENT });

        const cloned = await send('POST', `/api/v1/recipes/${id}/clone`, {});

        expect(cloned.status).toBe(201);

        const cloneId = cloned.json['id'] as string;
        const cloneRow = await readRow(cloneId);

        expect(cloneRow).toMatchObject({ sourceKind: 'public_web', sourceUrl: LINK, visibility: 'private' });

        const attempt = await send('PATCH', `/api/v1/recipes/${cloneId}`, {
            expectedVersion: cloned.json['currentVersion'],
            statement: null,
        });

        expect(attempt.status).toBe(403);
        expect((attempt.json['details'] as { reason?: string } | undefined)?.reason).toBe('SOURCE_LOCKED');
        expect(await readRow(cloneId)).toMatchObject({ sourceKind: 'public_web' });
    });
});
