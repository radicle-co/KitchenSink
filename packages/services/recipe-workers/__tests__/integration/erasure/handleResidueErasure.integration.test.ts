/**
 * ONE RULE FOR HANDLES: every denormalized copy of an erased user's DISPLAY HANDLE becomes the pseudonym,
 * wherever in the schema it sits (owner ruling 2026-08-25).
 *
 * ## The defect this suite was written from
 *
 * `recipes.author_handle` was pseudonymized on erasure and two sibling copies of the same datum were not.
 * `collections.source_owner_handle` (migration 0016) is the clone-provenance freeze — **it lives on SOMEBODY
 * ELSE'S ROW**: when B clones A's collection, B's row records A's handle. Erasure's collection statement is
 * `DELETE FROM collections WHERE owner_id = $1`, which reaches A's OWN collections and cannot, by
 * construction, reach a copy of A's handle sitting on B's. `recipe_versions.editor_handle` (migration 0015)
 * is the same datum one table over, and a KEPT (truly-public or donated) recipe's version rows survive the
 * erasure carrying it in cleartext.
 *
 * So the same string — a person's name as other people read it — was destroyed in one table and left intact
 * in two others, behind a fully-green suite. That is the shape `erasureSweepCoverage.test.ts` exists for, and
 * it could not see this one either: it reasoned per TABLE, and `collections` IS swept.
 *
 * ## ⛔ Why this tier, and why the unit assertion next door cannot stand in for it
 *
 * `accountErasureWorker.test.ts` drives the sweep over a `FakeDb` and pins the SQL it emits. That proves a
 * statement exists; it cannot prove the statement REACHES the row. Four things only a real database answers,
 * and each is a way this ruling could be honoured in the source and broken in fact:
 *
 *  1. **The clone's provenance pointer must still be there when the sweep runs.** `source_collection_id` is
 *     `ON DELETE SET NULL`, and the erasure's own `DELETE FROM collections` fires it. The handle sweep keys
 *     on that pointer, so it is correct ONLY if it runs BEFORE the delete — an ordering a fake db renders
 *     invisible, because a fake db has no foreign keys.
 *  2. **The clone must SURVIVE with its provenance degraded rather than deleted.** "No cleartext remains" is
 *     satisfied just as well by destroying B's collection, which would be a bystander losing their data over
 *     someone else's erasure request.
 *  3. **The two tables must agree about WHO the person was.** A second pseudonym scheme would leave a kept
 *     recipe and a clone of that person's collection naming two different strangers.
 *  4. **Nothing keyed on the handle VALUE.** Handles are `profiles.displayName` — NOT unique. A sweep keyed
 *     on the string would rewrite a bystander's provenance for an unrelated user who happens to share a
 *     display name, replacing a true record with a false one. Only real rows can prove it did not.
 *
 * ⚠️ Every case pins the cleartext PRESENT before erasing, so no assertion here can pass on a fixture that
 * was never written.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pseudonymizedAuthorHandle } from '@kitchensink/recipe-core';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { eraseRecipeRows } from '../../../src/handlers/accountErasureWorker.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const canRun = Boolean(DATABASE_URL);

/** The owner who exercises the right to erasure. */
const OWNER_A = '01JHANDLERESIDUE0000OWNERA0';

/** The bystander who cloned A's collection — their row is where A's handle actually sits. */
const OWNER_B = '01JHANDLERESIDUE0000OWNERB0';

/**
 * A THIRD owner who is not erased and whose display handle is IDENTICAL to A's.
 *
 * ⛔ The guard against the unsound repair. `author_handles.display_name` is identity's `profiles.displayName`
 * — a display name, with no uniqueness constraint anywhere — so a sweep keyed on the handle STRING would
 * rewrite this owner's provenance too, asserting that B's clone of C's collection came from A. That is a
 * false record manufactured by the fix, which is strictly worse than the residue it removes.
 */
const OWNER_C = '01JHANDLERESIDUE0000OWNERC0';

/**
 * The cleartext display name A and C share, unique to this suite so the schema-wide scan below can attribute
 * any hit to this fixture and not to another suite's rows.
 */
