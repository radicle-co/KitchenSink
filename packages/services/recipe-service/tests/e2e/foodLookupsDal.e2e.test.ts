/**
 * `FoodLookupsDal` against a real migrated PostgreSQL (plan 002 U3; LOCAL e2e under the 2026-09-20 ruling).
 *
 * The repository's promises are about SQL a mock cannot hold: a conflict that converges two binds on one row, a
 * partial unique index that converges failures and never declarations, a compare-and-swap that loses a race
 * cleanly, a repoint that moves every line and deletes nothing, and a delete that happens only when nothing
 * references the row. Every case writes rows scoped by {@link SCOPE} and removes them in `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createRecipeDrizzle } from '../../src/database/client.js';
import { IngredientLinesDal } from '../../src/recipes/dal/ingredientLines.dal.js';
import { FoodLookupsDal } from '../../src/ingredients/dal/foodLookups.dal.js';
import {
    admitResolvedRef,
    isAdmission,
    resolvedHandleOf,
    type FoodAdmission,
} from '../../src/ingredients/domain/foodAdmission.js';
import { declaredFailure, failureOf, mergeAttempt } from '../../src/ingredients/domain/failureOutcome.js';
import { canonicalIngredientName } from '../../src/ingredients/domain/ingredientName.js';
import { deleteBindingsMatching } from '../support/bindingCleanup.js';
import { hasTestDatabase, recipeE2eDb } from '../support/roleDb.js';

const roleDb = recipeE2eDb();

/** The prefix every row this file writes carries. */
const SCOPE = 'e2e-lookups';
const OWNER_A = '01JLOOKUPS00000000000OWNERA';
const OWNER_B = '01JLOOKUPS00000000000OWNERB';

let pool: pg.Pool;
let dal: FoodLookupsDal;

function admission(foodId: string, ownerId: string | undefined = undefined): FoodAdmission {
    const decision = admitResolvedRef(
        foodId,
        {
            outcome: 'found',
            name: canonicalIngredientName(`${SCOPE} ${foodId}`),
            status: 'RESOLVED',
            isPrivate: ownerId !== undefined,
        },
        ownerId,
    );

    if (!isAdmission(decision)) {
        throw new Error(`fixture admission refused: ${decision.refused}`);
    }

    return decision;
}

async function makeRecipe(label: string, ownerId: string = OWNER_A): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO recipes (owner_id, title, prep_time_minutes, cook_time_minutes, total_time_minutes, servings)
              VALUES ($1, $2, 5, 10, 15, 2) RETURNING id`,
        [ownerId, `${SCOPE} ${label}`],
    );
    const row = rows[0];

    if (row === undefined) {
        throw new Error(`recipes insert for "${label}" returned no row`);
    }

    return row.id;
}

async function addLine(recipeId: string, lookupId: string): Promise<void> {
    await pool.query(`INSERT INTO ingredients (recipe_id, food_lookup_id, unit) VALUES ($1, $2, 'g')`, [
        recipeId,
        lookupId,
    ]);
}

async function linesOn(lookupId: string): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ingredients WHERE food_lookup_id = $1`,
        [lookupId],
    );

    return rows[0]?.n ?? 0;
}

const exhausted = { kind: 'exhausted', consulted: ['curated', 'memo'], unavailable: [] } as const;

/** A shared failure waiting on a food, and food's proof that it resolved it. */
async function pendingFailure(label: string) {
    const name = `${SCOPE} ${label}`;
    const foodId = `${SCOPE}-${label}-food`;
    const failure = await dal.recordFailure(
        failureOf({
            name,
            normalizedKey: name,
            sourcePhrase: null,
            cascade: exhausted,
            food: { kind: 'answered', foodId, status: 'PENDING' },
        }),
    );
    const handle = resolvedHandleOf(failure, {
        kind: 'handle',
        foodId,
        answer: { outcome: 'found', name: canonicalIngredientName(name), status: 'RESOLVED', isPrivate: false },
    });

    if (handle === undefined) {
        throw new Error(`fixture handle for "${label}" refused`);
    }

    return { failure, handle };
}

