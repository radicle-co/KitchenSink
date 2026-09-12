/**
 * The failure the food migration runner raises when it may not create a per-PR database (curated catalog plan U7).
 *
 * A per-PR database is created empty from `template0` and filled by the seed step that follows the migration. With
 * `template0` as the template, the only refusal an operator can act on is a missing privilege: `template0` refuses
 * connections, so no session can hold it, and it always exists. Any other failure propagates untouched.
 */

/** What an operator does about the refusal, carried in the message so the deploy log is self-contained. */
const REMEDY =
    'The food migrator needs CREATEDB to create a per-PR database. The platform bootstrap grants it on ' +
    'non-production stages, so deploy the global stack for this stage first, then re-run the migration.';

/** The migration runner could not create a per-PR food database because its role lacks the privilege. */
export class FoodDatabaseCreateError extends Error {
    /** The per-PR database that could not be created. */
    public readonly databaseName: string;

    /**
     * @param databaseName - The per-PR database being created.
     * @param cause - The underlying PostgreSQL error, so the deploy log keeps the SQLSTATE.
     */
    public constructor(databaseName: string, cause: unknown) {
        super(`Could not create ${databaseName} (insufficient privilege). ${REMEDY}`, { cause });
        this.name = 'FoodDatabaseCreateError';
        this.databaseName = databaseName;
        Object.setPrototypeOf(this, FoodDatabaseCreateError.prototype);
    }
}

/**
 * Type guard for {@link FoodDatabaseCreateError}.
 *
 * @param value - The candidate.
 * @returns `true` when `value` is a refused per-PR database creation.
 */
export function isFoodDatabaseCreateError(value: unknown): value is FoodDatabaseCreateError {
    return value instanceof FoodDatabaseCreateError;
}
