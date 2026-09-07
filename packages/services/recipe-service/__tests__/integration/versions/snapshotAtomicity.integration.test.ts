/**
 * ⛔ A RECIPE MUST NOT SAVE WITHOUT ITS VERSION ROW (FR-007b, owner ruling 2026-09-06).
 *
 * `RecipesService.recordSnapshot` awaited the snapshot write but wrapped it in a `try/catch` that
 * SWALLOWED the failure, with the reasoning that "the recipe has already committed, so a snapshot
 * failure must NOT fail the user's save". The consequence is a recipe that exists with a hole in its
 * history, and nothing anywhere says so — the only trace is a `console.error`.
 *
 * The owner's ruling is that this is not acceptable: if the version cannot be recorded, the save failed.
 *
 * ⚠️ WHY THE FIX IS A TRANSACTION AND NOT AN UNSWALLOWED THROW. Removing the `catch` alone makes it
 * WORSE: the recipe row is already committed by the time the snapshot runs, so the caller would receive
 * a 5xx for a recipe that exists — a save reported as failed that actually succeeded, which is the same
 * lie in the opposite direction. Atomicity is the only shape that makes the reported outcome true.
 *
 * ## How the failure is induced
 *
 * A BEFORE INSERT trigger on `recipe_versions` that raises. Deliberately NOT a mock or a stubbed DAL:
 * the thing under test is whether the two writes share a transaction, and a test that replaces one of
 * the writes cannot observe that. This is a real insert, failing for a real database reason, on the real
 * path — and the trigger is dropped again in `afterAll` whatever happens.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { DrizzleProvider } from '../../../src/database/database.module.js';
import type { RecipeDrizzle } from '../../../src/database/client.js';
import { recipes, recipeVersions } from '../../../src/database/schema/index.js';

/** The dev-bypass owner ULID this suite saves as. */
const OWNER = '01JVERSIONS0ATOMIC000000CC';

/** A distinctive title, so the assertion can look for THIS save rather than counting rows. */
const TITLE = 'Atomicity Probe Recipe';

const CREATE_PAYLOAD = {
    title: TITLE,
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [
        { ingredientId: '00000000-0000-4000-8000-0000000000cc', name: 'Water', quantity: { kind: 'exact', value: 1 } },
    ],
    steps: [{ instruction: 'Boil.' }],
};

