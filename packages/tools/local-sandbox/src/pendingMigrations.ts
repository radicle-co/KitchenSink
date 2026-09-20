/**
 * @module pendingMigrations — which migration files a database still owes.
 *
 * ⛔ `local:up` HAS TO BE RE-RUNNABLE. `local:down` preserves the postgres volume on purpose (`down` without
 * `-v`), so the second run meets a database that already has the schema. Applying every file every time
 * worked exactly once per volume and then failed on the first statement:
 *
 *     migration FAILED kitchensink_food_dev 0000_food_schema.sql
 *     ERROR:  type "food_status" already exists
 *
 * The deployed runner (ADR-0022's in-stack Trigger) records what it applied and skips it next time. This is
 * the same rule, against the same table name, so local and deployed behaviour are one rule rather than two
 * that happen to agree.
 */

/** The table the applied set is recorded in — the name the deployed runner uses. */
export const MIGRATION_TABLE = 'schema_migrations';

/**
 * The files still to apply, in order.
 *
 * @param files - Every migration filename found for the database, already sorted.
 * @param applied - The filenames already recorded as applied.
 * @returns The subset of `files` not yet applied, in the order given. Pure.
 */
export function pendingMigrations(files: readonly string[], applied: readonly string[]): readonly string[] {
    const done = new Set(applied);

    return files.filter((file) => !done.has(file));
}
