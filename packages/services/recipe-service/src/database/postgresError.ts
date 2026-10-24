/**
 * The one reader of the Postgres error behind what a Drizzle statement threw.
 *
 * Drizzle wraps the driver's error in a `DrizzleQueryError` whose `cause` is the `pg` `DatabaseError`. A DAL that
 * branches on a SQLSTATE, a constraint or Postgres's `detail` reads it through this function, so the unwrap and the
 * type check live once.
 */
import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';

/**
 * The Postgres error a statement threw, looked for on the error and then behind Drizzle's wrapper.
 *
 * @param error - What the statement threw.
 * @returns The driver's `DatabaseError`, or `undefined` for anything else. Pure.
 */
export function postgresErrorOf(error: unknown): DatabaseError | undefined {
    const cause = error instanceof DrizzleQueryError ? error.cause : error;

    return cause instanceof DatabaseError ? cause : undefined;
}
