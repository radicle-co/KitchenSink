/**
 * The staff source correction (ADR-0099, plan everyAnswerSourceLock U3) against a real Nest app and a real PostgreSQL.
 *
 * ## What only this tier can prove
 *
 * The mocked tiers hand the service a DAL double, so they cannot prove that the rewrite, the evidence, the record and the clone
 * walk really land in the rows, that the recursive walk reaches a clone of a clone and leaves another cook's copy alone, that no
 * version is bumped, that the database CHECK and the clone trigger agree with the service about the hold, or that the policy's
 * Public refusal is what a cook meets over HTTP afterwards.
 *
 * The grant is a SIGNED claim the dev-auth bypass cannot express, so the staff call goes through the container (the service, the
 * policy, the DAL, the transaction and the database stay in the path), and the DENIAL is driven over HTTP as the cook, which is
 * the real ungranted principal (`declaredProvenance.e2e.test.ts` is the same split).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import {
    recipeSourceCorrections,
    recipeSourceEvidence,
    recipes,
    type RecipeRow,
} from '../../../src/database/schema/index.js';
import { SourceCorrectionService } from '../../../src/recipes/sourceCorrection.service.js';
import { SOURCE_CORRECT_SCOPE, type SourceCorrectionRequest } from '../../../src/recipes/recipes.schema.js';
import type { Principal } from '../../../src/auth/principal.js';
import { asPrincipal } from '../../support/asPrincipal.js';
import { recipeDb } from '../../support/roleDb.js';
import { PUBLIC_CONFIRMATION_AS_SHOWN } from '../../../src/__fixtures__/index.js';

const roleDb = recipeDb();

const COOK = '01JSRCCORRCOOKAAAAAAAAA01';
const OTHER_COOK = '01JSRCCORROTHERAAAAAAAAA1';
const STAFF = '01JSRCCORRSTAFFAAAAAAAAA1';
/** A seeded catalog ingredient (Flour) from the baseline global setup. */
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';
const LINK = 'https://www.allrecipes.com/recipe/1/soup/';
const AUTHORED = { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } } as const;
const FROM_PERSON = { kind: 'fromPerson', wording: { version: 'statementFromPerson.v1', locale: 'en' } } as const;
const PAID = {
    kind: 'paid_site',
    citation: 'Sam’s Subscription Kitchen',
    wording: { version: 'statementPaidSite.v1', locale: 'en' },
} as const;
const WEB = { kind: 'public_web', citation: LINK } as const;

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

function staff(scopes: string[] = [SOURCE_CORRECT_SCOPE]): Principal {
    return {
        userId: STAFF,
        sub: `test:${STAFF}`,
        scopes,
        permissions: [],
        roles: [],
        principalKind: 'real',
        containment: 'enforce',
    };
}

function correction(answer: SourceCorrectionRequest['answer'], owner = COOK): SourceCorrectionRequest {
    return {
        ownerAccountId: owner,
        answer,
        ground: 'ownerConfirmedByAccountEmail',
        reason: 'Owner asked by email; mailbox challenge passed.',
    };
}

