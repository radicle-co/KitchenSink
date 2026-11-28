/**
 * The hold clear under concurrency (ADR-0106 decision 5, plan pr5HoldClear KTD-7, rows E1 to E4) against a real PostgreSQL.
 *
 * Every row is deterministic: a BARRIER holds a lock, the contender is started, and the test polls `pg_locks` until the contender
 * is WAITING on the named lock before the barrier is released. There is no fixed sleep, so a slow machine waits longer and a fast one
 * does not guess.
 *
 *  - E1 two staff clears of one recipe: exactly one clears, the other answers HOLD_NOT_SET, one record.
 *  - E2 set-visibility and an earned clear of one recipe: neither deadlocks (the earned clear takes the row and no slot lock).
 *  - E3 a correction of a same-owner descendant during a staff clear waits on the owner's ADVISORY lock, then applies and re-holds it.
 *  - E4 the derive-after-lock race: a transaction that earned-clears descendant D holds D's row; the staff clear waits on D, then
 *    proceeds with no 23514, does not record D, and still releases D's held children.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { recipeSourceHoldClears, recipes } from '../../../src/database/schema/index.js';
import { RECIPES_DAL } from '../../../src/recipes/recipes.tokens.js';
import type { RecipesDal } from '../../../src/recipes/dal/recipes.dal.js';
import { SourceCorrectionService } from '../../../src/recipes/sourceCorrection.service.js';
import { SourceHoldClearService } from '../../../src/recipes/sourceHoldClear.service.js';
import { SOURCE_CORRECT_SCOPE, type SourceCorrectionRequest } from '../../../src/recipes/recipes.schema.js';
import type { Principal } from '../../../src/auth/principal.js';
import { recipeDb } from '../../support/roleDb.js';
import { PUBLIC_CONFIRMATION_AS_SHOWN } from '../../../src/__fixtures__/index.js';

const roleDb = recipeDb();
const COOK = '01JHCLRCONCCOOKAAAAAAAAA1';
const STAFF = '01JHCLRCONCSTAFFAAAAAAAA1';
const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';
const PAID = {
    kind: 'paid_site',
    citation: 'Sam’s Subscription Kitchen',
    wording: { version: 'statementPaidSite.v1', locale: 'en' },
} as const;
const BOOK = { kind: 'book', citation: 'Joy of Cooking' } as const;
const WEB = { kind: 'public_web', citation: 'https://www.allrecipes.com/recipe/1/soup/' } as const;

const staff = (): Principal => ({
    userId: STAFF,
    sub: `test:${STAFF}`,
    scopes: [SOURCE_CORRECT_SCOPE],
    permissions: [],
    roles: [],
    principalKind: 'real',
    containment: 'enforce',
});

const correction = (answer: SourceCorrectionRequest['answer']): SourceCorrectionRequest => ({
    ownerAccountId: COOK,
    answer,
    ground: 'ownerConfirmedByAccountEmail',
    reason: 'Owner asked by email; mailbox challenge passed.',
});

describe('a hold clear under concurrency (e2e, ADR-0106)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let corrections: SourceCorrectionService;
    let clears: SourceHoldClearService;
    let recipesDal: RecipesDal;

    beforeAll(async () => {
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: COOK });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 8 });
        db = createRecipeDrizzle(pool);
        corrections = booted.app.get(SourceCorrectionService);
        clears = booted.app.get(SourceHoldClearService);
        recipesDal = booted.app.get<RecipesDal>(RECIPES_DAL);
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

    /** A held root: a paid-site recipe corrected to a book. */
    async function heldRoot(): Promise<string> {
        const { status, json } = await send('POST', '/api/v1/recipes', {
            publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
            title: 'Tomato Soup',
            servings: 2,
            prepTimeMinutes: 5,
            cookTimeMinutes: 20,
            totalTimeMinutes: 25,
            cuisine: 'Italian',
            ingredients: [{ ingredientId: FLOUR_ID, quantity: { kind: 'exact', value: 2 }, unit: 'cup' }],
            steps: [{ instruction: 'Simmer.' }],
            statement: PAID,
            visibility: 'private',
        });

        expect(status).toBe(201);

        return json['id'] as string;
    }

    async function cloneOf(id: string): Promise<string> {
        const cloned = await send('POST', `/api/v1/recipes/${id}/clone`, {});

        expect(cloned.status).toBe(201);

        return cloned.json['id'] as string;
    }

    async function holdOf(id: string): Promise<boolean | undefined> {
        const rows = await db.select({ h: recipes.sourceCorrectionHold }).from(recipes).where(eq(recipes.id, id));

        return rows.at(0)?.h;
    }

    const recordsOf = (id: string) =>
        db.select().from(recipeSourceHoldClears).where(eq(recipeSourceHoldClears.recipeId, id));

    async function latestId(id: string): Promise<string | null> {
        return (await corrections.preview(staff(), id, COOK)).latestCorrectionId;
    }

    /** Poll until `count` backends wait on a lock of `locktype` (a barrier, not a sleep). */
    async function waitForWaiters(locktype: string, count = 1): Promise<void> {
        const deadline = Date.now() + 30_000;

        for (;;) {
            const { rows } = await pool.query<{ n: string }>(
                `SELECT count(*) AS n FROM pg_locks WHERE locktype = $1 AND NOT granted`,
                [locktype],
            );

            if (Number(rows[0]?.n) >= count) {
                return;
            }

            if (Date.now() > deadline) {
                throw new Error(`no backend waited on a ${locktype} lock`);
            }

            await new Promise((resolve) => setImmediate(resolve));
        }
    }

    /** A transaction that the test holds open until `release()`. */
    function barrier(work: (tx: Parameters<Parameters<RecipeDrizzle['transaction']>[0]>[0]) => Promise<void>) {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let entered: () => void = () => undefined;
        const inside = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const done = db.transaction(async (tx) => {
            await work(tx);
            entered();
            await gate;
        });

        return { inside, release, done };
    }

    it('E1: two staff clears of one recipe: exactly one clears, the other is HOLD_NOT_SET, and one record is written', async () => {
        const id = await heldRoot();

        await corrections.correct(staff(), id, correction(BOOK));

        const request = { ownerAccountId: COOK, correctionId: await latestId(id), reason: 'Mistaken.' };
        const slot = barrier(async (tx) => {
            await recipesDal.lockAndCountPrivateSlots(tx, COOK);
        });

        await slot.inside;

        const first = clears.clearByStaff(staff(), id, request).then(
            (value) => ({ ok: value }),
            (error: unknown) => ({ failed: error }),
        );
        const second = clears.clearByStaff(staff(), id, request).then(
            (value) => ({ ok: value }),
            (error: unknown) => ({ failed: error }),
        );

        await waitForWaiters('advisory', 2);
        slot.release();
        await slot.done;

        const results = await Promise.all([first, second]);
        const won = results.filter((r) => 'ok' in r);
        const lost = results.filter((r) => 'failed' in r);

        expect(won).toHaveLength(1);
        expect(lost).toHaveLength(1);
        expect(lost[0]).toMatchObject({ failed: { code: 'HOLD_CLEAR_CONFLICT', details: { reason: 'HOLD_NOT_SET' } } });
        expect(await recordsOf(id)).toHaveLength(1);
        expect(await holdOf(id)).toBe(false);
    });

    it('E2: set-visibility and an earned clear of one recipe, in a deliberate overlap, neither deadlock nor answer a 5xx', async () => {
        const id = await heldRoot();

        await corrections.correct(staff(), id, correction(BOOK));

        const earned = barrier(async (tx) => {
            await expect(clears.clearByEarnedRewrite(tx, id)).resolves.toEqual({ cleared: true });
        });

        await earned.inside;

        const visibility = send('PATCH', `/api/v1/recipes/${id}/visibility`, {
            visibility: 'public',
            publicConfirmation: PUBLIC_CONFIRMATION_AS_SHOWN,
        });

        await waitForWaiters('transactionid');
        earned.release();
        await earned.done;

        const answered = await visibility;

        expect(answered.status).toBeLessThan(500);
        expect(await holdOf(id)).toBe(false);
        expect(await recordsOf(id)).toHaveLength(1);
    });

    it('E3: a correction of a same-owner descendant during a staff clear waits on the ADVISORY lock, then applies and re-holds it', async () => {
        const root = await heldRoot();
        const clone = await cloneOf(root);

        await corrections.correct(staff(), root, correction(BOOK));
        expect(await holdOf(clone)).toBe(true);

        const request = { ownerAccountId: COOK, correctionId: await latestId(root), reason: 'Mistaken.' };
        // The barrier holds the ROOT row, so the clear (which already holds the owner's advisory lock) waits on it.
        const rowLock = barrier(async (tx) => {
            await tx.execute(sql`SELECT id FROM recipes WHERE id = ${root}::uuid FOR UPDATE`);
        });

        await rowLock.inside;

        const clearing = clears.clearByStaff(staff(), root, request);

        await waitForWaiters('transactionid');

        const correcting = corrections.correct(staff(), clone, correction(WEB));

        await waitForWaiters('advisory');

        const { rows } = await pool.query<{ n: string }>(
            `SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`,
        );

        expect(Number(rows[0]?.n)).toBe(1);
        rowLock.release();
        await rowLock.done;

        await expect(clearing).resolves.toEqual({ result: 'cleared', released: 2 });
        await expect(correcting).resolves.toEqual({ result: 'applied' });

        // The clear released the clone (it had no row of its own at that moment), then the correction applied and held it again.
        expect(await recordsOf(clone)).toHaveLength(1);
        expect(await holdOf(root)).toBe(false);
        expect(await holdOf(clone)).toBe(true);
    });

    it('E4: a descendant earned-cleared by another transaction is not recorded again, and its held child is still released', async () => {
        const root = await heldRoot();
        const clone = await cloneOf(root);
        const grandchild = await cloneOf(clone);

        await corrections.correct(staff(), root, correction(BOOK));
        expect(await holdOf(grandchild)).toBe(true);

        const request = { ownerAccountId: COOK, correctionId: await latestId(root), reason: 'Mistaken.' };
        const earned = barrier(async (tx) => {
            await expect(clears.clearByEarnedRewrite(tx, clone)).resolves.toEqual({ cleared: true });
        });

        await earned.inside;

        const clearing = clears.clearByStaff(staff(), root, request);

        await waitForWaiters('transactionid');
        earned.release();
        await earned.done;

        await expect(clearing).resolves.toEqual({ result: 'cleared', released: 2 });
        expect(await recordsOf(clone)).toMatchObject([{ cause: 'earnedRewrite' }]);
        expect(await recordsOf(root)).toMatchObject([{ cause: 'staff' }]);
        expect(await recordsOf(grandchild)).toMatchObject([{ cause: 'staff' }]);
        expect(await holdOf(grandchild)).toBe(false);
    });
});
