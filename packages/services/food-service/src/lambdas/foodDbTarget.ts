/**
 * The food database the two pipeline functions connect to (curated catalog plan U3).
 *
 * `FoodSchemaStack` gives the migration runner and the seed function the same three variables, from the same
 * `foodDatabaseName` (ADR-0006), so "which database" has one reading here and cannot differ between the two.
 */

import { parsePort } from '@kitchensink/rds-iam-auth';

/** Where a pipeline function connects. */
export interface FoodDbTarget {
    readonly host: string;
    readonly port: number;
    readonly database: string;
}

/**
 * Read a required variable.
 *
 * @param env - The environment.
 * @param name - The variable.
 * @returns Its value.
 * @throws {Error} when it is unset or empty.
 */
function required(env: Readonly<Record<string, string | undefined>>, name: string): string {
    const value = env[name];

    if (value === undefined || value === '') {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}

/**
 * Read the target from `FOOD_DB_ENDPOINT`, `FOOD_DB_PORT` and `FOOD_DB_NAME`. Pure.
 *
 * @param env - The environment; `process.env` in a handler.
 * @returns The host, the port and the database.
 * @throws {Error} naming a missing variable, or a port that is not 1 to 65535 written in digits.
 */
export function readFoodDbTarget(env: Readonly<Record<string, string | undefined>>): FoodDbTarget {
    const host = required(env, 'FOOD_DB_ENDPOINT');
    const port = parsePort(required(env, 'FOOD_DB_PORT'), 'FOOD_DB_PORT');
    const database = required(env, 'FOOD_DB_NAME');

    return { host, port, database };
}
