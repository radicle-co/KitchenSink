/**
 * R20 — erasure's private-food step: the dead author's PRIVATE-food BINDINGS, against a REAL Postgres.
 *
 * `food_lookups.food_owner_id` marks the bindings that exist only because one author referenced their own
 * private food (the column arrived on `ingredients` in 0040 and moved with the re-grain in 0051). On that
 * author's erasure:
 *
 *   - an UNREFERENCED binding is DELETED — nothing needs it any more;
 *   - one a KEPT recipe still lines against is RETAINED, `food_owner_id` intact — the pseudonymous ULID
 *     beside a private food reference is the recipes/`owner_id` Recital-26 posture, and the retrieval
 *     filter hides it from every living caller regardless;
 *   - another author's private-food binding is UNTOUCHED, referenced or not.
 *
 * ⛔ A unit test over the emitted SQL cannot prove the `NOT EXISTS` boundary: whether a binding counts as
 * referenced is decided by the database against real `ingredients` LINE rows, AFTER the same
 * transaction's own recipe deletes — the ordering this suite pins by erasing an owner whose OWN recipe
 * was the only reference.
 *
 * ⚠️ Since 0051 the ordering is enforced by the schema as well as relied on here: `ingredients.
 * food_lookup_id` is `ON DELETE RESTRICT`, so a binding delete that ran before the recipe deletes would be
 * REFUSED rather than silently doing the wrong thing.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { eraseRecipeRows } from '../../../src/handlers/accountErasureWorker.js';
import { recipeWorkersDb } from '../roleDb.js';

/** The subject connects as `recipe_app` (ADR-0039): DML and nothing else, which is what the workers hold. */
const roleDb = recipeWorkersDb();
/** The cook whose account is erased. */
const USER_ERASED = '01JU11PFERASE00USERERASED0A';

/** A bystander cook whose recipe keeps one of the erased cook's foods referenced. */
const USER_BYSTANDER = '01JU11PFERASE00USERBYSTAND0';

/** The title this suite's probe recipes carry. Cleanup scopes on `owner_id` and {@link FOOD_ID_PREFIX}. */
const NAME_PREFIX = 'U11 pf-erasure probe';

/**
 * A distinctive `food_id` prefix — the scoping key since 0051.
 *
 * ⚠️ It used to be the catalog row's NAME. A binding carries none: the name of a food-arm binding lives in
 * the food service, which is the whole point of the re-grain, so the opaque id is the only local handle.
 */
const FOOD_ID_PREFIX = '01JU11PF';

describe("erasure's private-food step — bindings (R20)", () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = drizzle(pool);
    });

    afterEach(async () => {
        // Lines first: `food_lookup_id` is RESTRICT, so a binding cannot be deleted under one.
        await db.execute(sql`
            DELETE FROM ingredients WHERE food_lookup_id IN
                (SELECT id FROM food_lookups WHERE food_id LIKE ${FOOD_ID_PREFIX + '%'})
        `);
        await db.execute(sql`DELETE FROM recipes WHERE owner_id IN (${USER_ERASED}, ${USER_BYSTANDER})`);
        await db.execute(sql`DELETE FROM food_lookups WHERE food_id LIKE ${FOOD_ID_PREFIX + '%'}`);
        await db.execute(sql`DELETE FROM account_erasure_jobs WHERE owner_id IN (${USER_ERASED}, ${USER_BYSTANDER})`);
    });

    afterAll(async () => {
        await pool.end();
    });

    /**
     * Insert one private-food BINDING and return its id.
     *
     * ⛔ The ROOT arm, necessarily: a private authored food IS a root food — it has a `food_id` — and since
     * 0051 `food_lookups_captured_facts_need_a_root` refuses `food_owner_id` on any other arm, so neither the
     * variant arm nor the unresolved arm could express this row at all.
     */
    async function insertPrivateFoodBinding(ownerId: string): Promise<string> {
        const result = await db.execute<{ id: string }>(sql`
            INSERT INTO food_lookups (food_id, food_owner_id)
            VALUES (${FOOD_ID_PREFIX + Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(18, '0')},
                    ${ownerId})
            RETURNING id
        `);
        const id = result.rows[0]?.id;

        if (id === undefined) {
            throw new Error('test setup: the binding insert returned no id');
        }

        return id;
    }

    /** Insert a recipe for `ownerId` whose line references `foodLookupId`, and return the recipe id. */
    async function insertReferencingRecipe(ownerId: string, foodLookupId: string): Promise<string> {
        const recipe = await db.execute<{ id: string }>(sql`
            INSERT INTO recipes (owner_id, title, description, servings, prep_time_minutes, cook_time_minutes,
                                 total_time_minutes, visibility, status)
            VALUES (${ownerId}, ${NAME_PREFIX + ' recipe'}, 'probe', 2, 5, 5, 10, 'private', 'published')
            RETURNING id
        `);
        const recipeId = recipe.rows[0]?.id;

        if (recipeId === undefined) {
            throw new Error('test setup: the recipe insert returned no id');
        }

        await db.execute(sql`
            INSERT INTO ingredients (recipe_id, food_lookup_id, quantity, unit, sort_order)
            VALUES (${recipeId}, ${foodLookupId}, 1, 'cup', 0)
        `);

        return recipeId;
    }

    /** The surviving binding, or undefined. */
    async function bindingById(id: string): Promise<{ id: string; food_owner_id: string | null } | undefined> {
        const { rows } = await db.execute<{ id: string; food_owner_id: string | null }>(sql`
            SELECT id, food_owner_id FROM food_lookups WHERE id = ${id}
        `);

        return rows[0];
    }

    it('DELETES an unreferenced private-food binding — including one only the erased recipes referenced', async () => {
        const unreferenced = await insertPrivateFoodBinding(USER_ERASED);
        // Referenced ONLY by the erased cook's own recipe — the recipe delete runs first in the same
        // transaction, so by the private-food step this binding is unreferenced and must go too.
        const ownRecipeOnly = await insertPrivateFoodBinding(USER_ERASED);
        await insertReferencingRecipe(USER_ERASED, ownRecipeOnly);

        await eraseRecipeRows(db, USER_ERASED, []);

        expect(await bindingById(unreferenced)).toBeUndefined();
        expect(await bindingById(ownRecipeOnly)).toBeUndefined();
    });

    it('RETAINS a binding a surviving recipe still lines against, food_owner_id intact (pseudonymous)', async () => {
        const referenced = await insertPrivateFoodBinding(USER_ERASED);
        await insertReferencingRecipe(USER_BYSTANDER, referenced);

        await eraseRecipeRows(db, USER_ERASED, []);

        const survivor = await bindingById(referenced);

        expect(survivor).toBeDefined();
        // Retained WITH the ULID — the counter/reference posture, never a scrub. The retrieval filter is
        // what keeps it invisible; a dead author never searches again.
        expect(survivor?.food_owner_id).toBe(USER_ERASED);
    });

    it("leaves ANOTHER author's private-food binding untouched, referenced or not", async () => {
        const bystanders = await insertPrivateFoodBinding(USER_BYSTANDER);

        await eraseRecipeRows(db, USER_ERASED, []);

        expect((await bindingById(bystanders))?.food_owner_id).toBe(USER_BYSTANDER);
    });
});
