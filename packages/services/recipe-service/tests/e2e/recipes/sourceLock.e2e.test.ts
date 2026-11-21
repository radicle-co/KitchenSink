/**
 * The source lock (ADR-0099, plan everyAnswerSourceLock U2) against a real Nest app and a real PostgreSQL.
 *
 * ## What only this tier can prove
 *
 * The mocked integration tier (`sourceLock.integration.test.ts`) hands the service a `lockSlotFacts` double, so it cannot prove
 * that the real under-lock read SELECTS `source_confirmed_at` and `source_correction_hold`, that the database sets the
 * confirmation on EVERY first-publish path (migration 0092, qse Q-4: an import saved as published goes through the trigger and
 * the service never sets it), or that the service sets it for Make public with a statement and for no other route.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { recipes, type RecipeRow } from '../../../src/database/schema/index.js';
import { RecipesService } from '../../../src/recipes/recipes.service.js';
import { createRecipeRequestSchema } from '../../../src/recipes/recipes.schema.js';
import { resolveStatementProvenance } from '../../../src/recipes/domain/provenancePolicy.js';
import type { Principal } from '../../../src/auth/principal.js';
import { recipeDb } from '../../support/roleDb.js';
import { PUBLIC_CONFIRMATION_AS_SHOWN } from '../../../src/__fixtures__/index.js';

const roleDb = recipeDb();

const COOK = '01JSRCLOCKCOOKAAAAAAAAA01';
/** A seeded catalog ingredient (Flour) from the baseline global setup. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';
const AUTHORED = { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } } as const;

/** A minimal-but-publishable create body; `over` layers the field under test on top. */
function body(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
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

const BOOK = {
    kind: 'book',
    citation: 'Joy of Cooking, p. 12',
    wording: { version: 'statementBook.v1', locale: 'en' },
} as const;

describe('a confirmed source answer (e2e, ADR-0099)', () => {
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

    async function create(over: Record<string, unknown>): Promise<{ id: string; version: number }> {
        const { status, json } = await send('POST', '/api/v1/recipes', body(over));

        expect(status).toBe(201);

        return { id: json['id'] as string, version: json['currentVersion'] as number };
    }

    describe('who sets source_confirmed_at', () => {
        it('a draft is unconfirmed, and a PATCH that states a source on it does not confirm (AE7)', async () => {
            const { id, version } = await create({ status: 'draft', visibility: 'private' });
            const patched = await send('PATCH', `/api/v1/recipes/${id}`, { expectedVersion: version, statement: BOOK });

            expect(patched.status).toBe(200);
            expect((await readRow(id)).sourceConfirmedAt).toBeNull();
        });

        it('the first publish confirms, in the database: a published create, and a draft published by PATCH', async () => {
            const published = await create({ statement: AUTHORED });

            expect((await readRow(published.id)).sourceConfirmedAt).not.toBeNull();

            const draft = await create({ status: 'draft', visibility: 'private' });

            await send('PATCH', `/api/v1/recipes/${draft.id}`, {
                expectedVersion: draft.version,
                status: 'published',
                statement: AUTHORED,
                publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
            });

            expect((await readRow(draft.id)).sourceConfirmedAt).not.toBeNull();
        });

        it('an import saved as published confirms through the trigger alone: the service never sets it (qse Q-4)', async () => {
            const provenance = resolveStatementProvenance(BOOK);

            if (provenance === undefined) {
                throw new Error('test setup: the statement must resolve');
            }

            const saved = await service.create(
                principal(),
                createRecipeRequestSchema.parse(body({ visibility: 'private' })),
                undefined,
                { provenance, lineOrigins: [{ kind: 'cook' }] },
            );
            const row = await readRow(saved.id);

            expect(row.firstPublishedAt).not.toBeNull();
            expect(row.sourceConfirmedAt).not.toBeNull();
        });

        it('Make public with a statement on a draft confirms it, in the same write the service makes (KTD-3)', async () => {
            const { id } = await create({ status: 'draft', visibility: 'private' });
            const set = await send('PATCH', `/api/v1/recipes/${id}/visibility`, {
                visibility: 'private',
                statement: BOOK,
            });

            expect(set.status).toBe(200);
            expect((await readRow(id)).sourceConfirmedAt).not.toBeNull();
            expect(set.json['sourceConfirmed']).toBe(true);
        });
    });

    describe('the real under-lock read carries both facts', () => {
        it('a confirmed book refuses a PATCH clear and a set-visibility statement with SOURCE_LOCKED, and writes nothing', async () => {
            const { id, version } = await create({ statement: BOOK, visibility: 'private' });
            const before = await readRow(id);

            const cleared = await send('PATCH', `/api/v1/recipes/${id}`, { expectedVersion: version, statement: null });
            const changed = await send('PATCH', `/api/v1/recipes/${id}/visibility`, {
                visibility: 'private',
                statement: AUTHORED,
            });

            expect(cleared.status).toBe(403);
            expect(JSON.stringify(cleared.json)).toContain('SOURCE_LOCKED');
            expect(changed.status).toBe(403);
            expect(JSON.stringify(changed.json)).toContain('SOURCE_LOCKED');

            const after = await readRow(id);

            expect(after.sourceKind).toBe('book');
            expect(after.statementKind).toBe(before.statementKind);
            expect(after.currentVersion).toBe(before.currentVersion);
        });

        it('a confirmed own answer is downgraded to a book and is private, then locked (AE4)', async () => {
            const { id, version } = await create({ statement: AUTHORED });
            const down = await send('PATCH', `/api/v1/recipes/${id}`, { expectedVersion: version, statement: BOOK });

            expect(down.status).toBe(200);
            expect(await readRow(id)).toMatchObject({ sourceKind: 'book', visibility: 'private' });

            const back = await send('PATCH', `/api/v1/recipes/${id}`, {
                expectedVersion: (down.json['currentVersion'] as number) ?? version + 1,
                statement: AUTHORED,
            });

            expect(back.status).toBe(403);
        });

        it('a held recipe refuses Public with SOURCE_CORRECTED, and the owner detail says so (AE9)', async () => {
            const { id } = await create({ statement: AUTHORED, visibility: 'private' });

            await db.execute(sql`UPDATE recipes SET source_correction_hold = true WHERE id = ${id}`);

            const asked = await send('PATCH', `/api/v1/recipes/${id}/visibility`, {
                visibility: 'public',
                publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
            });

            expect(asked.status).toBe(400);
            expect(JSON.stringify(asked.json)).toContain('SOURCE_CORRECTED');
            expect((await readRow(id)).visibility).toBe('private');

            const detail = await send('GET', `/api/v1/recipes/${id}`);

            expect(detail.json).toMatchObject({ sourceCorrected: true, sourceConfirmed: true });
        });

        it('a held recipe is refused Public even when the database CHECK would also refuse it: the service answers first', async () => {
            const { id } = await create({ statement: AUTHORED, visibility: 'private' });

            await db.execute(sql`UPDATE recipes SET source_correction_hold = true WHERE id = ${id}`);

            const asked = await send('PATCH', `/api/v1/recipes/${id}`, {
                expectedVersion: 1,
                visibility: 'public',
                publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
            });

            expect([400, 403]).toContain(asked.status);
            expect((await readRow(id)).visibility).toBe('private');
        });
    });
});
