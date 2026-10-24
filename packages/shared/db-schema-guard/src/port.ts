/**
 * The database ports this package's functions take — one family, narrowest first.
 *
 * ⛔ STRUCTURAL PORTS, not driver types. A caller passes a `pg.Pool`, a `pg.Client`, a checked-out `pg.PoolClient` or a
 * recording fake, and each function asks for the least it uses. That is what lets the apply loop's ordering, its
 * rollback and its lock release be asserted against a fake; the suites that run it against PostgreSQL cover the driver.
 *
 * The package does import `pg`, for its identifier and literal quoting (`escapeIdentifier`, `escapeLiteral`). It never
 * connects with it: every connection comes in through these ports.
 */

/** Runs one statement and reads nothing back — all a session lock needs. */
export interface StatementRunner {
    /**
     * Execute one statement.
     *
     * @param sql - The statement text.
     * @param values - Bound parameters, when the statement is parameterized.
     * @returns The driver's result, which the caller does not read.
     */
    query(sql: string, values?: unknown[]): Promise<unknown>;
}

/** Runs one statement and reads its rows. */
export interface CatalogReader extends StatementRunner {
    /**
     * Execute one statement.
     *
     * @param sql - The statement text.
     * @param values - Bound parameters, when the statement is parameterized.
     * @returns The returned rows.
     */
    query<Row>(sql: string, values?: unknown[]): Promise<{ readonly rows: Row[] }>;
}

/** A connection checked out of a pool for one migration run. */
export interface MigrationClient extends CatalogReader {
    /** Return the connection to its pool. */
    release(): void;
}

/** A pool that can check out a connection. */
export interface MigrationPool {
    /**
     * Check out a connection.
     *
     * @returns The checked-out client.
     */
    connect(): Promise<MigrationClient>;
}