describe.skipIf(!hasDatabaseUrl)('a recipe save and its version row are atomic (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let db: RecipeDrizzle;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        db = booted.app.get<RecipeDrizzle>(DrizzleProvider);
    });

    afterEach(async () => {
        await db.execute(sql`DROP TRIGGER IF EXISTS atomicity_probe ON recipe_versions`);
        await db.execute(sql`DROP TRIGGER IF EXISTS atomicity_probe_outbox ON recipe_version_pending_archives`);
    });

    afterAll(async () => {
        await db.execute(sql`DROP TRIGGER IF EXISTS atomicity_probe ON recipe_versions`);
        await db.execute(sql`DROP FUNCTION IF EXISTS atomicity_probe_raise()`);
        await booted.close();
    });

    /** Make every `recipe_versions` insert fail, the way a constraint or a dropped column would. */
    async function breakVersionInserts(): Promise<void> {
        await db.execute(sql`
            CREATE OR REPLACE FUNCTION atomicity_probe_raise() RETURNS trigger AS $$
            BEGIN RAISE EXCEPTION 'atomicity probe: recipe_versions insert refused'; END;
            $$ LANGUAGE plpgsql`);
        await db.execute(sql`
            CREATE TRIGGER atomicity_probe BEFORE INSERT ON recipe_versions
            FOR EACH ROW EXECUTE FUNCTION atomicity_probe_raise()`);
    }

    /** Every recipe this suite's payload would have created. */
    async function savedProbes(): Promise<readonly { readonly id: string }[]> {
        return db.select({ id: recipes.id }).from(recipes).where(eq(recipes.title, TITLE));
    }

    it('is not vacuous: the save succeeds and records a version when nothing is broken', async () => {
        // Guards the assertion below — if a create could never succeed here, "no recipe row" would be
        // trivially true and would prove nothing about atomicity.
        const response = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(CREATE_PAYLOAD),
        });

        expect(response.status).toBe(201);

        const created = (await response.json()) as { readonly id: string };
        const versions = await db.select().from(recipeVersions).where(eq(recipeVersions.recipeId, created.id));

        expect(versions).toHaveLength(1);
    });

    it('⛔ leaves an UPDATE untouched when its version row cannot be written', async () => {
        // A 5xx alone would not prove this: without a shared transaction the content update commits and
        // only the version row fails, leaving a silently-edited recipe behind an error response.
        const createRes = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...CREATE_PAYLOAD, title: `${TITLE} (update case)` }),
        });
        expect(createRes.status).toBe(201);

        const created = (await createRes.json()) as { readonly id: string; readonly currentVersion: number };

        await breakVersionInserts();

        const patchRes = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedVersion: created.currentVersion, title: 'Should Not Persist' }),
        });

        expect(patchRes.status).toBeGreaterThanOrEqual(500);

        const [row] = await db
            .select({ title: recipes.title, currentVersion: recipes.currentVersion })
            .from(recipes)
            .where(eq(recipes.id, created.id));

        expect(row?.title, 'the title changed despite the failure').toBe(`${TITLE} (update case)`);
        expect(row?.currentVersion, 'the version was bumped despite the failure').toBe(created.currentVersion);
    });

    it('⛔ persists NO clone when its version row cannot be written', async () => {
        const sourceRes = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...CREATE_PAYLOAD, title: `${TITLE} (clone source)`, visibility: 'public' }),
        });
        expect(sourceRes.status).toBe(201);

        const source = (await sourceRes.json()) as { readonly id: string };
        const before = await db.select({ id: recipes.id }).from(recipes);

        await breakVersionInserts();

        const cloneRes = await fetch(`${baseUrl}/api/v1/recipes/${source.id}/clone`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        });

        expect(cloneRes.status).toBeGreaterThanOrEqual(500);
        expect(await db.select({ id: recipes.id }).from(recipes), 'a clone survived the failure').toHaveLength(
            before.length,
        );
    });

    it('⛔ persists NO recipe when the ARCHIVE OUTBOX row cannot be written', async () => {
        // The outbox records that a version owes S3 an archive write. Its insert joins the same
        // transaction, so this is the assertion that `enforceRetention` actually enlisted rather than
        // merely being called — nothing else in this file distinguishes the two.
        const before = await savedProbes();

        await db.execute(sql`
            CREATE OR REPLACE FUNCTION atomicity_probe_raise() RETURNS trigger AS $$
            BEGIN RAISE EXCEPTION 'atomicity probe: outbox insert refused'; END;
            $$ LANGUAGE plpgsql`);
        await db.execute(sql`
            CREATE TRIGGER atomicity_probe_outbox BEFORE INSERT ON recipe_version_pending_archives
            FOR EACH ROW EXECUTE FUNCTION atomicity_probe_raise()`);

        try {
            // Eleven versions puts one past the retention window, so the save writes an outbox row.
            const createRes = await fetch(`${baseUrl}/api/v1/recipes`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(CREATE_PAYLOAD),
            });
            const created = (await createRes.json()) as { readonly id: string; readonly currentVersion: number };
            let version = created.currentVersion;

            for (let n = 0; n < 11; n += 1) {
                const res = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ expectedVersion: version, title: `${TITLE} v${version}` }),
                });

                if (res.status >= 500) {
                    // The outbox refusal took the whole save with it, which is the assertion.
                    const [row] = await db
                        .select({ currentVersion: recipes.currentVersion })
                        .from(recipes)
                        .where(eq(recipes.id, created.id));

                    expect(row?.currentVersion, 'the save committed despite the outbox refusal').toBe(version);

                    return;
                }

                version = ((await res.json()) as { readonly currentVersion: number }).currentVersion;
            }

            expect.fail('retention never reached the outbox — the probe proved nothing');
        } finally {
            await db.execute(sql`DROP TRIGGER IF EXISTS atomicity_probe_outbox ON recipe_version_pending_archives`);
            expect(before.length).toBeGreaterThanOrEqual(0);
        }
    });

    it('⛔ persists NO recipe when the version row cannot be written', async () => {
        const before = await savedProbes();

        await breakVersionInserts();

        const response = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(CREATE_PAYLOAD),
        });

        // The save must FAIL. Today it answers 201 and the recipe is saved with no version — the defect.
        expect(response.status, 'the save reported success while its version row was refused').toBeGreaterThanOrEqual(
            500,
        );

        // ⛔ AND THE ROW MUST BE GONE. This is the half a thrown error alone does not give: the recipe
        // is written before the snapshot runs, so an unswallowed throw yields a 5xx over a COMMITTED
        // recipe. Only a shared transaction makes the reported failure true.
        expect(await savedProbes(), 'a recipe was persisted despite its version row being refused').toStrictEqual(
            before,
        );
    });
});
