/**
 * Every trigger function and rule function of the recipes schema pins its `search_path` (migration 0090), against a REAL
 * PostgreSQL.
 *
 * A guard that names `recipes` with no schema is resolved through the session's search path, and a session's temporary schema
 * comes first unless `pg_temp` is listed, so a role that may create temporary tables could shadow the table the guard reads.
 * The pin lives in each function's own `proconfig`, which only the catalog can show.
 *
 * The check covers EVERY function the schema owns, not a list of the ones written so far, so a new trigger or rule function
 * that leaves the pin out turns this red. The functions of migrations before 0086 are named in `UNPINNED_LEGACY` and that list
 * may only shrink. The detector is proved red with a temporary function, created in a transaction that rolls back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();

/** Trigger functions that predate the pin. A name leaves this list when its migration pins it; none may join. */
const UNPINNED_LEGACY: readonly string[] = [
    'analytics_events_fold',
    'ingredients_public_recipe_no_private_food',
    'recipe_holds_private_food',
    'recipe_private_food_lines',
    'recipe_ratings_aggregate_refresh',
    'recipes_first_published_at_ratchet',
    'recipes_public_holds_no_private_food',
    'recipes_search_vector_update',
];

/** The schema's own functions (extensions excluded) with no `search_path` in their settings, and the triggers that fire them. */
const UNPINNED_QUERY = `
    SELECT p.proname::text AS name,
           COALESCE((SELECT array_agg(DISTINCT t.tgname::text) FROM pg_trigger t
                      WHERE t.tgfoid = p.oid AND NOT t.tgisinternal), ARRAY[]::text[]) AS triggers
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
       AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS setting WHERE setting LIKE 'search_path=%')
     ORDER BY p.proname`;

describe('every function of the recipes schema pins its search_path (migration 0090)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterAll(async () => {
        await pool.end();
    });

    it('leaves no function unpinned apart from the named legacy ones', async () => {
        const { rows } = await pool.query<{ name: string }>(UNPINNED_QUERY);
        const unpinned = rows.map((row) => row.name).filter((name) => !UNPINNED_LEGACY.includes(name));

        expect(unpinned).toEqual([]);
    });

    it('still finds every legacy name, so the list cannot go stale', async () => {
        const { rows } = await pool.query<{ name: string }>(UNPINNED_QUERY);

        expect(rows.map((row) => row.name).sort()).toEqual([...UNPINNED_LEGACY].sort());
    });

    it('goes red for a trigger function and a rule function that leave the pin out', async () => {
        const found = await roleDb.asOwner(async (client) => {
            await client.query('BEGIN');

            try {
                await client.query(
                    `CREATE FUNCTION recipe_probe_unpinned_guard() RETURNS trigger AS $$ BEGIN RETURN NULL; END; $$ LANGUAGE plpgsql`,
                );
                await client.query(
                    `CREATE TRIGGER trg_probe_unpinned AFTER INSERT ON recipe_source_evidence
                         FOR EACH ROW EXECUTE FUNCTION recipe_probe_unpinned_guard()`,
                );
                await client.query(
                    `CREATE FUNCTION recipe_probe_unpinned_rule(p uuid) RETURNS boolean AS $$ SELECT true $$ LANGUAGE sql`,
                );
                await client.query(
                    `CREATE FUNCTION recipe_probe_pinned_rule(p uuid) RETURNS boolean AS $$ SELECT true $$ LANGUAGE sql
                         SET search_path = pg_catalog, public, pg_temp`,
                );

                return (await client.query<{ name: string; triggers: string[] }>(UNPINNED_QUERY)).rows.filter((row) =>
                    row.name.startsWith('recipe_probe_'),
                );
            } finally {
                await client.query('ROLLBACK');
            }
        });

        expect(found).toEqual([
            { name: 'recipe_probe_unpinned_guard', triggers: ['trg_probe_unpinned'] },
            { name: 'recipe_probe_unpinned_rule', triggers: [] },
        ]);
    });
});