const CLEARTEXT_HANDLE = 'Alice Aubergine a63081';

/** One `collections` row as this suite reads it back. */
type CollectionRow = {
    readonly id: string;
    readonly owner_id: string;
    readonly name: string;
    readonly source_collection_id: string | null;
    readonly source_owner_handle: string | null;
    readonly source_collection_name: string | null;
};

/** One `table.column` that holds free text, discovered from the live catalog. */
type TextColumnRow = {
    readonly table_name: string;
    readonly column_name: string;
};

/** A count projection. A `type`, for the implicit index signature drizzle's `execute<T>` requires. */
type CountRow = {
    readonly count: number;
};

describe.skipIf(!canRun)('account erasure pseudonymizes every denormalized handle (owner ruling 2026-08-25)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = drizzle(pool);
    });

    afterEach(async () => {
        // Clones first: `source_collection_id` is SET NULL rather than CASCADE, so order is not forced by the
        // schema — but deleting the sources first would silently orphan the clones instead of removing them.
        await db.execute(sql`DELETE FROM collections WHERE owner_id IN (${OWNER_A}, ${OWNER_B}, ${OWNER_C})`);
        await db.execute(sql`DELETE FROM recipes WHERE owner_id IN (${OWNER_A}, ${OWNER_B}, ${OWNER_C})`);
        await db.execute(sql`DELETE FROM author_handles WHERE user_id IN (${OWNER_A}, ${OWNER_B}, ${OWNER_C})`);
        await db.execute(sql`DELETE FROM account_erasure_jobs WHERE owner_id IN (${OWNER_A}, ${OWNER_B}, ${OWNER_C})`);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Insert one collection and return its id. */
    async function insertCollection(
        ownerId: string,
        name: string,
        visibility: 'public' | 'private' = 'public',
    ): Promise<string> {
        const result = await db.execute<{ id: string }>(sql`
            INSERT INTO collections (owner_id, name, visibility)
            VALUES (${ownerId}, ${name}, ${visibility})
            RETURNING id
        `);

        return result.rows[0]!.id;
    }

    /**
     * Insert the row `CollectionsService.cloneCollection` writes: a PRIVATE collection owned by the cloner,
     * pointing at the source and carrying the source owner's handle + the source's name, both frozen.
     */
    async function insertClone(
        clonerId: string,
        sourceId: string,
        sourceOwnerHandle: string,
        sourceCollectionName: string,
    ): Promise<string> {
        const result = await db.execute<{ id: string }>(sql`
            INSERT INTO collections
                (owner_id, name, visibility, source_collection_id, source_owner_handle, source_collection_name)
            VALUES (${clonerId}, ${sourceCollectionName}, 'private', ${sourceId},
                    ${sourceOwnerHandle}, ${sourceCollectionName})
            RETURNING id
        `);

        return result.rows[0]!.id;
    }

    /** Insert one TRULY-PUBLIC recipe (so erasure KEEPS it) carrying a cleartext author handle. */
    async function insertKeptRecipe(ownerId: string, title: string, authorHandle: string): Promise<string> {
        const result = await db.execute<{ id: string }>(sql`
            INSERT INTO recipes
                (owner_id, title, servings, prep_time_minutes, cook_time_minutes, total_time_minutes,
                 visibility, status, author_handle)
            VALUES (${ownerId}, ${title}, 2, 5, 10, 15, 'public', 'published', ${authorHandle})
            RETURNING id
        `);

        return result.rows[0]!.id;
    }

    /** Read one collection back by id, or `undefined` when it is gone. */
    async function readCollection(id: string): Promise<CollectionRow | undefined> {
        const result = await db.execute<CollectionRow>(sql`
            SELECT id, owner_id, name, source_collection_id, source_owner_handle, source_collection_name
            FROM collections WHERE id = ${id}
        `);

        return result.rows[0];
    }

    /**
     * Every `schema.table.column` in the recipe database whose CURRENT contents contain the given string.
     *
     * ⛔ DISCOVERED from `information_schema`, never enumerated. A hand-written list of the columns to check
     * is a list of the columns somebody already thought of, which is exactly how the third copy of this datum
     * stayed hidden — so the scan asks the live catalog for every free-text and `jsonb` column and reads them
     * all. A handle column added by a migration tomorrow is covered the day it lands.
     *
     * Identifiers go through `sql.identifier` (quoted, embedded quotes doubled) because SQL has no parameter
     * form for an identifier; the search VALUE stays bound.
     *
     * @param value - The exact cleartext to hunt for.
     * @returns The `table.column` locations that still hold it, sorted.
     * @sideEffect Reads every text-ish column of the test database.
     */
    async function locationsHolding(value: string): Promise<readonly string[]> {
        const { rows: columns } = await db.execute<TextColumnRow>(sql`
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND data_type IN ('text', 'character varying', 'jsonb')
            ORDER BY table_name, column_name
        `);
        const hits: string[] = [];

        for (const { table_name: table, column_name: column } of columns) {
            const found = await db.execute<CountRow>(sql`
                SELECT count(*)::int AS count FROM ${sql.identifier(table)}
                WHERE ${sql.identifier(column)}::text LIKE ${`%${value}%`}
            `);

            if ((found.rows[0]?.count ?? 0) > 0) {
                hits.push(`${table}.${column}`);
            }
        }

        return hits.sort();
    }

    it('⛔ leaves the cleartext handle NOWHERE in the schema — a scan, not a checklist', async () => {
        const sourceId = await insertCollection(OWNER_A, 'Aubergine Staples');

        await insertClone(OWNER_B, sourceId, CLEARTEXT_HANDLE, 'Aubergine Staples');
        await insertKeptRecipe(OWNER_A, 'Kept Public', CLEARTEXT_HANDLE);
        await db.execute(sql`
            INSERT INTO author_handles (user_id, display_name, source_timestamp)
            VALUES (${OWNER_A}, ${CLEARTEXT_HANDLE}, now())
        `);

        // The POSITIVE first: the cleartext really is in all three places, so the negative below is a claim
        // about rows that exist. Sorted, and asserted EXACTLY — a superset would mean the fixture drifted.
        expect(await locationsHolding(CLEARTEXT_HANDLE)).toEqual([
            'author_handles.display_name',
            'collections.source_owner_handle',
            'recipes.author_handle',
        ]);

        await eraseRecipeRows(db, OWNER_A, []);

        expect(await locationsHolding(CLEARTEXT_HANDLE)).toEqual([]);
    });

    it('degrades a clone’s provenance to the pseudonym instead of deleting the bystander’s collection', async () => {
        const sourceId = await insertCollection(OWNER_A, 'Aubergine Staples');
        const cloneId = await insertClone(OWNER_B, sourceId, CLEARTEXT_HANDLE, 'Aubergine Staples');

        const before = await readCollection(cloneId);

        // ⚠️ Narrowed, never optional-chained: `expect(before?.x)` passes vacuously on a missing row, which is
        // the one thing every assertion below depends on NOT being true.
        if (before === undefined) {
            throw new Error('test setup: the clone was not inserted');
        }

        expect(before.source_owner_handle).toBe(CLEARTEXT_HANDLE);
        expect(before.source_collection_id).toBe(sourceId);

        await eraseRecipeRows(db, OWNER_A, []);

        const after = await readCollection(cloneId);

        if (after === undefined) {
            throw new Error('the bystander’s clone was DELETED by another owner’s erasure');
        }

        // The accepted cost, stated by the owner: provenance degrades to "cloned from a deleted account".
        expect(after.source_owner_handle).toBe(pseudonymizedAuthorHandle(OWNER_A));
        // The clone itself is untouched: still B's, still named, and the collection NAME it was cloned from
        // survives — that is authored content, not identity, and erasure keeps a kept recipe's title too.
        expect(after.owner_id).toBe(OWNER_B);
        expect(after.source_collection_name).toBe('Aubergine Staples');
        // A's own collection is gone, so the FK has nulled the pointer — the handle sweep therefore had to run
        // BEFORE the delete, and this is the assertion that pins that ordering.
        expect(after.source_collection_id).toBeNull();
    });

    it('writes the SAME pseudonym in recipes.author_handle and collections.source_owner_handle', async () => {
        const sourceId = await insertCollection(OWNER_A, 'Aubergine Staples');
        const cloneId = await insertClone(OWNER_B, sourceId, CLEARTEXT_HANDLE, 'Aubergine Staples');
        const keptId = await insertKeptRecipe(OWNER_A, 'Kept Public', CLEARTEXT_HANDLE);

        await eraseRecipeRows(db, OWNER_A, []);

        const clone = await readCollection(cloneId);
        const recipe = await db.execute<{ author_handle: string | null }>(
            sql`SELECT author_handle FROM recipes WHERE id = ${keptId}`,
        );
        const recipeHandle = recipe.rows[0]?.author_handle;

        if (clone === undefined || recipeHandle === undefined || recipeHandle === null) {
            throw new Error('the kept recipe or the clone did not survive the erasure');
        }

        // ⛔ ONE derivation, not two. A second scheme would leave a kept recipe and a clone of the same
        // person's collection naming two different strangers, and nothing else in the system would notice.
        expect(clone.source_owner_handle).toBe(recipeHandle);
        expect(recipeHandle).toBe(pseudonymizedAuthorHandle(OWNER_A));
    });

    it('⛔ scrubs a SURVIVING recipe’s version editor handle — the same datum, one table over', async () => {
        const keptId = await insertKeptRecipe(OWNER_A, 'Kept Public', CLEARTEXT_HANDLE);

        await db.execute(sql`
            INSERT INTO recipe_versions (recipe_id, version_number, snapshot, created_by, editor_handle)
            VALUES (${keptId}, 1, ${JSON.stringify({ version: 1 })}::jsonb, ${OWNER_A}, ${CLEARTEXT_HANDLE})
        `);

        const before = await db.execute<CountRow>(
            sql`SELECT count(*)::int AS count FROM recipe_versions WHERE editor_handle = ${CLEARTEXT_HANDLE}`,
        );

        expect(before.rows[0]?.count).toBe(1);

        await eraseRecipeRows(db, OWNER_A, []);

        // The recipe is KEPT (truly public), so its versions are NOT swept away by the cascade — which is
        // precisely why the cleartext survived here while `recipes.author_handle` next door was scrubbed.
        const after = await db.execute<{ editor_handle: string | null }>(
            sql`SELECT editor_handle FROM recipe_versions WHERE recipe_id = ${keptId} ORDER BY version_number`,
        );

        expect(after.rows.map((row) => row.editor_handle)).toEqual([pseudonymizedAuthorHandle(OWNER_A)]);
    });

    it('⛔ leaves a bystander’s clone of a DIFFERENT owner who shares the same display name alone', async () => {
        const aSource = await insertCollection(OWNER_A, 'Aubergine Staples');
        const cSource = await insertCollection(OWNER_C, 'Courgette Staples');
        const cloneOfA = await insertClone(OWNER_B, aSource, CLEARTEXT_HANDLE, 'Aubergine Staples');
        const cloneOfC = await insertClone(OWNER_B, cSource, CLEARTEXT_HANDLE, 'Courgette Staples');

        await eraseRecipeRows(db, OWNER_A, []);

        const fromA = await readCollection(cloneOfA);
        const fromC = await readCollection(cloneOfC);

        if (fromA === undefined || fromC === undefined) {
            throw new Error('a clone did not survive the erasure');
        }

        expect(fromA.source_owner_handle).toBe(pseudonymizedAuthorHandle(OWNER_A));
        // ⛔ C was not erased. A sweep keyed on the handle STRING would have rewritten this row too and
        // asserted that B cloned it from A — a false provenance record manufactured by the repair.
        expect(fromC.source_owner_handle).toBe(CLEARTEXT_HANDLE);
        expect(fromC.source_collection_id).toBe(cSource);
    });
});
