/**
 * ADR-0073 - the free-tier private slots, against a REAL database (LOCAL e2e, docs/CODING_STANDARDS.md section 7.1a).
 *
 * REWRITTEN for the owner ruling of 2026-10-26 (ADR-0073 section 12, spec 001 FR-003b): a DRAFT holds no slot. A slot is a
 * private recipe that is PUBLISHED and not deleted; the check runs when a recipe comes to hold one (created published,
 * made private while published, a private draft published). The old suite counted drafts, refused a private clone at 50 and
 * never published a draft; those assertions are replaced, not edited to pass.
 *
 * What a mocked DAL structurally cannot prove, and this does:
 *  - the count is the LIVE row count, with the right predicate: private AND published AND undeleted AND owned, every label;
 *  - the per-user advisory lock really excludes a second connection, and two private writes racing at 49 land exactly one
 *    (creates, set-visibility, and two DIFFERENT private drafts published at once);
 *  - a free cook at 50 can still save a private draft, and publishing it is refused with PRIVATE_SLOTS_FULL;
 *  - set-visibility's transaction, the clone path (a clone is a draft, so no slot), and a tombstone freeing a slot;
 *  - a downgraded cook holding more than 50 keeps them all and is refused a new one.
 *
 * The dev-auth bypass makes every caller FREE-tier (`permissions: []`), so the Premium arms are the unit suite's
 * (`recipes.service.privateSlots.test.ts`); here Premium is the absence of a refusal nowhere. Each test uses its OWN cook id so
 * nothing leaks between them (the bypass reads `RECIPE_DEV_AUTH_USER_ID` per request, so a test sets it for itself).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { ADVISORY_LOCK_CLASSES } from '@kitchensink/db-schema-guard';

import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';
import { recipes, recipeSteps } from '../../../src/database/schema/index.js';
import { startFoodFake, type FoodFake } from '../../support/foodFake.js';
import { insertIngredientLine } from '../../support/lineChain.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();

const FLOUR_ID = '00000000-0000-4000-8000-0000000000aa';
const FIRST_COOK = '01JSLOTSCOOKAAAAAAAAAAAAA1';
const BYSTANDER = '01JSLOTSBYSTANDERBBBBBBBBB2';

const CREATE_BODY = {
    title: 'Slot Subject',
    servings: 1,
    prepTimeMinutes: 1,
    cookTimeMinutes: 1,
    totalTimeMinutes: 2,
    cuisine: 'Italian',
    ingredients: [{ ingredientId: FLOUR_ID, quantity: { kind: 'exact', value: 1 }, unit: 'cup' }],
    steps: [{ instruction: 'Mix' }],
};

interface RecipeBody {
    id: string;
    visibility: string;
    status: string;
}
interface UsageBody {
    kind: 'limited' | 'unlimited';
    used?: number;
    limit?: number;
}
interface ErrorBody {
    code: string;
    details?: { used?: number; limit?: number };
}

describe('Free-tier private slots (ADR-0073)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let db: RecipeDrizzle;
    let food: FoodFake;
    let cookCounter = 0;

    /** A fresh cook id per test, set as the dev-auth identity. */
    function newCook(): string {
        cookCounter += 1;
        const cook = `01JSLOTSCOOK${String(cookCounter).padStart(14, '0')}`;
        process.env['RECIPE_DEV_AUTH_USER_ID'] = cook;

        return cook;
    }

    /** Seed `count` recipe rows (one step each is unnecessary for the count; rows alone are what slots count). */
    async function seed(
        ownerId: string,
        count: number,
        values: Partial<typeof recipes.$inferInsert> = {},
    ): Promise<string[]> {
        const rows = Array.from({ length: count }, (_, index) => ({
            ownerId,
            title: `Seeded ${ownerId.slice(-4)} ${index} ${Math.random().toString(36).slice(2, 8)}`,
            servings: 1,
            prepTimeMinutes: 1,
            cookTimeMinutes: 1,
            totalTimeMinutes: 2,
            cuisine: 'Italian',
            ingredientNamesText: 'seeded',
            visibility: 'private' as const,
            ...values,
        }));
        const inserted = await db.insert(recipes).values(rows).returning({ id: recipes.id });

        return inserted.map((row) => row.id);
    }

    /** Seed one complete recipe (a step and a line), as a clone source needs. */
    async function seedComplete(ownerId: string, values: Partial<typeof recipes.$inferInsert>): Promise<string> {
        const [id] = await seed(ownerId, 1, values);

        if (id === undefined) {
            throw new Error('seed returned no id');
        }

        await db.insert(recipeSteps).values({ recipeId: id, stepNumber: 1, instruction: 'Step' });
        await insertIngredientLine(pool, { recipeId: id, foodLookupId: FLOUR_ID, quantity: '1', unit: 'cup' });

        return id;
    }

    async function usage(): Promise<UsageBody> {
        const res = await fetch(`${baseUrl}/api/v1/recipes/private-slots`);
        expect(res.status).toBe(200);

        return (await res.json()) as UsageBody;
    }

    function postRecipe(
        visibility: 'public' | 'private',
        title = 'Slot Subject',
        status?: 'draft' | 'published',
    ): Promise<Response> {
        return fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...CREATE_BODY, title, visibility, ...(status === undefined ? {} : { status }) }),
        });
    }

    /** Publish a stored draft the way the editor's Publish does: PATCH its status at the version it holds. */
    function publish(id: string, expectedVersion = 1): Promise<Response> {
        return fetch(`${baseUrl}/api/v1/recipes/${id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedVersion, status: 'published' }),
        });
    }

    /** Save a stored recipe as a draft again (frees its slot if it held one), or edit a draft in place. */
    function patchRecipe(id: string, body: Record<string, unknown>): Promise<Response> {
        return fetch(`${baseUrl}/api/v1/recipes/${id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    function patchVisibility(id: string, visibility: 'public' | 'private'): Promise<Response> {
        return fetch(`${baseUrl}/api/v1/recipes/${id}/visibility`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ visibility }),
        });
    }

    async function privateCount(ownerId: string): Promise<number> {
        const [row] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(recipes)
            .where(
                sql`${recipes.ownerId} = ${ownerId} AND ${recipes.visibility} = 'private' AND ${recipes.status} = 'published' AND ${recipes.deletedAt} IS NULL`,
            );

        return row?.n ?? 0;
    }

    beforeAll(async () => {
        food = await startFoodFake();
        process.env['FOOD_SERVICE_URL'] = food.origin;
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: FIRST_COOK });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = createRecipeDrizzle(pool);
    });

    afterAll(async () => {
        await db.delete(recipes).where(sql`${recipes.ownerId} LIKE '01JSLOTS%'`);
        await pool.end();
        await booted.close();
        await food.close();
        delete process.env['FOOD_SERVICE_URL'];
    });

    afterEach(() => {
        process.env['RECIPE_DEV_AUTH_USER_ID'] = FIRST_COOK;
    });

    describe('the count', () => {
        it('counts exactly the cook’s private, PUBLISHED, undeleted recipes: every label; not drafts, not public, not deleted, not another cook’s', async () => {
            const cook = newCook();
            await seed(cook, 2, { sourceType: 'user_created' });
            await seed(cook, 1, { sourceType: 'imported_physical' });
            await seed(cook, 1, { sourceType: 'imported_paid' });
            // None of these may count:
            await seed(cook, 7, { sourceType: 'user_created', status: 'draft' });
            await seed(cook, 3, { visibility: 'public' });
            await seed(cook, 2, { visibility: 'public', status: 'draft' });
            await seed(cook, 2, { deletedAt: new Date() });
            await seed(BYSTANDER, 5);

            expect(await usage()).toEqual({ kind: 'limited', used: 4, limit: 50 });
        });

        it('is LIVE: deleting a private recipe frees its slot at once, and making one public frees another', async () => {
            const cook = newCook();
            const ids = await seed(cook, 50, { sourceType: 'user_created' });

            expect((await usage()).used).toBe(50);

            const deleted = await fetch(`${baseUrl}/api/v1/recipes/${ids[0]}`, { method: 'DELETE' });
            expect(deleted.status).toBe(204);
            expect((await usage()).used).toBe(49);

            const publicNow = await patchVisibility(ids[1] as string, 'public');
            expect(publicNow.status).toBe(200);
            expect((await usage()).used).toBe(48);
        });
    });

    describe('create', () => {
        it('allows the 50th private recipe (49 held) and refuses the 51st with 403 PRIVATE_SLOTS_FULL carrying used and limit', async () => {
            const cook = newCook();
            await seed(cook, 49);

            const fiftieth = await postRecipe('private', 'The fiftieth');
            expect(fiftieth.status).toBe(201);
            expect(((await fiftieth.json()) as RecipeBody).visibility).toBe('private');

            const refused = await postRecipe('private', 'The fifty-first');
            expect(refused.status).toBe(403);
            expect((await refused.json()) as ErrorBody).toMatchObject({
                code: 'PRIVATE_SLOTS_FULL',
                details: { used: 50, limit: 50 },
            });
            // Nothing was written by the refusal.
            expect(await privateCount(cook)).toBe(50);
        });

        it('a PUBLIC create takes no slot, even for a cook at the limit', async () => {
            const cook = newCook();
            await seed(cook, 50);

            const res = await postRecipe('public', 'Public at the limit');

            expect(res.status).toBe(201);
            expect(await privateCount(cook)).toBe(50);
        });
    });

    describe('⛔ a draft holds no slot (owner ruling 2026-10-26)', () => {
        it('a free cook with 50 published private recipes can still SAVE a private draft; publishing it is refused with PRIVATE_SLOTS_FULL', async () => {
            const cook = newCook();
            await seed(cook, 50);

            const saved = await postRecipe('private', 'A private draft', 'draft');
            expect(saved.status).toBe(201);
            const draft = (await saved.json()) as RecipeBody;
            expect(draft).toMatchObject({ visibility: 'private', status: 'draft' });
            expect(await usage()).toEqual({ kind: 'limited', used: 50, limit: 50 });

            // Editing the private draft in place is never a slot question either.
            const edited = await patchRecipe(draft.id, { expectedVersion: 1, title: 'Still a draft' });
            expect(edited.status, await edited.clone().text()).toBe(200);
            const refused = await publish(
                draft.id,
                ((await edited.json()) as { currentVersion: number }).currentVersion,
            );
            expect(refused.status).toBe(403);
            expect((await refused.json()) as ErrorBody).toMatchObject({
                code: 'PRIVATE_SLOTS_FULL',
                details: { used: 50, limit: 50 },
            });
            // The refusal wrote nothing: it is still a draft and the count did not move.
            const [row] = await db
                .select({ status: recipes.status })
                .from(recipes)
                .where(sql`${recipes.id} = ${draft.id}`);
            expect(row?.status).toBe('draft');
            expect(await privateCount(cook)).toBe(50);
        });

        it('49 published private recipes plus many private drafts: publishing one more succeeds, and the next is refused', async () => {
            const cook = newCook();
            await seed(cook, 49);
            const drafts = await Promise.all(Array.from({ length: 6 }, () => seedComplete(cook, { status: 'draft' })));

            expect(await usage()).toEqual({ kind: 'limited', used: 49, limit: 50 });
            expect((await publish(drafts[0] as string)).status).toBe(200);
            expect(await usage()).toEqual({ kind: 'limited', used: 50, limit: 50 });

            const refused = await publish(drafts[1] as string);
            expect(refused.status).toBe(403);
            expect(((await refused.json()) as ErrorBody).code).toBe('PRIVATE_SLOTS_FULL');
            expect(await privateCount(cook)).toBe(50);
        });

        it('publishing a PUBLIC draft takes no slot, even at 50', async () => {
            const cook = newCook();
            await seed(cook, 50);
            const draft = await seedComplete(cook, { status: 'draft', visibility: 'public' });

            expect((await publish(draft)).status).toBe(200);
            expect(await privateCount(cook)).toBe(50);
        });

        it('making a private DRAFT’s visibility private at 50 is allowed, and a published recipe made private is not', async () => {
            const cook = newCook();
            await seed(cook, 50);
            const [publicDraft] = await seed(cook, 1, { status: 'draft', visibility: 'public' });
            const [publicPublished] = await seed(cook, 1, { status: 'published', visibility: 'public' });

            expect((await patchVisibility(publicDraft as string, 'private')).status).toBe(200);
            expect((await patchVisibility(publicPublished as string, 'private')).status).toBe(403);
            expect(await privateCount(cook)).toBe(50);
        });

        it('sending a published private recipe BACK to draft frees its slot, so another private draft can then be published', async () => {
            const cook = newCook();
            const ids = await seed(cook, 50);
            const draft = await seedComplete(cook, { status: 'draft' });

            expect((await publish(draft)).status).toBe(403);
            const back = await patchRecipe(ids[0] as string, { expectedVersion: 1, status: 'draft' });
            expect(back.status, await back.clone().text()).toBe(200);
            expect(await privateCount(cook)).toBe(49);
            expect((await publish(draft)).status).toBe(200);
            expect(await privateCount(cook)).toBe(50);
        });

        // REWRITTEN for ADR-0077 section 6 (owner ruling 2026-10-29, "Any cook, using a slot"). It said a downgraded cook
        // cannot publish a private clone of a web import: 400 INVALID_VISIBILITY, whatever the slot count. A web import is
        // now private within a slot like every other label, so the publish takes a slot, and at 50 it is the slot
        // refusal (403 PRIVATE_SLOTS_FULL), never a Premium refusal.
        it('⛔ a cook at 50 cannot publish a private clone of a web import: 403 PRIVATE_SLOTS_FULL, and it stays a draft', async () => {
            const cook = newCook();
            await seed(cook, 49);
            const webId = await seedComplete(cook, { sourceType: 'imported_public' });
            expect(await privateCount(cook)).toBe(50);

            const copied = await fetch(`${baseUrl}/api/v1/recipes/${webId}/clone`, { method: 'POST' });
            expect(copied.status, await copied.clone().text()).toBe(201);
            const copy = (await copied.json()) as RecipeBody & { currentVersion: number };
            expect(copy).toMatchObject({ visibility: 'private', status: 'draft' });

            const refused = await patchRecipe(copy.id, {
                expectedVersion: copy.currentVersion,
                status: 'published',
                steps: [{ instruction: 'A substantive change' }],
            });

            expect(refused.status).toBe(403);
            expect(((await refused.json()) as ErrorBody).code).toBe('PRIVATE_SLOTS_FULL');
            const [row] = await db
                .select({ status: recipes.status })
                .from(recipes)
                .where(sql`${recipes.id} = ${copy.id}`);
            expect(row?.status).toBe('draft');
            expect(await privateCount(cook)).toBe(50);
        });

        it('a draft deleted frees nothing (it held nothing) and a published private deleted frees one', async () => {
            const cook = newCook();
            const ids = await seed(cook, 50);
            const [draftId] = await seed(cook, 1, { status: 'draft' });

            expect((await fetch(`${baseUrl}/api/v1/recipes/${draftId}`, { method: 'DELETE' })).status).toBe(204);
            expect((await usage()).used).toBe(50);
            expect((await fetch(`${baseUrl}/api/v1/recipes/${ids[0]}`, { method: 'DELETE' })).status).toBe(204);
            expect((await usage()).used).toBe(49);
        });
    });

    describe('the lock', () => {
        it('two private creates racing at 49 land EXACTLY one', async () => {
            const cook = newCook();
            await seed(cook, 49);

            const responses = await Promise.all(
                Array.from({ length: 8 }, (_, index) => postRecipe('private', `Racer ${index}`)),
            );
            const statuses = responses.map((res) => res.status).sort();

            expect(statuses).toEqual([201, 403, 403, 403, 403, 403, 403, 403]);
            expect(await privateCount(cook)).toBe(50);
        });

        it('two DIFFERENT private drafts published at once at 49 land EXACTLY one (two real connections, one cook lock)', async () => {
            const cook = newCook();
            await seed(cook, 49);
            const drafts = await Promise.all(Array.from({ length: 6 }, () => seedComplete(cook, { status: 'draft' })));

            const responses = await Promise.all(drafts.map((id) => publish(id)));

            expect(responses.map((res) => res.status).sort()).toEqual([200, 403, 403, 403, 403, 403]);
            expect(await privateCount(cook)).toBe(50);
        });

        it('a publish racing a set-visibility at 49 land exactly one (the two writers share the cook lock)', async () => {
            const cook = newCook();
            await seed(cook, 49);
            const draft = await seedComplete(cook, { status: 'draft' });
            const [publicId] = await seed(cook, 1, { visibility: 'public' });

            const responses = await Promise.all([publish(draft), patchVisibility(publicId as string, 'private')]);

            expect(responses.map((res) => res.status).sort()).toEqual([200, 403]);
            expect(await privateCount(cook)).toBe(50);
        });

        it('racing set-visibility requests for different public recipes at 49 land exactly one', async () => {
            const cook = newCook();
            await seed(cook, 49);
            const publicIds = await seed(cook, 6, { visibility: 'public' });

            const responses = await Promise.all(publicIds.map((id) => patchVisibility(id, 'private')));

            expect(responses.map((res) => res.status).sort()).toEqual([200, 403, 403, 403, 403, 403]);
            expect(await privateCount(cook)).toBe(50);
        });

        it('⛔ really BLOCKS on the cook’s lock: a private create does not finish while another connection holds it, and a different cook is not held up', async () => {
            const cook = newCook();
            const holder = await pool.connect();

            try {
                await holder.query('BEGIN');
                await holder.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
                    ADVISORY_LOCK_CLASSES.recipePrivateSlots,
                    cook,
                ]);

                let settled = false;
                const pending = postRecipe('private', 'Held by the lock').then((res) => {
                    settled = true;

                    return res;
                });

                await new Promise((resolve) => setTimeout(resolve, 1_500));
                expect(settled, 'the create must wait for the cook’s lock').toBe(false);

                await holder.query('COMMIT');
                const res = await pending;

                expect(res.status).toBe(201);
            } finally {
                holder.release();
            }
        });

        it('the lock is PER COOK: holding one cook’s lock does not block another cook’s private create', async () => {
            const heldCook = newCook();
            const holder = await pool.connect();

            try {
                await holder.query('BEGIN');
                await holder.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
                    ADVISORY_LOCK_CLASSES.recipePrivateSlots,
                    heldCook,
                ]);

                newCook();
                const res = await Promise.race([
                    postRecipe('private', 'Different cook'),
                    new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 3_000)),
                ]);

                expect(res).not.toBe('blocked');
                expect((res as Response).status).toBe(201);
            } finally {
                await holder.query('COMMIT');
                holder.release();
            }
        });
    });

    describe('set-visibility', () => {
        it('refuses private at 50 with 403 PRIVATE_SLOTS_FULL and leaves the recipe public', async () => {
            const cook = newCook();
            await seed(cook, 50);
            const [publicId] = await seed(cook, 1, { visibility: 'public' });

            const res = await patchVisibility(publicId as string, 'private');

            expect(res.status).toBe(403);
            expect(((await res.json()) as ErrorBody).code).toBe('PRIVATE_SLOTS_FULL');
            expect(await privateCount(cook)).toBe(50);
        });

        it('imported_physical and imported_paid take a slot too: allowed at 49, refused at 50, no Premium needed', async () => {
            const cook = newCook();
            await seed(cook, 49);
            const [book] = await seed(cook, 1, { visibility: 'public', sourceType: 'imported_physical' });
            const [paid] = await seed(cook, 1, { visibility: 'public', sourceType: 'imported_paid' });

            expect((await patchVisibility(book as string, 'private')).status).toBe(200);
            expect((await patchVisibility(paid as string, 'private')).status).toBe(403);
        });

        // REWRITTEN for ADR-0077 section 6: it used to be refused 400 for want of Premium with slots to spare.
        it('an imported_public recipe goes private in a free slot (200), and is refused only when none is left', async () => {
            const cook = newCook();
            const [webId] = await seed(cook, 1, { visibility: 'public', sourceType: 'imported_public' });

            expect((await patchVisibility(webId as string, 'private')).status).toBe(200);

            const full = newCook();
            await seed(full, 50);
            const [web] = await seed(full, 1, { visibility: 'public', sourceType: 'imported_public' });
            const refused = await patchVisibility(web as string, 'private');

            expect(refused.status).toBe(403);
            expect(((await refused.json()) as ErrorBody).code).toBe('PRIVATE_SLOTS_FULL');
        });

        it('making a private recipe public frees its slot, so a new private one then fits', async () => {
            const cook = newCook();
            const ids = await seed(cook, 50);

            expect((await postRecipe('private')).status).toBe(403);
            expect((await patchVisibility(ids[0] as string, 'public')).status).toBe(200);
            expect((await postRecipe('private')).status).toBe(201);
        });
    });

    describe('downgrade: a cook holding more than 50 keeps them all', () => {
        it('reports used 60, refuses a new private recipe saying 60, and keeps asking-for-private on an already-private recipe a success', async () => {
            const cook = newCook();
            const ids = await seed(cook, 60);

            expect(await usage()).toEqual({ kind: 'limited', used: 60, limit: 50 });

            const refused = await postRecipe('private');
            expect(refused.status).toBe(403);
            expect(((await refused.json()) as ErrorBody).details).toEqual({ used: 60, limit: 50 });

            // The recipe is ALREADY private and already holds its slot: not a refusal.
            expect((await patchVisibility(ids[0] as string, 'private')).status).toBe(200);
            expect(await privateCount(cook)).toBe(60);
        });

        it('stays refused until the cook is UNDER the limit (59 is still full, 49 is not)', async () => {
            const cook = newCook();
            const ids = await seed(cook, 51);

            // 51 -> 50: one deletion is not enough, 50 is full.
            await fetch(`${baseUrl}/api/v1/recipes/${ids[0]}`, { method: 'DELETE' });
            expect((await postRecipe('private')).status).toBe(403);

            await fetch(`${baseUrl}/api/v1/recipes/${ids[1]}`, { method: 'DELETE' });
            expect((await postRecipe('private')).status).toBe(201);
        });
    });

    describe('⛔ a downgrade never publishes (owner ruling 2026-10-26)', () => {
        /** How many of the cook's undeleted recipes are public: the number that must stay zero. */
        async function publicCount(ownerId: string): Promise<number> {
            const [row] = await db
                .select({ n: sql<number>`count(*)::int` })
                .from(recipes)
                .where(
                    sql`${recipes.ownerId} = ${ownerId} AND ${recipes.visibility} = 'public' AND ${recipes.deletedAt} IS NULL`,
                );

            return row?.n ?? 0;
        }

        it('60 private recipes of every label stay private through every path a downgraded cook can take', async () => {
            const cook = newCook();
            // 56 bare rows plus one complete recipe per label: the labels a lapsed Premium cook can hold privately.
            await seed(cook, 56);
            const complete = await Promise.all(
                (['user_created', 'imported_public', 'imported_physical', 'imported_paid'] as const).map((sourceType) =>
                    seedComplete(cook, { sourceType }),
                ),
            );

            expect(await usage()).toEqual({ kind: 'limited', used: 60, limit: 50 });
            expect(await privateCount(cook)).toBe(60);

            // 1. A new private recipe is refused, and the refusal leaves everything as it was.
            expect((await postRecipe('private')).status).toBe(403);

            // 2. Asking for private on a recipe that is already private changes nothing: a success, except for a
            //    web-imported one (ADR-0077 section 6: it is a slot like the rest, so it is a success too).
            for (const id of complete) {
                expect((await patchVisibility(id, 'private')).status).toBe(200);
            }

            // 3. A SUBSTANTIVE edit (new steps and ingredients) of each: the update path carries no visibility, and the
            //    server must not re-judge a recipe it already holds private.
            for (const id of complete) {
                const edit = await fetch(`${baseUrl}/api/v1/recipes/${id}`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        expectedVersion: 1,
                        steps: [{ instruction: 'Stir for a different reason' }],
                        ingredients: CREATE_BODY.ingredients,
                    }),
                });

                expect(edit.status, await edit.clone().text()).toBe(200);
                expect(((await edit.json()) as RecipeBody).visibility).toBe('private');
            }

            // 4. A copy of each is a DRAFT (a draft holds no slot), so it is allowed, stays private, and does not move the
            //    count. It cannot be PUBLISHED: that would take a slot the cook does not have.
            for (const id of complete) {
                const copy = await fetch(`${baseUrl}/api/v1/recipes/${id}/clone`, { method: 'POST' });

                expect(copy.status, await copy.clone().text()).toBe(201);
                const body = (await copy.json()) as RecipeBody;
                expect(body).toMatchObject({ visibility: 'private', status: 'draft' });
            }

            // 5. Reads, and the slot read itself, change nothing.
            expect((await fetch(`${baseUrl}/api/v1/recipes?limit=5`)).status).toBe(200);
            await usage();

            expect(await privateCount(cook)).toBe(60);
            expect(await publicCount(cook)).toBe(0);
        });

        it('publishing a private draft is refused for a cook holding 60, and the draft stays a private draft', async () => {
            const cook = newCook();
            await seed(cook, 60);
            const draft = await seedComplete(cook, { status: 'draft' });

            const refused = await publish(draft);

            expect(refused.status).toBe(403);
            expect(((await refused.json()) as ErrorBody).details).toEqual({ used: 60, limit: 50 });
            expect(await publicCount(cook)).toBe(0);
        });

        it('deleting one frees a slot but still publishes nothing: 59 stay private', async () => {
            const cook = newCook();
            const ids = await seed(cook, 60);

            expect((await fetch(`${baseUrl}/api/v1/recipes/${ids[0]}`, { method: 'DELETE' })).status).toBe(204);

            expect(await privateCount(cook)).toBe(59);
            expect(await publicCount(cook)).toBe(0);
        });
    });

    describe('a clone is a draft, so it uses no slot', () => {
        it('lets an owner clone their own private book recipe at 50: the copy is a private DRAFT and the count does not move', async () => {
            const cook = newCook();
            await seed(cook, 49);
            const bookId = await seedComplete(cook, { sourceType: 'imported_physical' });
            expect(await privateCount(cook)).toBe(50);

            const res = await fetch(`${baseUrl}/api/v1/recipes/${bookId}/clone`, { method: 'POST' });

            expect(res.status).toBe(201);
            const copy = (await res.json()) as RecipeBody;
            expect(copy).toMatchObject({ visibility: 'private', status: 'draft' });
            expect(await privateCount(cook)).toBe(50);
            // Its slot is taken when the cook publishes it, and at 50 there is none.
            expect((await publish(copy.id)).status).toBe(403);
        });

        it('with a slot free, publishing the clone takes it', async () => {
            const cook = newCook();
            const bookId = await seedComplete(cook, { sourceType: 'imported_paid' });

            const res = await fetch(`${baseUrl}/api/v1/recipes/${bookId}/clone`, { method: 'POST' });
            const copy = (await res.json()) as RecipeBody;

            expect(res.status).toBe(201);
            expect(await privateCount(cook)).toBe(1);
            expect((await publish(copy.id)).status).toBe(200);
            expect(await privateCount(cook)).toBe(2);
        });

        it('FR-005c: cloning your OWN private user_created recipe gives a private copy (a draft)', async () => {
            const cook = newCook();
            const id = await seedComplete(cook, { sourceType: 'user_created' });

            const res = await fetch(`${baseUrl}/api/v1/recipes/${id}/clone`, { method: 'POST' });

            expect((await res.json()) as RecipeBody).toMatchObject({ visibility: 'private', status: 'draft' });
        });

        it('a PUBLIC clone of another cook’s recipe takes no slot, even at 50', async () => {
            const cook = newCook();
            await seed(cook, 50);
            const publicId = await seedComplete(BYSTANDER, { visibility: 'public', sourceType: 'user_created' });

            const res = await fetch(`${baseUrl}/api/v1/recipes/${publicId}/clone`, { method: 'POST' });

            expect(res.status).toBe(201);
            expect(((await res.json()) as RecipeBody).visibility).toBe('public');
            expect(await privateCount(cook)).toBe(50);
        });
    });

    describe('erasure is unaffected', () => {
        it('a tombstoned recipe (what erasure and delete both leave) holds no slot, and another cook’s rows never move the count', async () => {
            const cook = newCook();
            await seed(cook, 3);
            await seed(cook, 4, { deletedAt: new Date() });
            await seed(BYSTANDER, 40);

            expect((await usage()).used).toBe(3);

            // Erasing the BYSTANDER's rows (tombstoning them) does not change this cook's standing.
            await db
                .update(recipes)
                .set({ deletedAt: new Date() })
                .where(sql`${recipes.ownerId} = ${BYSTANDER}`);
            expect((await usage()).used).toBe(3);
        });
    });
});
