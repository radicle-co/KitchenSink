/**
 * A sibling database standing in for the RECIPE service's, for the two catalog-CLI suites (U12a/U12b).
 *
 * ## Why this is not the subject, and why it still gets the role model
 *
 * The catalog clear's safety property is a statement about TWO databases at once: it refuses to delete a
 * food row while the recipe service still links to one. The food service cannot import that workspace, so
 * these suites carry a recipe-SHAPED database of their own and hand its connection string to the CLI the
 * way an operator hands over `RECIPE_DATABASE_URL`.
 *
 * That fixture used to be made by the superuser — a `CREATE DATABASE` on the suite's own pool, and DDL and
 * `TRUNCATE` over the same connection. Under the role split (ADR-0039) the subject's pool is `food_app`,
 * which holds DML and nothing else: it cannot create a database at all. So the probe is provisioned the way
 * every other database here is — by the stand-in master, owned by `recipe_owner` — and the URL the CLI
 * receives is `recipe_app`'s, which is what a deployed operator would actually be given.
 *
 * ⚠️ The probe runs NO migrations (it is not the recipe schema; it is the three columns the linkage probe
 * reads), so the grants a migration run would have made are applied here from the SAME production
 * statements — `privilegesBeforeApply` — rather than hand-written. The default-privileges hook in that list
 * is what makes a table {@link RecipeProbeDatabase.asOwner} creates readable and writable by `recipe_app`.
 *
 * DESIGN PATTERN: Object Mother over the production privilege policy · Bracket (scoped elevation) —
 * `asOwner` acquires, `SET ROLE`s and `RESET ROLE`s in `finally`.
 */
import pg from 'pg';

import { DATABASE_ROLES, privilegesBeforeApply } from '@kitchensink/db-schema-guard';
import { provisionRdsLikeDatabase } from '@kitchensink/service-test-harness';

/** A recipe-shaped sibling database the suite owns. */
export interface RecipeProbeDatabase {
    /** The database's name. */
    readonly database: string;
    /** The connection an operator would supply to the CLI: `recipe_app`, DML only. */
    readonly appUrl: string;
    /** Run fixture work — DDL, and anything else DML cannot do — as the database's OWNER. */
    asOwner<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T>;
}

/**
 * Provision `database` under the recipe service's role model and open it to `recipe_app`.
 *
 * @param database - The probe database's name. Must end in `_test`: it is created and emptied freely.
 * @returns The handle.
 * @throws {Error} when the name is not disposable, or when no admin server is configured.
 * @sideEffect Creates roles and a database on the admin server, and executes privilege DDL as the owner.
 */
export async function provisionRecipeProbeDatabase(database: string): Promise<RecipeProbeDatabase> {
    if (!database.endsWith('_test')) {
        throw new Error(
            `refusing to provision '${database}' as a probe database: it does not end in '_test', so nothing ` +
                'marks it as throwaway.',
        );
    }

    const roles = DATABASE_ROLES.recipe;
    const provisioned = await provisionRdsLikeDatabase({ roles, database });

    const asOwner = async <T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
        const pool = new pg.Pool({ connectionString: provisioned.migratorUrl, max: 1 });

        try {
            const client = await pool.connect();

            try {
                await client.query(`SET ROLE "${roles.owner}"`);

                return await work(client);
            } finally {
                // Both in `finally`: a throw inside `work` must not leave the session acting as the owner.
                await client.query('RESET ROLE').catch(() => undefined);
                client.release();
            }
        } finally {
            await pool.end();
        }
    };

    await asOwner(async (client) => {
        for (const statement of privilegesBeforeApply(roles, database)) {
            await client.query(statement);
        }
    });

    return { database, appUrl: provisioned.appUrl, asOwner };
}
