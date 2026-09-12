/**
 * @module db-bootstrap/adoptEmpty — is a master-owned database EMPTY, so that it can be re-owned instead of dropped?
 *
 * PERMANENT, unlike the legacy recreate. RDS creates the instance's `databaseName` (`kitchensink_identity`) for the
 * master when a stage is born, so every new stage starts with an empty, master-owned identity database. Re-owning
 * it to `identity_owner` (`ALTER DATABASE … OWNER TO`) destroys nothing — which is why `decideDisposition` prefers it
 * to a drop whenever it applies, even while the recreate is armed.
 *
 * ⚠️ The emptiness check CONNECTS INTO the database, which is only possible while the master owns it: once it is
 * re-owned and closed to PUBLIC, prod's master (SET-only on the owner) cannot connect at all. So it is measured
 * BEFORE the adopt, and there is no second look.
 */
import type { CatalogReader } from '@kitchensink/db-schema-guard';

/** What the database holds besides PostgreSQL's own objects. */
export interface Emptiness {
    readonly empty: boolean;
    readonly relations: number;
    readonly functions: number;
    readonly types: number;
    readonly extensions: number;
    readonly schemas: number;
}

/** The system and PostgreSQL-owned namespaces every database has. */
const SYSTEM_SCHEMA = `n.nspname IN ('pg_catalog', 'information_schema') OR n.nspname LIKE 'pg\\_%'`;

/**
 * Count the user objects in the connected database. Anything a migration or a person could have created counts:
 * relations, functions, standalone types, extensions beyond `plpgsql`, and schemas beyond `public`.
 *
 * @param connection - A connection INTO the database, as its owner (the master).
 * @returns The counts, and whether all are zero.
 * @sideEffect Reads the database's catalogs.
 */
export async function measureEmptiness(connection: CatalogReader): Promise<Emptiness> {
    const [row] = (
        await connection.query<Omit<Emptiness, 'empty'>>(
            `SELECT (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE NOT (${SYSTEM_SCHEMA})) AS relations,
                    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE NOT (${SYSTEM_SCHEMA})) AS functions,
                    (SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                      WHERE NOT (${SYSTEM_SCHEMA}) AND t.typrelid = 0 AND t.typelem = 0) AS types,
                    (SELECT count(*)::int FROM pg_extension WHERE extname <> 'plpgsql') AS extensions,
                    (SELECT count(*)::int FROM pg_namespace n WHERE NOT (${SYSTEM_SCHEMA}) AND n.nspname <> 'public') AS schemas`,
        )
    ).rows;

    const counts = row ?? { relations: -1, functions: -1, types: -1, extensions: -1, schemas: -1 };

    return {
        ...counts,
        empty: Object.values(counts).every((count) => count === 0),
    };
}
