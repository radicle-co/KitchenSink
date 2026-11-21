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
import type { RecipesDal } from '../../../src/recipes/dal/recipes.dal.js';
import { RecipesService } from '../../../src/recipes/recipes.service.js';
import { RECIPES_DAL } from '../../../src/recipes/recipes.tokens.js';
import { CURATOR_IMPORT_SCOPE, createRecipeRequestSchema } from '../../../src/recipes/recipes.schema.js';
import { resolveStatementProvenance } from '../../../src/recipes/domain/provenancePolicy.js';
import { privateRuleOf } from '@kitchensink/recipe-core';
import type { Principal } from '../../../src/auth/principal.js';
import { recipeDb } from '../../support/roleDb.js';
import { PUBLIC_CONFIRMATION_AS_SHOWN } from '../../../src/__fixtures__/index.js';

const roleDb = recipeDb();

const COOK = '01JSRCSTATEMENTCOOKAAAAAA1';
/** A seeded catalog ingredient (Flour) from the baseline global setup. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';
const LINK = 'https://www.allrecipes.com/recipe/1/soup/';
const STATEMENT = {
    kind: 'public_web',
    citation: LINK,
    wording: { version: 'statementPublicWeb.v1', locale: 'en' },
} as const;
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

    // AE12 (#374): the paid-site statement over HTTP, through the real 0091 CHECKs. A mocked tier cannot see them refuse.
    it('create with a paid-site statement writes the editorCitation evidence and the paidSite attestation, with no address', async () => {
        const citation = 'Sam’s Subscription Kitchen, March issue';
        const { id } = await create({
            visibility: 'private',
            statement: { kind: 'paid_site', citation, wording: { version: 'statementPaidSite.v1', locale: 'en' } },
        });

        expect(await readRow(id)).toMatchObject({
            sourceType: 'imported_paid',
            sourceKind: 'paid_site',
            sourceAttribution: citation,
            sourceUrl: null,
            visibility: 'private',
        });

        const evidenceRows = await pool.query(
            'SELECT capture, source_kind, citation, source_url, source_domain FROM recipe_source_evidence WHERE recipe_id = $1',
            [id],
        );

        expect(evidenceRows.rows).toEqual([
            { capture: 'editorCitation', source_kind: 'paid_site', citation, source_url: null, source_domain: null },
        ]);

        const attestations = await pool.query(
            'SELECT choice, wording_version FROM recipe_statement_attestations WHERE recipe_id = $1',
            [id],
        );

        expect(attestations.rows).toEqual([{ choice: 'paidSite', wording_version: 'statementPaidSite.v1' }]);
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

    // Rewritten by the 2026-11-15 owner ruling (ADR-0093 section 8): this case asserted 403 SOURCE_LOCKED for clearing a
    // statement after the first publish. The statement stays editable; the evidence row stays and is never cleared.
    it('after the first publish the cook may clear the statement: 200, the source goes, and the evidence stays', async () => {
        const { id, version } = await create({ visibility: 'private', statement: STATEMENT });

        const { status } = await send('PATCH', `/api/v1/recipes/${id}`, { expectedVersion: version, statement: null });

        expect(status).toBe(200);
        expect(await readRow(id)).toMatchObject({ sourceType: 'user_created', sourceKind: null, sourceUrl: null });

        const { rows } = await pool.query<{ n: string }>(
            'SELECT count(*) AS n FROM recipe_source_evidence WHERE recipe_id = $1',
            [id],
        );

        expect(Number(rows[0]?.n)).toBe(1);
    });

    it('after the first publish, "I wrote this" changed to a web link forces Private in the same write and appends evidence', async () => {
        const { id, version } = await create({ visibility: 'public', statement: AUTHORED });

        expect(await readRow(id)).toMatchObject({ visibility: 'public', statementKind: 'authored' });

        const { status } = await send('PATCH', `/api/v1/recipes/${id}`, {
            expectedVersion: version,
            statement: STATEMENT,
        });

        expect(status).toBe(200);
        expect(await readRow(id)).toMatchObject({
            visibility: 'private',
            sourceKind: 'public_web',
            statementKind: 'source',
        });

        const { rows } = await pool.query<{ n: string }>(
            'SELECT count(*) AS n FROM recipe_source_evidence WHERE recipe_id = $1',
            [id],
        );

        expect(Number(rows[0]?.n)).toBe(1);
    });

    it('set-visibility public on a web copy is refused, and it stays private', async () => {
        const { id } = await create({ visibility: 'private', statement: STATEMENT });

        const { status, json } = await send('PATCH', `/api/v1/recipes/${id}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
        });

        expect(status).toBe(400);
        expect(json['code']).toBe('INVALID_VISIBILITY');
        expect((await readRow(id)).visibility).toBe('private');
    });

    it('the row lock set-visibility decides on reads the source the row holds NOW, not only its slot facts', async () => {
        // Set-visibility judges the source read under this lock (ADR-0089), so a link stated after its first read counts.
        const { id, version } = await create({ status: 'draft', visibility: 'private' });
        await send('PATCH', `/api/v1/recipes/${id}`, { expectedVersion: version, statement: STATEMENT });
        const dal = booted.app.get<RecipesDal>(RECIPES_DAL);

        const facts = await dal.transaction(async (tx) => dal.lockSlotFacts(tx, id));

        expect(facts).toEqual({
            visibility: 'private',
            status: 'draft',
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            // 0087: the statement facts the rule judges under the same lock. A stated web copy is `source`; nothing was pasted.
            statementKind: 'source',
            contentPastedAt: null,
            // Never a clone: the one fact besides the source the lock reads for the source-correction rule. The first publish is
            // not read (owner ruling 2026-11-15).
            clonedFromId: null,
            // The citation a paid site stated again is judged against; a web copy's is its site.
            sourceAttribution: 'allrecipes.com',
        });
    });

    // The bulk import saves through `RecipesService.create` with the provenance its statement resolved to (ADR-0072 section 9,
    // ADR-0089). A web statement must be a web copy in the database, so it can never be saved public and never reads as the
    // curator's public-domain text.
    describe('a bulk import’s public_web item', () => {
        const importedFor = (statement: Parameters<typeof resolveStatementProvenance>[0]) => {
            const provenance = resolveStatementProvenance(statement);

            if (provenance === undefined) {
                throw new Error('test setup: the statement must resolve');
            }

            return { provenance, lineOrigins: [{ kind: 'cook' }] } as const;
        };

        it('asked for PUBLIC is refused, and no row is written', async () => {
            await expect(
                service.create(
                    principal(),
                    createRecipeRequestSchema.parse(body({ visibility: 'public' })),
                    undefined,
                    importedFor(STATEMENT),
                ),
            ).rejects.toMatchObject({ code: 'INVALID_VISIBILITY' });
            expect(await db.select().from(recipes).where(eq(recipes.ownerId, COOK))).toHaveLength(0);
        });

        it('saved PRIVATE stores the kind in the database and reads back as a web copy, never public domain', async () => {
            const saved = await service.create(
                principal(),
                createRecipeRequestSchema.parse(body({ visibility: 'private', status: 'draft' })),
                undefined,
                importedFor(STATEMENT),
            );

            expect(await readRow(saved.id)).toMatchObject({
                visibility: 'private',
                sourceType: 'imported_public',
                sourceKind: 'public_web',
                sourceUrl: LINK,
            });

            const read = await send('GET', `/api/v1/recipes/${saved.id}`);

            // The read path carries the kind, so no client treats this `imported_public` as the curator's text.
            expect(read.json).toMatchObject({ sourceType: 'imported_public', sourceKind: 'public_web' });
            expect(privateRuleOf('imported_public', read.json['sourceKind'] as 'public_web')).toBe('privateOnly');
        });

        it('every statement form resolves to a row the 0071 CHECK accepts', async () => {
            for (const statement of [
                STATEMENT,
                { kind: 'book', citation: 'Joy of Cooking, p. 12' },
                { kind: 'paid_site', citation: 'A paid site' },
            ] as const) {
                const saved = await service.create(
                    principal(),
                    createRecipeRequestSchema.parse(body({ visibility: 'private', status: 'draft' })),
                    undefined,
                    importedFor(statement),
                );

                expect((await readRow(saved.id)).sourceKind).toBe(statement.kind);
            }
        });
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

    /**
     * THE EVIDENCE RULE (migration 0086, `sourceConflictOf`): a recipe that EVER had a third-party source stated may not be
     * Public, even after the cook clears the statement. Until it existed, "PATCH statement: null" resolved to `user_created`
     * and the recipe could be published Public as the cook's own work, which is the defect these tests pin. Every test below
     * runs over HTTP against the real database, so the evidence row, the append-only guard and the clone trigger are real.
     */
    describe('the evidence rule: a cleared source does not make a copied recipe the cook’s own work', () => {
        async function evidenceOf(
            id: string,
        ): Promise<Array<{ capture: string; source_kind: string; source_domain: string | null }>> {
            const { rows } = await pool.query<{ capture: string; source_kind: string; source_domain: string | null }>(
                `SELECT capture, source_kind, source_domain FROM recipe_source_evidence WHERE recipe_id = $1 ORDER BY recorded_at`,
                [id],
            );

            return rows;
        }

        /** A private draft that states a web source, then clears it: the recipe reads as the cook's own. */
        async function clearedDraft(): Promise<{ id: string; version: number }> {
            const { id, version } = await create({ status: 'draft', visibility: 'private', statement: STATEMENT });
            const cleared = await send('PATCH', `/api/v1/recipes/${id}`, { expectedVersion: version, statement: null });

            expect(cleared.status).toBe(200);
            expect(await readRow(id)).toMatchObject({ sourceType: 'user_created', sourceKind: null, sourceUrl: null });

            return { id, version: cleared.json['currentVersion'] as number };
        }

        function expectSourceConflict(result: { status: number; json: Record<string, unknown> }): void {
            expect(result.status).toBe(400);
            expect(result.json['code']).toBe('INVALID_VISIBILITY');
            expect((result.json['details'] as { reason?: string } | undefined)?.reason).toBe('SOURCE_CONFLICT');
        }

        it('create with a statement appends one editorLink evidence row, and a clear appends nothing and removes nothing', async () => {
            const { id } = await clearedDraft();

            expect(await evidenceOf(id)).toEqual([
                { capture: 'editorLink', source_kind: 'public_web', source_domain: 'allrecipes.com' },
            ]);
        });

        it('a web statement with NO wording (the Source row) appends the evidence row and writes no attestation; with a wording it writes one', async () => {
            const { wording: _none, ...wordless } = STATEMENT;
            const attestationsOf = async (
                id: string,
            ): Promise<Array<{ choice: string; wording_version: string | null }>> =>
                (
                    await pool.query<{ choice: string; wording_version: string | null }>(
                        `SELECT choice, wording_version FROM recipe_statement_attestations WHERE recipe_id = $1 ORDER BY recorded_at`,
                        [id],
                    )
                ).rows;
            const bare = await create({ status: 'draft', visibility: 'private', statement: wordless });
            const worded = await create({ status: 'draft', visibility: 'private', statement: STATEMENT });

            expect(await evidenceOf(bare.id)).toEqual([
                { capture: 'editorLink', source_kind: 'public_web', source_domain: 'allrecipes.com' },
            ]);
            expect(await attestationsOf(bare.id)).toEqual([]);
            expect(await attestationsOf(worded.id)).toEqual([
                { choice: 'publicWeb', wording_version: 'statementPublicWeb.v1' },
            ]);
        });

        it('PATCH that applies a statement appends an editorLink evidence row', async () => {
            const { id, version } = await create({ status: 'draft', visibility: 'private' });

            expect(await evidenceOf(id)).toEqual([]);

            await send('PATCH', `/api/v1/recipes/${id}`, { expectedVersion: version, statement: STATEMENT });

            expect(await evidenceOf(id)).toEqual([
                { capture: 'editorLink', source_kind: 'public_web', source_domain: 'allrecipes.com' },
            ]);
        });

        it('THE NAMED PATH: state a source, clear it, publish, then ask for Public: 400 SOURCE_CONFLICT, and it stays private', async () => {
            const { id, version } = await clearedDraft();
            const published = await send('PATCH', `/api/v1/recipes/${id}`, {
                expectedVersion: version,
                status: 'published',
            });

            expect(published.status).toBe(200);

            expectSourceConflict(
                await send('PATCH', `/api/v1/recipes/${id}/visibility`, {
                    visibility: 'public',
                    publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
                }),
            );
            expect(await readRow(id)).toMatchObject({ visibility: 'private', status: 'published' });
        });

        it('refuses Public on the DRAFT too: the same set-visibility, before any publish', async () => {
            const { id } = await clearedDraft();

            expectSourceConflict(
                await send('PATCH', `/api/v1/recipes/${id}/visibility`, {
                    visibility: 'public',
                    publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
                }),
            );
        });

        it('refuses to PUBLISH a draft that raced to public, and leaves it a draft', async () => {
            const { id, version } = await clearedDraft();
            // The race the publish-time judgement exists for: the draft is public by a path set-visibility did not judge.
            await roleDb.asOwner((client) =>
                client.query(`UPDATE recipes SET visibility = 'public' WHERE id = $1`, [id]),
            );

            expectSourceConflict(
                await send('PATCH', `/api/v1/recipes/${id}`, {
                    expectedVersion: version,
                    status: 'published',
                    publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
                }),
            );
            expect(await readRow(id)).toMatchObject({ status: 'draft' });
        });

        it('never refuses Private: the same recipe can be made private again and published private', async () => {
            const { id, version } = await clearedDraft();
            const published = await send('PATCH', `/api/v1/recipes/${id}`, {
                expectedVersion: version,
                status: 'published',
            });
            const again = await send('PATCH', `/api/v1/recipes/${id}/visibility`, { visibility: 'private' });

            expect(published.status).toBe(200);
            expect(again.status).toBe(200);
        });

        it('the CLONE of such a recipe inherits the evidence, lands private, and cannot be made public either', async () => {
            const { id, version } = await clearedDraft();
            await send('PATCH', `/api/v1/recipes/${id}`, {
                expectedVersion: version,
                status: 'published',
                publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
            });

            const cloned = await send('POST', `/api/v1/recipes/${id}/clone`, {});
            const cloneId = cloned.json['id'] as string;

            expect(cloned.status).toBe(201);
            expect((await readRow(cloneId)).visibility).toBe('private');
            expect(await evidenceOf(cloneId)).toEqual([
                { capture: 'editorLink', source_kind: 'public_web', source_domain: 'allrecipes.com' },
            ]);
            expectSourceConflict(
                await send('PATCH', `/api/v1/recipes/${cloneId}/visibility`, {
                    visibility: 'public',
                    publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
                }),
            );
        });

        it('CONTROL: a recipe that never had a source can be made Public, and its clone defaults Public', async () => {
            const { id } = await create({ status: 'published', visibility: 'private' });

            const asked = await send('PATCH', `/api/v1/recipes/${id}/visibility`, {
                visibility: 'public',
                publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
            });
            const cloned = await send('POST', `/api/v1/recipes/${id}/clone`, {});

            expect(asked.status).toBe(200);
            expect(cloned.status).toBe(201);
            expect((await readRow(cloned.json['id'] as string)).visibility).toBe('public');
            expect(await evidenceOf(id)).toEqual([]);
        });

        it('the import save writes importFile evidence, in the create’s transaction, for a book', async () => {
            const provenance = resolveStatementProvenance({ kind: 'book', citation: 'Joy of Cooking' });

            if (provenance === undefined) {
                throw new Error('test setup: the statement must resolve');
            }

            const saved = await service.create(
                principal(),
                createRecipeRequestSchema.parse(body({ status: 'draft', visibility: 'private' })),
                undefined,
                { provenance, lineOrigins: [{ kind: 'cook' }] },
            );

            expect(await evidenceOf(saved.id)).toEqual([
                { capture: 'importFile', source_kind: 'book', source_domain: null },
            ]);
        });
    });
});
