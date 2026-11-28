/**
 * The two ways back from a correction hold (ADR-0106, plan pr5HoldClear U3/U4) against a real Nest app and a real PostgreSQL.
 *
 * ## What only this tier can prove
 *
 * That the chain query, the clone walk, the locks, the record and the ratchet agree on real rows: that a staff clear releases the
 * right clones and leaves the others held, that the earned clear refuses without writing, that the preview's id is the one the
 * clear accepts, and that a cleared recipe is readable by another cook again while a held one is not.
 *
 * The grant is a SIGNED claim the dev-auth bypass cannot express, so staff calls go through the container (service, policy,
 * DAL, transaction and database stay in the path), as `sourceCorrection.e2e.test.ts` does.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { recipeSourceHoldClears, recipes, type RecipeRow } from '../../../src/database/schema/index.js';
import { SourceCorrectionService } from '../../../src/recipes/sourceCorrection.service.js';
import { SourceHoldClearService } from '../../../src/recipes/sourceHoldClear.service.js';
import {
    SOURCE_CORRECT_SCOPE,
    type SourceCorrectionRequest,
    type SourceHoldClearRequest,
} from '../../../src/recipes/recipes.schema.js';
import type { Principal } from '../../../src/auth/principal.js';
import { asPrincipal } from '../../support/asPrincipal.js';
import { recipeDb } from '../../support/roleDb.js';
import { PUBLIC_CONFIRMATION_AS_SHOWN } from '../../../src/__fixtures__/index.js';

const roleDb = recipeDb();

const COOK = '01JHOLDCLRCOOKAAAAAAAAA01';
const OTHER_COOK = '01JHOLDCLROTHERAAAAAAAAA1';
const STAFF = '01JHOLDCLRSTAFFAAAAAAAAA1';
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';
const LINK = 'https://www.allrecipes.com/recipe/1/soup/';
const AUTHORED = { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } } as const;
const PAID = {
    kind: 'paid_site',
    citation: 'Sam’s Subscription Kitchen',
    wording: { version: 'statementPaidSite.v1', locale: 'en' },
} as const;
const WEB = { kind: 'public_web', citation: LINK } as const;
const BOOK = { kind: 'book', citation: 'Joy of Cooking' } as const;

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

const correction = (answer: SourceCorrectionRequest['answer']): SourceCorrectionRequest => ({
    ownerAccountId: COOK,
    answer,
    ground: 'ownerConfirmedByAccountEmail',
    reason: 'Owner asked by email; mailbox challenge passed.',
});

describe('a correction hold clear (e2e, ADR-0106)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let corrections: SourceCorrectionService;
    let clears: SourceHoldClearService;

    beforeAll(async () => {
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: COOK });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = createRecipeDrizzle(pool);
        corrections = booted.app.get(SourceCorrectionService);
        clears = booted.app.get(SourceHoldClearService);
    });

    afterAll(async () => {
        await pool.end();
        await booted.close();
    });

    beforeEach(async () => {
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

        expect(row, `recipe ${id} not found`).toBeDefined();

        return row;
    }

    async function create(over: Record<string, unknown>): Promise<string> {
        const { status, json } = await send('POST', '/api/v1/recipes', body(over));

        expect(status).toBe(201);

        return json['id'] as string;
    }

    async function cloneOf(id: string, cloner: string): Promise<string> {
        const cloned = await asPrincipal(cloner, () => send('POST', `/api/v1/recipes/${id}/clone`, {}));

        expect(cloned.status).toBe(201);

        return cloned.json['id'] as string;
    }

    async function insertClone(parent: string, owner: string): Promise<string> {
        const id = randomUUID();

        await db.execute(sql`
            INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes, total_time_minutes,
                                 servings, visibility, status, source_type, cloned_from_id)
            VALUES (${id}::uuid, ${owner}, 'Clone', '', 1, 1, 2, 4, 'private', 'draft', 'user_created', ${parent}::uuid)`);

        return id;
    }

    const recordsOf = (id: string) =>
        db.select().from(recipeSourceHoldClears).where(eq(recipeSourceHoldClears.recipeId, id));

    async function previewId(id: string): Promise<string | null> {
        return (await corrections.preview(staff(), id, COOK)).latestCorrectionId;
    }

    async function clearRequest(
        id: string,
        over: Partial<SourceHoldClearRequest> = {},
    ): Promise<SourceHoldClearRequest> {
        return { ownerAccountId: COOK, correctionId: await previewId(id), reason: 'A mistaken correction.', ...over };
    }

    /** A recipe held by a mistaken correction to an OWN answer: created as own, corrected to a web page, then back to own. */
    async function mistakenOwn(): Promise<string> {
        const id = await create({ statement: AUTHORED, visibility: 'private' });

        await corrections.correct(staff(), id, correction(WEB));
        await corrections.correct(staff(), id, correction({ kind: 'authored' }));
        expect((await readRow(id)).sourceCorrectionHold).toBe(true);

        return id;
    }

    /** A recipe held by a paid-site-to-book correction: every row in its chain is third-party. */
    async function paidToBook(): Promise<string> {
        const id = await create({ statement: PAID, visibility: 'private' });

        await corrections.correct(staff(), id, correction(BOOK));
        expect((await readRow(id)).sourceCorrectionHold).toBe(true);

        return id;
    }

    async function readableBy(reader: string, id: string): Promise<number> {
        return (await asPrincipal(reader, () => send('GET', `/api/v1/recipes/${id}`))).status;
    }

    it('AE1: a staff clear of a mistaken own correction lets another cook read the public recipe, and writes one staff record', async () => {
        const id = await mistakenOwn();

        await db.execute(sql`UPDATE recipes SET visibility = 'public', status = 'published' WHERE id = ${id}`);
        expect(await readableBy(OTHER_COOK, id)).toBe(404);

        await expect(clears.clearByStaff(staff(), id, await clearRequest(id))).resolves.toEqual({
            result: 'cleared',
            released: 1,
        });

        expect((await readRow(id)).sourceCorrectionHold).toBe(false);
        expect(await readableBy(OTHER_COOK, id)).toBe(200);

        const records = await recordsOf(id);

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            cause: 'staff',
            actorAccountId: STAFF,
            reason: 'A mistaken correction.',
        });
    });

    it('never puts the clear table in a reader or cook response', async () => {
        const id = await mistakenOwn();

        await clears.clearByStaff(staff(), id, await clearRequest(id));

        for (const reader of [COOK, OTHER_COOK]) {
            const text = JSON.stringify((await asPrincipal(reader, () => send('GET', `/api/v1/recipes/${id}`))).json);

            expect(text).not.toMatch(/hold_clear|holdClear|xact_id|xactId|mistaken correction/i);
        }
    });

    it('a staff clear does not make the recipe public, and a later non-authored correction does not bring the hold back', async () => {
        const id = await mistakenOwn();

        await clears.clearByStaff(staff(), id, await clearRequest(id));

        expect((await readRow(id)).visibility).toBe('private');

        await corrections.correct(staff(), id, correction(WEB));

        expect((await readRow(id)).sourceCorrectionHold).toBe(false);
    });

    it('the preview id is accepted by the clear: two own corrections (the newest wins), and a clone with no row (the ancestor’s newest)', async () => {
        const id = await mistakenOwn();
        const clone = await cloneOf(id, COOK);
        const newest = await previewId(id);

        expect(newest).not.toBeNull();
        expect(await previewId(clone)).toBe(newest);
        // The newest row is the second correction, not the first.
        const rows = await db.execute<{ id: string }>(
            sql`SELECT id FROM recipe_source_corrections WHERE recipe_id = ${id} ORDER BY recorded_at DESC, id DESC`,
        );

        expect(rows.rows[0]?.id).toBe(newest);
        expect(rows.rows).toHaveLength(2);
        await expect(clears.clearByStaff(staff(), clone, await clearRequest(clone))).resolves.toMatchObject({
            result: 'cleared',
        });
    });

    it('refuses a stale correction id with CORRECTION_NOT_LATEST and writes nothing', async () => {
        const id = await mistakenOwn();
        const stale = await clearRequest(id);

        await corrections.correct(staff(), id, correction(BOOK));

        await expect(clears.clearByStaff(staff(), id, stale)).rejects.toMatchObject({
            code: 'HOLD_CLEAR_CONFLICT',
            details: { reason: 'CORRECTION_NOT_LATEST' },
        });
        expect(await recordsOf(id)).toHaveLength(0);
    });

    it('refuses a recipe that is not held with HOLD_NOT_SET and writes no record', async () => {
        const id = await create({ statement: AUTHORED, visibility: 'private' });

        await expect(
            clears.clearByStaff(staff(), id, { ownerAccountId: COOK, correctionId: null, reason: 'why' }),
        ).rejects.toMatchObject({ code: 'HOLD_CLEAR_CONFLICT', details: { reason: 'HOLD_NOT_SET' } });
        expect(await recordsOf(id)).toHaveLength(0);
    });

    it('a wrong ownerAccountId is one RECIPE_NOT_FOUND, with the hold unchanged and no record', async () => {
        const id = await mistakenOwn();

        await expect(
            clears.clearByStaff(staff(), id, { ...(await clearRequest(id)), ownerAccountId: OTHER_COOK }),
        ).rejects.toMatchObject({ code: 'RECIPE_NOT_FOUND' });
        expect((await readRow(id)).sourceCorrectionHold).toBe(true);
        expect(await recordsOf(id)).toHaveLength(0);
    });

    it('a caller without the grant is refused before the database, and nothing changes', async () => {
        const id = await mistakenOwn();

        await expect(clears.clearByStaff(staff([]), id, await clearRequest(id))).rejects.toMatchObject({ status: 403 });
        expect((await readRow(id)).sourceCorrectionHold).toBe(true);
    });

    it('correctionId null clears a held recipe whose chain has no row (broken chain), and refuses null when a row exists', async () => {
        const broken = await create({ statement: AUTHORED, visibility: 'private' });

        await db.execute(sql`UPDATE recipes SET source_correction_hold = true WHERE id = ${broken}`);
        await expect(
            clears.clearByStaff(staff(), broken, { ownerAccountId: COOK, correctionId: null, reason: 'why' }),
        ).resolves.toMatchObject({ result: 'cleared' });

        const held = await mistakenOwn();

        await expect(
            clears.clearByStaff(staff(), held, { ownerAccountId: COOK, correctionId: null, reason: 'why' }),
        ).rejects.toMatchObject({ details: { reason: 'CORRECTION_NOT_LATEST' } });
    });

    describe('the clone walk (AE6)', () => {
        it('releases the same-correction clone and its grandchild; keeps a clone with its own row and everything below it; writes one record each', async () => {
            const root = await paidToBook();
            const clone = await cloneOf(root, COOK);
            const grandchild = await cloneOf(clone, COOK);
            const ownRowClone = await cloneOf(root, COOK);
            const belowOwnRow = await cloneOf(ownRowClone, COOK);

            await corrections.correct(staff(), root, correction(BOOK));
            // Hold the clones (the correction above restated the answer, so hold them as the first correction did).
            await db.execute(
                sql`UPDATE recipes SET source_correction_hold = true WHERE id IN (${sql.join(
                    [clone, grandchild, ownRowClone, belowOwnRow].map((id) => sql`${id}::uuid`),
                    sql`, `,
                )})`,
            );
            await corrections.correct(staff(), ownRowClone, correction(WEB));

            const request = await clearRequest(root);

            await expect(clears.clearByStaff(staff(), root, request)).resolves.toEqual({
                result: 'cleared',
                released: 3,
            });

            for (const id of [root, clone, grandchild]) {
                expect((await readRow(id)).sourceCorrectionHold).toBe(false);
                expect(await recordsOf(id)).toHaveLength(1);
            }

            for (const id of [ownRowClone, belowOwnRow]) {
                expect((await readRow(id)).sourceCorrectionHold).toBe(true);
                expect(await recordsOf(id)).toHaveLength(0);
            }
        });

        it('keeps another cook’s HELD clone and the same-owner grandchild below it; releases the grandchild below an UNHELD other-owner clone', async () => {
            const root = await create({ statement: PAID, visibility: 'private' });
            // Rows are inserted directly, before the correction: a clone made after it would inherit the hold.
            const heldOther = await insertClone(root, OTHER_COOK);
            const belowHeldOther = await insertClone(heldOther, COOK);
            const unheldOther = await insertClone(root, OTHER_COOK);
            const belowUnheldOther = await insertClone(unheldOther, COOK);

            await corrections.correct(staff(), root, correction(BOOK));
            // The correction holds only the owner's clones; another cook's clone is held by hand.
            await db.execute(sql`UPDATE recipes SET source_correction_hold = true WHERE id = ${heldOther}::uuid`);
            expect((await readRow(unheldOther)).sourceCorrectionHold).toBe(false);
            expect((await readRow(belowUnheldOther)).sourceCorrectionHold).toBe(true);

            await clears.clearByStaff(staff(), root, await clearRequest(root));

            expect((await readRow(heldOther)).sourceCorrectionHold).toBe(true);
            expect((await readRow(belowHeldOther)).sourceCorrectionHold).toBe(true);
            expect((await readRow(belowUnheldOther)).sourceCorrectionHold).toBe(false);
        });

        it('a clone made after the clear starts unheld', async () => {
            const root = await paidToBook();

            await clears.clearByStaff(staff(), root, await clearRequest(root));

            expect((await readRow(await cloneOf(root, COOK))).sourceCorrectionHold).toBe(false);
        });
    });

    describe('the earned clear (AE2a, AE3)', () => {
        const earned = (id: string) => db.transaction((tx) => clears.clearByEarnedRewrite(tx, id));

        it('clears a paid-site-to-book recipe: the column is false and the record names the cause earnedRewrite with no actor', async () => {
            const id = await paidToBook();

            await expect(earned(id)).resolves.toEqual({ cleared: true });

            expect((await readRow(id)).sourceCorrectionHold).toBe(false);
            expect(await recordsOf(id)).toMatchObject([
                { cause: 'earnedRewrite', actorAccountId: null, reason: 'earnedRewrite' },
            ]);
        });

        it('refuses a recipe not held: notHeld, nothing written', async () => {
            const id = await create({ statement: AUTHORED, visibility: 'private' });

            await expect(earned(id)).resolves.toEqual({ cleared: false, reason: 'notHeld' });
            expect(await recordsOf(id)).toHaveLength(0);
        });

        it('refuses a held recipe with no correction row: noCorrectionRow, hold unchanged, nothing written', async () => {
            const id = await create({ statement: AUTHORED, visibility: 'private' });

            await db.execute(sql`UPDATE recipes SET source_correction_hold = true WHERE id = ${id}`);
            await expect(earned(id)).resolves.toEqual({ cleared: false, reason: 'noCorrectionRow' });
            expect((await readRow(id)).sourceCorrectionHold).toBe(true);
            expect(await recordsOf(id)).toHaveLength(0);
        });

        it('refuses an own answer anywhere in the chain (the mistaken own correction): ownAnswerInChain, hold unchanged, nothing written', async () => {
            const id = await mistakenOwn();

            await corrections.correct(staff(), id, correction(BOOK));
            await expect(earned(id)).resolves.toEqual({ cleared: false, reason: 'ownAnswerInChain' });
            expect((await readRow(id)).sourceCorrectionHold).toBe(true);
            expect(await recordsOf(id)).toHaveLength(0);
        });

        it('refuses a from-person answer in the chain: fromPersonAnswerInChain, hold unchanged, nothing written', async () => {
            const id = await create({ statement: PAID, visibility: 'private' });

            await corrections.correct(staff(), id, correction({ kind: 'fromPerson' }));
            await corrections.correct(staff(), id, correction(BOOK));
            await expect(earned(id)).resolves.toEqual({ cleared: false, reason: 'fromPersonAnswerInChain' });
            expect((await readRow(id)).sourceCorrectionHold).toBe(true);
            expect(await recordsOf(id)).toHaveLength(0);
        });

        it('a clone with its own third-party row, whose ancestor was corrected to own, is refused (the chain decides, not the nearest row)', async () => {
            const root = await create({ statement: PAID, visibility: 'private' });
            const clone = await cloneOf(root, COOK);

            await corrections.correct(staff(), root, correction(BOOK));
            await db.execute(sql`UPDATE recipes SET source_correction_hold = true WHERE id = ${clone}`);
            await corrections.correct(staff(), clone, correction(WEB));
            await corrections.correct(staff(), root, correction({ kind: 'authored' }));

            await expect(earned(clone)).resolves.toEqual({ cleared: false, reason: 'ownAnswerInChain' });
        });
    });
});