describe('a staff source correction (e2e, ADR-0099)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let service: SourceCorrectionService;

    beforeAll(async () => {
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: COOK });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = createRecipeDrizzle(pool);
        service = booted.app.get(SourceCorrectionService);
    });

    afterAll(async () => {
        await pool.end();
        await booted.close();
    });

    beforeEach(async () => {
        // Both cooks in one statement each: the clones refer across owners and at depth, and a statement checks its foreign keys last.
        await db
            .delete(recipes)
            .where(sql`${recipes.ownerId} IN (${COOK}, ${OTHER_COOK}) AND ${recipes.clonedFromId} IS NOT NULL`);
        await db.delete(recipes).where(sql`${recipes.ownerId} IN (${COOK}, ${OTHER_COOK})`);
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

    async function create(over: Record<string, unknown>): Promise<string> {
        const { status, json } = await send('POST', '/api/v1/recipes', body(over));

        expect(status).toBe(201);

        return json['id'] as string;
    }

    /** A clone made by `cloner` through the route (private, as every clone starts), then made public in the row when asked. */
    async function cloneOf(id: string, cloner: string, makePublic: boolean): Promise<string> {
        const cloned = await asPrincipal(cloner, () => send('POST', `/api/v1/recipes/${id}/clone`, {}));

        expect(cloned.status).toBe(201);

        const cloneId = cloned.json['id'] as string;

        if (makePublic) {
            await db.execute(sql`UPDATE recipes SET visibility = 'public', status = 'published' WHERE id = ${cloneId}`);
        }

        return cloneId;
    }

    async function askPublic(id: string): Promise<{ status: number; json: Record<string, unknown> }> {
        return send('PATCH', `/api/v1/recipes/${id}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
        });
    }

    async function recordsOf(id: string) {
        return db.select().from(recipeSourceCorrections).where(eq(recipeSourceCorrections.recipeId, id));
    }

    it('AE8 and AE26: own to a web page is private and UNHELD, appends evidence, bumps no version, and holds the owner’s clones at any depth but not another cook’s copy', async () => {
        const id = await create({ statement: AUTHORED, visibility: 'public' });
        const versionBefore = (await readRow(id)).currentVersion;
        const ownerClone = await cloneOf(id, COOK, true);
        const cloneOfClone = await cloneOf(ownerClone, COOK, true);
        const othersClone = await cloneOf(id, OTHER_COOK, true);

        const result = await service.correct(staff(), id, correction(WEB));

        expect(result).toEqual({ result: 'applied' });

        const after = await readRow(id);

        expect(after).toMatchObject({
            visibility: 'private',
            sourceCorrectionHold: false,
            sourceKind: 'public_web',
            sourceUrl: LINK,
            currentVersion: versionBefore,
        });
        expect(after.sourceConfirmedAt).not.toBeNull();

        const evidence = await db.select().from(recipeSourceEvidence).where(eq(recipeSourceEvidence.recipeId, id));

        expect(evidence).toHaveLength(1);
        expect(evidence[0]).toMatchObject({ capture: 'staffCorrection', sourceKind: 'public_web', sourceUrl: LINK });

        const records = await recordsOf(id);

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            actorAccountId: STAFF,
            oldStatementKind: 'authored',
            newSourceKind: 'public_web',
            newSourceUrl: LINK,
            ground: 'ownerConfirmedByAccountEmail',
        });

        for (const cloneId of [ownerClone, cloneOfClone]) {
            expect(await readRow(cloneId)).toMatchObject({ visibility: 'private', sourceCorrectionHold: true });
        }

        // Another cook's copy is theirs: still public and unheld.
        expect(await readRow(othersClone)).toMatchObject({ visibility: 'public', sourceCorrectionHold: false });
    });

    it('AE26: a clone of ANOTHER cook’s clone of the corrected recipe is still held, and the other cook’s clone is untouched', async () => {
        const id = await create({ statement: AUTHORED, visibility: 'public' });
        const othersClone = await cloneOf(id, OTHER_COOK, true);
        const ownerCloneOfOthers = await cloneOf(othersClone, COOK, true);

        await service.correct(staff(), id, correction(WEB));

        expect(await readRow(ownerCloneOfOthers)).toMatchObject({ visibility: 'private', sourceCorrectionHold: true });
        expect(await readRow(othersClone)).toMatchObject({ visibility: 'public', sourceCorrectionHold: false });
    });

    it('AE9: a web page corrected to "I wrote this" is held, and Public is refused SOURCE_CORRECTED over HTTP', async () => {
        const id = await create({ statement: WEB, visibility: 'private' });

        await service.correct(staff(), id, correction({ kind: 'authored' }));

        expect(await readRow(id)).toMatchObject({ sourceCorrectionHold: true, visibility: 'private' });

        const asked = await askPublic(id);

        // Refused. The reason is the evidence rule's (SOURCE_CONFLICT: the web page is still on record and answers first); the hold is
        // the backstop that outlives it. The hold's OWN reason is asserted where no evidence answers first (AE21 below).
        expect(asked.status).toBe(400);
        expect(JSON.stringify(asked.json)).toContain('INVALID_VISIBILITY');
        expect((await readRow(id)).visibility).toBe('private');
        // "I wrote this" leaves no evidence of a third party: nothing was appended.
        expect(await db.select().from(recipeSourceEvidence).where(eq(recipeSourceEvidence.recipeId, id))).toHaveLength(
            1,
        );
    });

    it('AE17: a paid site corrected to a web page is held (the paid evidence stays, so the hold is the only guard)', async () => {
        const id = await create({ statement: PAID, visibility: 'private' });

        await service.correct(staff(), id, correction(WEB));

        expect(await readRow(id)).toMatchObject({
            sourceCorrectionHold: true,
            visibility: 'private',
            sourceKind: 'public_web',
        });

        const evidence = await db.select().from(recipeSourceEvidence).where(eq(recipeSourceEvidence.recipeId, id));

        expect(evidence.map((row) => row.capture).sort()).toEqual(['editorCitation', 'staffCorrection']);
    });

    it('AE21 and AE25: from another person corrected to "I wrote this" is held; the owner’s clone of it is held too and refused Public', async () => {
        const id = await create({ statement: FROM_PERSON, visibility: 'private' });

        await service.correct(staff(), id, correction({ kind: 'authored' }));

        expect(await readRow(id)).toMatchObject({ sourceCorrectionHold: true, visibility: 'private' });
        expect(JSON.stringify((await askPublic(id)).json)).toContain('SOURCE_CORRECTED');

        const cloneId = await cloneOf(id, COOK, false);

        expect(await readRow(cloneId)).toMatchObject({ sourceCorrectionHold: true, visibility: 'private' });

        const asked = await askPublic(cloneId);

        expect(asked.status).toBe(400);
        expect(JSON.stringify(asked.json)).toContain('SOURCE_CORRECTED');
    });

    it('a restatement is unchanged: no second record, no new evidence, nothing held', async () => {
        const id = await create({ statement: WEB, visibility: 'private' });

        const first = await service.correct(staff(), id, correction({ kind: 'book', citation: 'Joy of Cooking' }));
        const second = await service.correct(staff(), id, correction({ kind: 'book', citation: 'Joy of Cooking' }));

        expect(first).toEqual({ result: 'applied' });
        expect(second).toEqual({ result: 'unchanged' });
        expect(await recordsOf(id)).toHaveLength(1);
        expect((await readRow(id)).sourceCorrectionHold).toBe(false);
    });

    it('the cook, who holds no grant, is refused 403 over HTTP, and the recipe is untouched', async () => {
        const id = await create({ statement: AUTHORED, visibility: 'private' });

        const refused = await send('POST', `/api/v1/recipes/${id}/source-correction`, correction(WEB));

        expect(refused.status).toBe(403);
        expect(JSON.stringify(refused.json)).toContain(SOURCE_CORRECT_SCOPE);
        expect(await readRow(id)).toMatchObject({ statementKind: 'authored', sourceCorrectionHold: false });
        expect(await recordsOf(id)).toHaveLength(0);
    });

    it('a recipe of another owner answers as a missing one, and nothing is written', async () => {
        const id = await create({ statement: AUTHORED, visibility: 'private' });

        await expect(service.correct(staff(), id, correction(WEB, OTHER_COOK))).rejects.toMatchObject({
            code: 'RECIPE_NOT_FOUND',
        });
        expect(await recordsOf(id)).toHaveLength(0);
        expect((await readRow(id)).statementKind).toBe('authored');
    });
});
