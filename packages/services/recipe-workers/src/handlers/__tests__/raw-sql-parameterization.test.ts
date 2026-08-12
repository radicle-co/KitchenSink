/**
 * The sweepers' staleness/lookback windows must travel as BOUND PARAMETERS, not as spliced statement text.
 *
 * Both queries were written as `interval '${sql.raw(STALE_AFTER)}'`. Neither was exploitable — the arguments
 * are module-level constants — but `sql.raw` is the one drizzle construct that bypasses parameterisation, so
 * the safety was a property of the CALLER rather than of the query. Nothing in the build would have noticed the
 * day one of those constants became a configuration value read from the environment, or a field off an SQS
 * message. These tests assert the property directly, at the layer where it is decided: the rendered statement
 * carries a placeholder and the window is in `params`.
 *
 * The mutation these are built to catch: reverting either query to the `sql.raw` form moves the window OUT of
 * `params` and INTO the SQL text, which reds both assertions in the relevant case (the placeholder disappears
 * and the literal appears). Asserting only "the statement mentions 15 minutes" would have passed against BOTH
 * forms and proven nothing — which is precisely the trap this file exists to avoid.
 *
 * `$n::interval` is not a cosmetic change either. It is strictly SAFER than a spliced literal, because a value
 * Postgres cannot read as an interval is REJECTED AT THE CAST rather than parsed as SQL — verified against a
 * live PostgreSQL 16: `SELECT now() - $1::interval` with `'1 hour''; DROP TABLE t; --'` answers
 * `ERROR: invalid input syntax for type interval`, and `now() - $1::interval` with `'15 minutes'` is `=` to
 * `now() - interval '15 minutes'`.
 */
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { claimStaleErasureJobs } from '../erasure-sweeper.js';
import { readRecentlyCompletedOwners } from '../erasure-orphan-sweeper.js';

/** The rendered form of a drizzle statement: the SQL text actually sent, and the parameters bound to it. */
interface Rendered {
    readonly sql: string;
    readonly params: readonly unknown[];
}

/**
 * Run `read` against a db double that captures the statement, and render that statement the way the driver
 * would.
 *
 * Rendering through drizzle's own {@link PgDialect} rather than inspecting `queryChunks` is deliberate: it is
 * the same translation the production driver performs, so "is this a parameter?" is answered by the thing that
 * decides it, not by a test's model of it.
 *
 * @param read - The DAL function under test.
 * @returns The rendered statement.
 */
async function render(read: (db: NodePgDatabase<Record<string, never>>) => Promise<unknown>): Promise<Rendered> {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const db = { execute } as unknown as NodePgDatabase<Record<string, never>>;

    await read(db);

    const statement = execute.mock.calls[0]?.[0] as SQL;
    const query = new PgDialect().sqlToQuery(statement);

    return { sql: query.sql, params: query.params };
}

describe('sweeper time windows are bound parameters, never spliced SQL', () => {
    it('binds the erasure sweeper staleness window instead of splicing it', async () => {
        const { sql, params } = await render(claimStaleErasureJobs);

        // The window is DATA...
        expect(params).toContain('15 minutes');
        // ...and the statement asks for it by placeholder, cast to interval by Postgres.
        expect(sql).toMatch(/now\(\)\s*-\s*\$\d+::interval/);
        // ...and the literal is nowhere in the text. This is the half that reds on a revert to `sql.raw`.
        expect(sql).not.toContain('15 minutes');
        expect(sql).not.toMatch(/interval\s*'/);
    });

    it('binds the orphan sweeper completed-lookback window instead of splicing it', async () => {
        const { sql, params } = await render(readRecentlyCompletedOwners);

        expect(params).toContain('24 hours');
        expect(sql).toMatch(/now\(\)\s*-\s*\$\d+::interval/);
        expect(sql).not.toContain('24 hours');
        expect(sql).not.toMatch(/interval\s*'/);
    });

    it('still bounds each sweep with its batch cap, also as a parameter', async () => {
        // Guards against "parameterised the interval, dropped the LIMIT": an unbounded sweep is its own
        // availability problem, and the batch cap is what keeps one tick from claiming the whole table.
        for (const read of [claimStaleErasureJobs, readRecentlyCompletedOwners]) {
            const { sql, params } = await render(read);

            expect(sql).toMatch(/LIMIT\s+\$\d+/);
            expect(params).toContain(100);
        }
    });
});
