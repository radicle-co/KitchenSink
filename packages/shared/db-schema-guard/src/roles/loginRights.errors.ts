/**
 * The refusal the migration runner raises when a database's rights do not hold after its ACL reset (curated catalog
 * plan U3). The checks are `loginRights.ts`'s, the same policy the platform bootstrap applies.
 */

/**
 * The migration runner re-read a database's rights after resetting its ACL, and a login role does not hold exactly its
 * rights. Thrown before the ledger or any migration, so a database a role cannot use is never migrated.
 */
export class DatabaseRightsUnmetError extends Error {
    /** The database whose rights are unmet. */
    public readonly database: string;
    /** Each unmet right, as `unmetPostconditions` words it. */
    public readonly unmet: readonly string[];

    public constructor(label: string, database: string, unmet: readonly string[]) {
        super(`[${label}] the database ACL reset left rights unmet on ${database}:\n  - ${unmet.join('\n  - ')}`);
        this.name = 'DatabaseRightsUnmetError';
        this.database = database;
        this.unmet = [...unmet];
        Object.setPrototypeOf(this, DatabaseRightsUnmetError.prototype);
    }
}

/**
 * Type guard for {@link DatabaseRightsUnmetError}.
 *
 * @param value - The candidate.
 * @returns `true` when `value` reports unmet database rights.
 */
export function isDatabaseRightsUnmetError(value: unknown): value is DatabaseRightsUnmetError {
    return value instanceof DatabaseRightsUnmetError;
}