/** Whether a failure record is in the retry sweep's read (the partial index's predicate). */
async function inRetryRead(unresolvedFoodId: string): Promise<boolean> {
    const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM unresolved_foods
          WHERE id = $1 AND reason_code <> 'author_declared' AND settled_lookup_id IS NULL`,
        [unresolvedFoodId],
    );

    return (rows[0]?.n ?? 0) > 0;
}

/** A recipe save's line write, through the real line repository in its own transaction. */
async function saveLine(recipeId: string, lookupId: string): Promise<void> {
    await createRecipeDrizzle(pool).transaction(async (tx) => {
        await new IngredientLinesDal().replaceForRecipe(tx, recipeId, [
            { foodLookupId: lookupId, quantity: { kind: 'exact', value: 1 }, unit: 'g', sortOrder: 0 },
        ]);
    });
}

/** Whether a promise settles within a window — a blocked database call does not. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
    return Promise.race([
        promise.then(
            () => true,
            () => true,
        ),
        new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(false), ms);
        }),
    ]);
}

describe.skipIf(!hasTestDatabase)('FoodLookupsDal (real Postgres)', () => {
    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 6 });
        dal = new FoodLookupsDal(createRecipeDrizzle(pool));
    });

    afterAll(async () => {
        if (pool === undefined) {
            return;
        }

        await pool.query(`DELETE FROM recipes WHERE title LIKE $1`, [`${SCOPE}%`]);
        await deleteBindingsMatching(pool, `${SCOPE}%`);
        await pool.end();
    });

    describe('binding a root food', () => {
        it('creates one lookup per food and returns the same one on a second bind', async () => {
            const first = await dal.findOrCreateBoundRoot(admission(`${SCOPE}-f1`));
            const second = await dal.findOrCreateBoundRoot(admission(`${SCOPE}-f1`));

            expect(second.lookupId).toBe(first.lookupId);
            expect(first).toMatchObject({ kind: 'root', foodId: `${SCOPE}-f1`, foodOwnerId: null });
        });

        it('⛔ never updates a lookup it finds (R13) — a later bind cannot change a shared row', async () => {
            const shared = await dal.findOrCreateBoundRoot(admission(`${SCOPE}-f2`));
            const again = await dal.findOrCreateBoundRoot(admission(`${SCOPE}-f2`, OWNER_A));

            expect(again.lookupId).toBe(shared.lookupId);
            expect(again.foodOwnerId).toBeNull();
        });

        it('⛔ AE19 — concurrent binds of one food converge on ONE lookup', async () => {
            const results = await Promise.all(
                Array.from({ length: 6 }, () => dal.findOrCreateBoundRoot(admission(`${SCOPE}-race`))),
            );

            expect(new Set(results.map((arm) => arm.lookupId)).size).toBe(1);
        });
    });

    describe('recording a failure', () => {
        it('converges two failures of one phrase on one record, counting the attempt', async () => {
            const key = `${SCOPE} yeast`;
            const failure = failureOf({
                name: key,
                normalizedKey: key,
                sourcePhrase: null,
                cascade: exhausted,
                food: { kind: 'answered', foodId: 'x', status: 'NOT_FOUND' },
            });

            const first = await dal.recordFailure(failure);
            const second = await dal.recordFailure(failure);

            expect(second.lookupId).toBe(first.lookupId);
            expect(second.failure.attempts).toBe(2);
        });

        it('⛔ R2 — a later outage counts the attempt and keeps what was learned', async () => {
            const key = `${SCOPE} miso`;
            const learned = failureOf({
                name: key,
                normalizedKey: key,
                sourcePhrase: null,
                cascade: exhausted,
                food: { kind: 'answered', foodId: 'x', status: 'NOT_FOUND' },
            });
            const outage = failureOf({
                name: key,
                normalizedKey: key,
                sourcePhrase: null,
                cascade: exhausted,
                food: { kind: 'unreachable', detail: 'down' },
            });

            await dal.recordFailure(learned);
            const after = await dal.recordFailure(outage);

            expect([after.failure.reasonCode, after.failure.attempts]).toStrictEqual(['no_source_has_it', 2]);
        });

        it('never converges two declarations, even with the same key', async () => {
            const name = `${SCOPE} spice mix`;
            const first = await dal.recordFailure(declaredFailure(name, name));
            const second = await dal.recordFailure(declaredFailure(name, name));

            expect(second.lookupId).not.toBe(first.lookupId);
        });

        it('reads back what it wrote through the one arm reader', async () => {
            const name = `${SCOPE} pending`;
            const arm = await dal.recordFailure(
                failureOf({
                    name,
                    normalizedKey: name,
                    sourcePhrase: null,
                    cascade: exhausted,
                    food: { kind: 'answered', foodId: `${SCOPE}-handle`, status: 'PENDING' },
                }),
            );
            const read = await dal.findByIds([arm.lookupId]);

            expect(read.get(arm.lookupId)).toStrictEqual(arm);
            expect(arm.failure).toMatchObject({
                reasonCode: 'awaiting_source',
                status: 'PENDING',
                foodHandleId: `${SCOPE}-handle`,
            });
        });
    });

    describe('counting an attempt on a failure', () => {
        it('⛔ lets exactly ONE of two concurrent attempts on the same read win — the other re-reads', async () => {
            const { failure } = await pendingFailure('attempt-race');
            const [first, second] = await Promise.all([
                dal.recordAttempt(failure, { kind: 'countAttempt' }),
                dal.recordAttempt(failure, { kind: 'countAttempt' }),
            ]);
            const { rows } = await pool.query<{ attempts: number }>(
                `SELECT attempts FROM unresolved_foods WHERE id = $1`,
                [failure.failure.unresolvedFoodId],
            );

            expect([first, second].filter((result) => result !== undefined)).toHaveLength(1);
            expect(rows[0]?.attempts).toBe(failure.failure.attempts + 1);
        });
    });

    describe('settling a shared failure', () => {
        it('moves EVERY line on the failure to the bound root, and deletes nothing', async () => {
            const name = `${SCOPE} settle`;
            const failure = await dal.recordFailure(
                failureOf({
                    name,
                    normalizedKey: name,
                    sourcePhrase: null,
                    cascade: exhausted,
                    food: { kind: 'answered', foodId: `${SCOPE}-settle-food`, status: 'PENDING' },
                }),
            );
            const recipeA = await makeRecipe('settle-a');
            const recipeB = await makeRecipe('settle-b', OWNER_B);

            await addLine(recipeA, failure.lookupId);
            await addLine(recipeB, failure.lookupId);

            const handle = resolvedHandleOf(failure, {
                kind: 'handle',
                foodId: `${SCOPE}-settle-food`,
                answer: { outcome: 'found', name: canonicalIngredientName(name), status: 'RESOLVED', isPrivate: false },
            });

            if (handle === undefined) {
                throw new Error('fixture handle refused');
            }

            const bound = await dal.findOrCreateBoundRoot(handle.admission);
            const moved = await dal.settleFailure(handle, bound);

            expect(moved).toBe(2);
            expect([await linesOn(bound.lookupId), await linesOn(failure.lookupId)]).toStrictEqual([2, 0]);
            // The failure record and its lookup survive: settling is a repoint, never a delete.
            expect((await dal.findByIds([failure.lookupId])).has(failure.lookupId)).toBe(true);
        });

        it('⛔ records where it settled the failure to, and takes the failure out of the retry read', async () => {
            const { failure, handle } = await pendingFailure('pointer');
            const bound = await dal.findOrCreateBoundRoot(handle.admission);

            await dal.settleFailure(handle, bound);

            const arm = (await dal.findByIds([failure.lookupId])).get(failure.lookupId);

            expect(arm?.kind === 'unresolved' ? arm.failure.settledLookupId : 'not unresolved').toBe(bound.lookupId);
            expect(await inRetryRead(failure.failure.unresolvedFoodId)).toBe(false);
        });

        it('⛔ a save that waits on a running settle stores its line on the bound root, never the failure', async () => {
            const { failure, handle } = await pendingFailure('race-settle-first');
            const bound = await dal.findOrCreateBoundRoot(handle.admission);
            const recipe = await makeRecipe('race-settle-first');
            const settler = await pool.connect();

            try {
                // The settle's own statements, held open: lock, point, move.
                await settler.query('BEGIN');
                await settler.query('SELECT id FROM unresolved_foods WHERE id = $1 FOR UPDATE', [
                    failure.failure.unresolvedFoodId,
                ]);
                await settler.query('UPDATE unresolved_foods SET settled_lookup_id = $1 WHERE id = $2', [
                    bound.lookupId,
                    failure.failure.unresolvedFoodId,
                ]);

                // A save planned before the settle, still naming the failure.
                const save = saveLine(recipe, failure.lookupId);

                expect(await settlesWithin(save, 300)).toBe(false);
                await settler.query('COMMIT');
                await save;
            } finally {
                settler.release();
            }

            expect([await linesOn(bound.lookupId), await linesOn(failure.lookupId)]).toStrictEqual([1, 0]);
        });

        it('⛔ a RE-save of a recipe already holding a line on the failure neither deadlocks with a settle nor keeps the line there', async () => {
            // The save deletes the recipe's lines, which locks a line the settle moves. Were that delete to run before
            // the save waits on the failure, each would hold a lock the other needs (40P01).
            const { failure, handle } = await pendingFailure('race-resave');
            const bound = await dal.findOrCreateBoundRoot(handle.admission);
            const recipe = await makeRecipe('race-resave');
            const settler = await pool.connect();

            await addLine(recipe, failure.lookupId);

            try {
                // `settleFailure`'s statements in its order, held open between steps.
                await settler.query('BEGIN');
                await settler.query('SELECT id FROM unresolved_foods WHERE id = $1 FOR UPDATE', [
                    failure.failure.unresolvedFoodId,
                ]);

                // The real save, which must wait before it touches the recipe's lines.
                const save = saveLine(recipe, failure.lookupId);

                expect(await settlesWithin(save, 300)).toBe(false);
                await settler.query('UPDATE ingredients SET food_lookup_id = $1 WHERE food_lookup_id = $2', [
                    bound.lookupId,
                    failure.lookupId,
                ]);
                await settler.query('UPDATE unresolved_foods SET settled_lookup_id = $1 WHERE id = $2', [
                    bound.lookupId,
                    failure.failure.unresolvedFoodId,
                ]);
                await settler.query('COMMIT');
                await save;
            } finally {
                settler.release();
            }

            expect([await linesOn(bound.lookupId), await linesOn(failure.lookupId)]).toStrictEqual([1, 0]);
        });

        it('⛔ a settle that waits on a running save moves the saved line too', async () => {
            const { failure, handle } = await pendingFailure('race-save-first');
            const bound = await dal.findOrCreateBoundRoot(handle.admission);
            const recipe = await makeRecipe('race-save-first');
            const saver = await pool.connect();

            try {
                // The save's own forward read and insert, held open.
                await saver.query('BEGIN');
                await saver.query('SELECT id FROM unresolved_foods WHERE id = $1 FOR SHARE', [
                    failure.failure.unresolvedFoodId,
                ]);
                await saver.query(`INSERT INTO ingredients (recipe_id, food_lookup_id, unit) VALUES ($1, $2, 'g')`, [
                    recipe,
                    failure.lookupId,
                ]);

                const settle = dal.settleFailure(handle, bound);

                expect(await settlesWithin(settle, 300)).toBe(false);
                await saver.query('COMMIT');
                expect(await settle).toBe(1);
            } finally {
                saver.release();
            }

            expect([await linesOn(bound.lookupId), await linesOn(failure.lookupId)]).toStrictEqual([1, 0]);
        });
    });

    describe('a settle is final', () => {
        it('⛔ a second settle, from a handle read before the first, changes nothing', async () => {
            const { failure, handle } = await pendingFailure('final-settle');
            const first = await dal.findOrCreateBoundRoot(handle.admission);
            const second = await dal.findOrCreateBoundRoot(admission(`${SCOPE}-final-settle-other`));
            const recipe = await makeRecipe('final-settle');

            await addLine(recipe, failure.lookupId);
            expect(await dal.settleFailure(handle, first)).toBe(1);

            // A concurrent poll that read the failure before the first settle holds a handle for it too.
            expect(await dal.settleFailure(handle, second)).toBe(0);

            const arm = (await dal.findByIds([failure.lookupId])).get(failure.lookupId);

            expect(arm?.kind === 'unresolved' ? arm.failure.settledLookupId : 'not unresolved').toBe(first.lookupId);
            expect([await linesOn(first.lookupId), await linesOn(second.lookupId)]).toStrictEqual([1, 0]);
        });

        it('⛔ records no attempt on a settled failure — its reason and count stay what the settle left', async () => {
            const { failure, handle } = await pendingFailure('final-attempt');

            await dal.settleFailure(handle, await dal.findOrCreateBoundRoot(handle.admission));

            const outage = failureOf({
                name: failure.failure.name,
                normalizedKey: failure.failure.normalizedKey,
                sourcePhrase: null,
                cascade: exhausted,
                food: { kind: 'unreachable', detail: 'food did not answer' },
            });
            const written = await dal.recordAttempt(failure, mergeAttempt(failure.failure, outage));
            const arm = (await dal.findByIds([failure.lookupId])).get(failure.lookupId);

            expect(written).toBeUndefined();
            expect(
                arm?.kind === 'unresolved' && { reason: arm.failure.reasonCode, attempts: arm.failure.attempts },
            ).toStrictEqual({ reason: failure.failure.reasonCode, attempts: failure.failure.attempts });
        });

        it('⛔ a later failure of the same phrase converges on the settled record without writing to it', async () => {
            const { failure, handle } = await pendingFailure('final-converge');
            const bound = await dal.findOrCreateBoundRoot(handle.admission);

            await dal.settleFailure(handle, bound);

            const again = await dal.recordFailure(
                failureOf({
                    name: failure.failure.name,
                    normalizedKey: failure.failure.normalizedKey,
                    sourcePhrase: null,
                    cascade: exhausted,
                    food: { kind: 'unreachable', detail: 'food did not answer' },
                }),
            );

            expect(again.lookupId).toBe(failure.lookupId);
            expect(again.failure).toMatchObject({
                settledLookupId: bound.lookupId,
                reasonCode: failure.failure.reasonCode,
                attempts: failure.failure.attempts,
            });
        });
    });

    describe('deleting an orphaned failure (R14)', () => {
        it('refuses while a line references it, and deletes the lookup and its record once none does', async () => {
            const name = `${SCOPE} orphan`;
            const failure = await dal.recordFailure(declaredFailure(name, name));
            const recipe = await makeRecipe('orphan');

            await addLine(recipe, failure.lookupId);

            expect(await dal.deleteIfOrphanedFailure(failure.lookupId)).toBe(false);
            expect((await dal.findByIds([failure.lookupId])).has(failure.lookupId)).toBe(true);

            await pool.query(`DELETE FROM recipes WHERE id = $1`, [recipe]);

            expect(await dal.deleteIfOrphanedFailure(failure.lookupId)).toBe(true);

            const { rows } = await pool.query(`SELECT id FROM unresolved_foods WHERE id = $1`, [
                failure.failure.unresolvedFoodId,
            ]);

            expect([(await dal.findByIds([failure.lookupId])).size, rows.length]).toStrictEqual([0, 0]);
        });

        it('never deletes a bound lookup', async () => {
            const bound = await dal.findOrCreateBoundRoot(admission(`${SCOPE}-keep`));

            expect(await dal.deleteIfOrphanedFailure(bound.lookupId)).toBe(false);
            expect((await dal.findByIds([bound.lookupId])).has(bound.lookupId)).toBe(true);
        });
    });

    describe('privacy of bound roots (R20)', () => {
        it('shows a private binding to its author only, and a shared one to everyone', async () => {
            await dal.findOrCreateBoundRoot(admission(`${SCOPE}-private`, OWNER_A));
            await dal.findOrCreateBoundRoot(admission(`${SCOPE}-shared`));
            const ids = [`${SCOPE}-private`, `${SCOPE}-shared`];

            expect([...(await dal.findBoundRootsByFoodIds(ids, OWNER_A)).keys()].sort()).toStrictEqual(ids.sort());
            expect([...(await dal.findBoundRootsByFoodIds(ids, OWNER_B)).keys()]).toStrictEqual([`${SCOPE}-shared`]);
            expect([...(await dal.findBoundRootsByFoodIds(ids, undefined)).keys()]).toStrictEqual([`${SCOPE}-shared`]);
        });
    });

    describe('which recipes reference a food (erasure protocol)', () => {
        it('counts live recipes only', async () => {
            const bound = await dal.findOrCreateBoundRoot(admission(`${SCOPE}-referenced`));
            const live = await makeRecipe('referenced-live');
            const deleted = await makeRecipe('referenced-deleted', OWNER_B);

            await addLine(live, bound.lookupId);
            await addLine(deleted, bound.lookupId);
            await pool.query(`UPDATE recipes SET deleted_at = now() WHERE id = $1`, [deleted]);

            expect(await dal.recipesReferencingFood(`${SCOPE}-referenced`)).toStrictEqual([
                { recipeId: live, ownerId: OWNER_A },
            ]);
            expect(await dal.referencedFoodIdsAmong([`${SCOPE}-referenced`, `${SCOPE}-unused`])).toStrictEqual([
                `${SCOPE}-referenced`,
            ]);
        });
    });
});
