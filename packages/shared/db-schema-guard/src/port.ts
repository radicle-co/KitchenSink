/**
 * The minimal database port the migration engine needs.
 *
 * ⛔ A STRUCTURAL PORT, not a `pg` import. This package is depended on by every service that touches a
 * schema and — from the boot-guard side — by code paths that have no business pulling a database driver in.
 * `pg.Pool` and `pg.PoolClient` satisfy these shapes as they stand, so the engine takes a real pool at every
 * call site without the package ever naming the driver.
 *
 * It is also what makes the engine testable without a database: the apply loop's ordering, its rollback and
 * its advisory-lock release are all asserted against a recording fake, and the real driver path is covered
 * by each service's own integration tier against Postgres.
 */

/** One statement's result — only the two fields the engine reads. */
export interface MigrationQueryResult<Row> {
    /** The returned rows. */
    readonly rows: Row[];
    /** The row count, which `pg` reports as `null` for statements that return none. */
    readonly rowCount: number | null;
}

/** A checked-out connection. */
export interface MigrationClient {
    /**
     * Execute one statement.
     *
     * @param sql - The statement text.
     * @param values - Bound parameters, when the statement is parameterized.
     * @returns The statement's result.
     */
    query<Row = never>(sql: string, values?: unknown[]): Promise<MigrationQueryResult<Row>>;
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
