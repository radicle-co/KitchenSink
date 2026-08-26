/**
 * The failure the food migration runner can raise when it cannot CLONE the seeded base database into a
 * per-PR one (U38).
 *
 * ⛔ Why this exists at all, when PostgreSQL already throws: the outcome that must never happen is a
 * per-PR database that exists and is EMPTY. Every silent-empty path starts with someone treating the
 * clone's failure as recoverable — catching it and creating the database anyway, "so the deploy can
 * proceed". It proceeds into a preview whose ingredient search reports `catalogAvailability:
 * 'unavailable'` behind entirely green checks, which is the failure ADR-0010 was written about. Naming
 * the failure, classifying the three ways it happens, and saying in the message what an operator must do
 * makes the loud path the obvious one and the swallow visibly wrong.
 */

/**
 * Why a clone was refused. Each is a DIFFERENT operator action, which is why they are distinguished:
 * a held template is waited out, an absent template is seeded, a privilege failure is granted.
 */
export type FoodDatabaseCloneFailure = 'template-in-use' | 'template-missing' | 'insufficient-privilege';

/** What an operator does about each refusal, carried in the message so the deploy log is self-contained. */
const REMEDY: Readonly<Record<FoodDatabaseCloneFailure, string>> = {
    'template-in-use':
        'PostgreSQL refuses to copy a database that any session is connected to. The base food database ' +
        'is expected to have none — no persistent non-prod food service runs against it. Find the holder ' +
        'with: SELECT pid, usename, application_name, client_addr FROM pg_stat_activity WHERE datname = ' +
        "'kitchensink_food'; then retry the deploy.",
    'template-missing':
        'The base food database does not exist, so there is nothing to clone. It is created by the ' +
        "platform DataStack's food bootstrap custom resource and seeded from the USDA bulk download " +
        '(see src/foods/seed/README.md). Deploy the platform stack and seed it before deploying a preview.',
    'insufficient-privilege':
        'Copying a non-template database requires CREATEDB plus ownership of the source. Confirm that ' +
        'food_app owns the base database, or mark it a template (ALTER DATABASE … IS_TEMPLATE true).',
};

/**
 * Thrown when `CREATE DATABASE … TEMPLATE` is refused. The deploy MUST fail on this — an empty per-PR
 * catalog passes every automated check and is only noticed by a person searching for an ingredient.
 */
export class FoodDatabaseCloneError extends Error {
    /** The per-PR database that was being created. */
    public readonly databaseName: string;
    /** The database it was being cloned from. */
    public readonly templateDatabase: string;
    /** The classified refusal. */
    public readonly reason: FoodDatabaseCloneFailure;

    /**
     * @param databaseName - The per-PR database being created.
     * @param templateDatabase - The base database being cloned.
     * @param reason - The classified refusal.
     * @param cause - The underlying `pg` error, preserved so the SQLSTATE survives into the deploy log.
     */
    public constructor(
        databaseName: string,
        templateDatabase: string,
        reason: FoodDatabaseCloneFailure,
        cause: unknown,
    ) {
        super(
            `Refusing to create "${databaseName}": could not clone "${templateDatabase}" (${reason}). ` +
                `${REMEDY[reason]} An empty per-PR catalog is NOT an acceptable fallback — it degrades ` +
                'every ingredient search in the preview to catalogAvailability: unavailable.',
            { cause },
        );
        this.name = 'FoodDatabaseCloneError';
        this.databaseName = databaseName;
        this.templateDatabase = templateDatabase;
        this.reason = reason;
        Object.setPrototypeOf(this, FoodDatabaseCloneError.prototype);
    }
}

/** Type guard for `FoodDatabaseCloneError`. */
export function isFoodDatabaseCloneError(error: unknown): error is FoodDatabaseCloneError {
    return error instanceof FoodDatabaseCloneError;
}
