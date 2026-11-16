/**
 * The statement rule (migration 0087, `statementRequiredOf`): a recipe the cook never said was theirs, whose content was
 * pasted or that has source evidence, cannot be left published AND public. The HTTP contract against a real Nest app and a
 * real PostgreSQL (`tests/globalSetup.ts`): the service role, the migrated schema, its CHECKs and the SQL twin.
 *
 * ## What only this tier can prove
 *
 * The mocked integration tier (`statementRule.integration.test.ts`) proves each route asks the rule. It cannot prove the
 * facts are READ from the database under the row lock, that `content_pasted_at` keeps its first instant across a PATCH, or
 * that a clone carries both columns. The columns are not on the wire, so the rows are read back through Drizzle.
 */
import { PUBLIC_CONFIRMATION_FOR_API_WRITERS } from '@kitchensink/recipe-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { recipes, type RecipeRow } from '../../../src/database/schema/index.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();

const COOK = '01JSTATEMENTRULECOOK00001';
/** A seeded catalog ingredient (Flour) from the baseline global setup. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';
const LINK = 'https://www.allrecipes.com/recipe/1/soup/';
const WEB = {
    kind: 'public_web',
    citation: LINK,
    wording: { version: 'statementPublicWeb.v1', locale: 'en' },
} as const;
const AUTHORED = { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } } as const;

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
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

describe('the statement rule (e2e)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;
    let db: RecipeDrizzle;

    beforeAll(async () => {
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: COOK });
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = createRecipeDrizzle(pool);
    });

    afterAll(async () => {
        await pool.end();
        await booted.close();
    });

    beforeEach(async () => {
        await db.delete(recipes).where(sql`${recipes.ownerId} = ${COOK} AND ${recipes.clonedFromId} IS NOT NULL`);
        await db.delete(recipes).where(sql`${recipes.ownerId} = ${COOK}`);
    });

    async function send(
        method: string,
        path: string,
        payload?: unknown,
    ): Promise<{ status: number; json: Record<string, unknown> }> {
        const res = await fetch(`${booted.baseUrl}${path}`, {
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

    async function create(over: Record<string, unknown>): Promise<{ id: string; version: number }> {
        const { status, json } = await send('POST', '/api/v1/recipes', body(over));

        expect(status).toBe(201);

        return { id: json['id'] as string, version: json['currentVersion'] as number };
    }

    function reasonOf(json: Record<string, unknown>): unknown {
        return (json['details'] as { reason?: string } | undefined)?.reason;
    }

    it('create pasted, no statement, Public: 400 STATEMENT_REQUIRED and nothing is written', async () => {
        const { status, json } = await send('POST', '/api/v1/recipes', body({ contentPasted: true }));

        expect(status).toBe(400);
        expect(json['code']).toBe('INVALID_VISIBILITY');
        expect(reasonOf(json)).toBe('STATEMENT_REQUIRED');
        expect(await db.select().from(recipes).where(eq(recipes.ownerId, COOK))).toHaveLength(0);
    });

    it('create pasted WITH an authored statement, Public: 201, stored as authored and pasted', async () => {
        const { id } = await create({ contentPasted: true, statement: AUTHORED });

        expect(await readRow(id)).toMatchObject({
            visibility: 'public',
            status: 'published',
            sourceType: 'user_created',
            statementKind: 'authored',
        });
        expect((await readRow(id)).contentPastedAt).toBeInstanceOf(Date);
    });

    it('create typed (no flag), no statement, Public: 201, nothing owed', async () => {
        const { id } = await create({});

        expect(await readRow(id)).toMatchObject({ visibility: 'public', statementKind: null, contentPastedAt: null });
    });

    it('create pasted, no statement, Private: 201 (Private is never refused)', async () => {
        const { id } = await create({ contentPasted: true, visibility: 'private' });

        expect(await readRow(id)).toMatchObject({ visibility: 'private', statementKind: null });
    });

    it('a published private pasted recipe: PATCH authored is 200, then set-visibility Public is 200', async () => {
        const { id, version } = await create({ contentPasted: true, visibility: 'private' });

        const patched = await send('PATCH', `/api/v1/recipes/${id}`, { expectedVersion: version, statement: AUTHORED });

        expect(patched.status).toBe(200);
        expect(await readRow(id)).toMatchObject({ statementKind: 'authored', visibility: 'private' });

        const opened = await send('PATCH', `/api/v1/recipes/${id}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(opened.status).toBe(200);
        expect(await readRow(id)).toMatchObject({ visibility: 'public' });
    });

    it('a published private pasted recipe with no statement: set-visibility Public is 400 STATEMENT_REQUIRED', async () => {
        const { id } = await create({ contentPasted: true, visibility: 'private' });

        const opened = await send('PATCH', `/api/v1/recipes/${id}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(opened.status).toBe(400);
        expect(reasonOf(opened.json)).toBe('STATEMENT_REQUIRED');
        expect(await readRow(id)).toMatchObject({ visibility: 'private' });
    });

    it('a draft that is pasted can be saved Public as a draft, but publishing it Public is refused', async () => {
        const { id, version } = await create({ contentPasted: true, status: 'draft', visibility: 'public' });

        const published = await send('PATCH', `/api/v1/recipes/${id}`, {
            expectedVersion: version,
            status: 'published',
        });

        expect(published.status).toBe(400);
        expect(reasonOf(published.json)).toBe('STATEMENT_REQUIRED');
        expect(await readRow(id)).toMatchObject({ status: 'draft' });
    });

    it('state a web source, clear it, then authored: Public is refused SOURCE_CONFLICT (the evidence stands)', async () => {
        const { id, version } = await create({ status: 'draft', visibility: 'private', statement: WEB });
        const cleared = await send('PATCH', `/api/v1/recipes/${id}`, { expectedVersion: version, statement: null });

        expect(cleared.status).toBe(200);

        const authored = await send('PATCH', `/api/v1/recipes/${id}`, {
            expectedVersion: cleared.json['currentVersion'],
            statement: AUTHORED,
        });

        expect(authored.status).toBe(200);

        const published = await send('PATCH', `/api/v1/recipes/${id}`, {
            expectedVersion: authored.json['currentVersion'],
            status: 'published',
        });

        expect(published.status).toBe(200);

        const opened = await send('PATCH', `/api/v1/recipes/${id}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(opened.status).toBe(400);
        expect(reasonOf(opened.json)).toBe('SOURCE_CONFLICT');
    });

    // Rewritten by the 2026-11-15 owner ruling (ADR-0093 section 8): this case asserted 403 SOURCE_LOCKED for clearing a
    // statement after the first publish. The cook may change it, and the evidence still keeps the recipe out of Public.
    it('after the first publish, web then "I wrote this" is written, and Public is still refused as SOURCE_CONFLICT', async () => {
        const { id, version } = await create({ visibility: 'private', statement: WEB });

        const changed = await send('PATCH', `/api/v1/recipes/${id}`, { expectedVersion: version, statement: AUTHORED });

        expect(changed.status).toBe(200);
        expect(await readRow(id)).toMatchObject({ statementKind: 'authored', sourceKind: null });

        const opened = await send('PATCH', `/api/v1/recipes/${id}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_FOR_API_WRITERS,
        });

        expect(opened.status).toBe(400);
        expect(reasonOf(opened.json)).toBe('SOURCE_CONFLICT');
        expect(await readRow(id)).toMatchObject({ visibility: 'private' });
    });

    it('after the first publish, "I wrote this" changed to a web statement forces Private and writes evidence', async () => {
        const { id, version } = await create({ statement: AUTHORED });

        expect(await readRow(id)).toMatchObject({ visibility: 'public', statementKind: 'authored' });

        const changed = await send('PATCH', `/api/v1/recipes/${id}`, { expectedVersion: version, statement: WEB });

        expect(changed.status).toBe(200);
        expect(await readRow(id)).toMatchObject({ visibility: 'private', sourceKind: 'public_web' });

        const { rows } = await pool.query<{ n: string }>(
            'SELECT count(*) AS n FROM recipe_source_evidence WHERE recipe_id = $1',
            [id],
        );

        expect(Number(rows[0]?.n)).toBe(1);
    });

    it('after the first publish, a recipe with NO statement takes a web statement with Private in one write, and keeps its evidence', async () => {
        const { id: other } = await create({ visibility: 'private' });
        const stated = await send('PATCH', `/api/v1/recipes/${other}/visibility`, {
            visibility: 'private',
            statement: WEB,
        });

        expect(stated.status).toBe(200);
        expect(await readRow(other)).toMatchObject({ sourceKind: 'public_web', visibility: 'private' });

        const { rows } = await pool.query<{ n: string }>(
            'SELECT count(*) AS n FROM recipe_source_evidence WHERE recipe_id = $1',
            [other],
        );

        expect(Number(rows[0]?.n)).toBe(1);
    });

    it('an explicit "I wrote this" makes a published private recipe public with NO separate confirmation, and records one row', async () => {
        const { id } = await create({ contentPasted: true, visibility: 'private' });
        const opened = await send('PATCH', `/api/v1/recipes/${id}/visibility`, {
            visibility: 'public',
            statement: AUTHORED,
        });

        expect(opened.status).toBe(200);

        const { rows } = await pool.query<{ choice: string; mode: string }>(
            'SELECT choice, mode FROM recipe_statement_attestations WHERE recipe_id = $1 AND action = $2',
            [id, 'setVisibility'],
        );

        expect(rows).toEqual([{ choice: 'authored', mode: 'explicit' }]);
    });

    it('content_pasted_at is never cleared by a PATCH and keeps its FIRST instant when the flag is sent again', async () => {
        const { id, version } = await create({ contentPasted: true, visibility: 'private' });
        const first = (await readRow(id)).contentPastedAt;

        expect(first).toBeInstanceOf(Date);

        const plain = await send('PATCH', `/api/v1/recipes/${id}`, { expectedVersion: version, title: 'Renamed' });

        expect(plain.status).toBe(200);
        expect((await readRow(id)).contentPastedAt).toEqual(first);

        const again = await send('PATCH', `/api/v1/recipes/${id}`, {
            expectedVersion: plain.json['currentVersion'],
            contentPasted: true,
        });

        expect(again.status).toBe(200);
        expect((await readRow(id)).contentPastedAt).toEqual(first);
    });

    it('PATCH contentPasted on a typed recipe records it, and a Public published recipe then owes the statement', async () => {
        const { id, version } = await create({});

        const flagged = await send('PATCH', `/api/v1/recipes/${id}`, { expectedVersion: version, contentPasted: true });

        expect(flagged.status).toBe(400);
        expect(reasonOf(flagged.json)).toBe('STATEMENT_REQUIRED');
        expect((await readRow(id)).contentPastedAt).toBeNull();
    });

    it('the owner reads publicNeedsStatement on the wire, and the SQL twin agrees', async () => {
        const { id } = await create({ contentPasted: true, visibility: 'private' });
        const detail = await send('GET', `/api/v1/recipes/${id}`);
        const { rows } = await pool.query<{ needs: boolean }>('SELECT recipe_needs_statement($1) AS needs', [id]);

        expect(detail.json).toMatchObject({ publicNeedsStatement: true, publicNeedsCheck: false });
        expect(rows[0]?.needs).toBe(true);
    });

    it('a clone copies statement_kind and content_pasted_at', async () => {
        const { id } = await create({ contentPasted: true, visibility: 'private', statement: AUTHORED });
        const cloned = await send('POST', `/api/v1/recipes/${id}/clone`, {});

        expect(cloned.status).toBe(201);

        const original = await readRow(id);
        const copy = await readRow(cloned.json['id'] as string);

        expect(copy.statementKind).toBe('authored');
        expect(copy.contentPastedAt).toEqual(original.contentPastedAt);
    });
});
