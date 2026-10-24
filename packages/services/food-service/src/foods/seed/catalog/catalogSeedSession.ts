/**
 * The one connection the catalog seed runs on (curated catalog plan U6, KTD-1, KTD-2).
 *
 * @pattern Port — {@link CatalogSeedSession} is all the lock, the transaction and the apply know of a connection
 * @pattern Adapter over pg and pg-copy-streams — {@link pgSeedSession} binds the port to a connected client
 *
 * Every statement of a seed runs on ONE connection: a session advisory lock, its temp tables and its transaction all
 * belong to a backend, and a pool would scatter them. The port is a statement and a COPY, which is what a recording
 * fake needs to prove the order without a database.
 */
import type { Writable } from 'node:stream';

import type pg from 'pg';
import copyStreams from 'pg-copy-streams';

/**
 * One statement's result: the two fields the seed reads. A row is untyped here, and its reader parses the columns it
 * needs, so no caller asserts a shape the driver never checked.
 */
export interface SeedQueryResult {
    readonly rows: readonly Readonly<Record<string, unknown>>[];
    /** The rows the statement touched; `pg` reports `null` for a statement that touches none. */
    readonly rowCount: number | null;
}

/** The connection a seed runs on. */
export interface CatalogSeedSession {
    /**
     * Execute one statement.
     *
     * @param sql - The statement.
     * @param values - Bound parameters.
     * @returns Its rows and row count.
     */
    query(sql: string, values?: unknown[]): Promise<SeedQueryResult>;
    /**
     * Open a `COPY ... FROM STDIN`.
     *
     * @param sql - The COPY statement.
     * @returns Its writable end; the COPY ends when the stream finishes.
     */
    copyFrom(sql: string): Writable;
}

/**
 * The session a connected client offers.
 *
 * @param client - A connected client, never a pool.
 * @returns The session.
 */
export function pgSeedSession(client: pg.ClientBase): CatalogSeedSession {
    return {
        query: async (sql, values) => {
            const result = await client.query(sql, values);

            return { rows: result.rows, rowCount: result.rowCount };
        },
        copyFrom: (sql) => client.query(copyStreams.from(sql)),
    };
}
