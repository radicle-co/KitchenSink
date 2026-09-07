/**
 * @module db-bootstrap/perPrInventory — a census of the per-PR logical databases on the shared instance.
 *
 * ## The gap this fills
 *
 * ADR-0006 gives every preview its own LOGICAL database on the ONE shared instance —
 * `kitchensink_food_pr_{N}`, `kitchensink_recipes_pr_{N}`. ADR-0005's teardown is supposed to drop it when
 * the PR closes. For half of them it never did: `teardown-sandbox-pr.sh` hardcoded food's migration-runner
 * output, so every reaped RECIPE preview left its database behind. Nothing noticed, because a leaked logical
 * database emits no signal — no alarm, no failing check, and a cost too small to appear in a monthly total.
 * It is the same invisible-leak shape as the DELETE_FAILED stacks and the dangling preview CNAMEs.
 *
 * The teardown defect is fixed. This module answers the question the fix cannot: **how many were already
 * left behind, and does the number stop growing?** `docs/runbooks/pg18-upgrade.md` §A4 asks an operator to
 * run precisely this query by hand before a major upgrade — because a dump-and-restore window scales with
 * the NUMBER of databases and objects, not with bytes — and until now nothing ever ran it.
 *
 * ## Why it is emitted from the DB bootstrap and not from a new resource
 *
 * The obvious shape is a scheduled reaper Lambda with master credentials. That is a one-way door (a
 * standing `DROP DATABASE` capability) and it is not what a census needs. The two bootstrap handlers
 * already: connect as the MASTER user, sit inside the VPC (an ADR-0004 NAT consumer, already enumerated),
 * read `pg_database`, and run on every `DataStack` deploy. Emitting the census from there costs a new
 * function, no new IAM grant, no new NAT consumer, and no ADR-0004 amendment.
 *
 * ## ⛔ It reports; it never fails
 *
 * This is observability attached to a resource whose job is provisioning. A census that threw would let an
 * unrelated catalogue read block every `DataStack` deploy — so {@link reportPerPrDatabases} swallows its own
 * failure and warns. That is the deliberate opposite of `assertBootstrapPostconditions`, which exists
 * precisely to fail the deploy that ran it. Do not "make it consistent" with its neighbour: they are
 * different kinds of statement about the world.
 *
 * DESIGN PATTERN: pure formatter + thin impure reader — the pattern-building and the summarising are total
 * functions, so the only impure surface is one parameterised `SELECT`.
 */
import type pg from 'pg';

/** One row of the census, as `pg_database` returns it. */
export interface PerPrDatabaseRow {
    /** The database name. */
    readonly datname: string;
    /** PostgreSQL's connection limit. `-2` marks a database that is mid-`DROP`. */
    readonly datconnlimit: number;
}

/** What a census run found for one base database. */
export interface PerPrDatabaseSummary {
    /** The shared base database whose per-PR children were counted, e.g. `kitchensink_food`. */
    readonly base: string;
    /** How many per-PR databases exist under {@link base}. */
    readonly count: number;
    /** Their names, sorted, so two runs are diffable. */
    readonly databases: readonly string[];
    /** The subset PostgreSQL has already marked for deletion (`datconnlimit = -2`). */
    readonly draining: readonly string[];
}

/** PostgreSQL's LIKE metacharacters, plus the escape character itself. */
const LIKE_METACHARACTERS = /[\\%_]/g;

/**
 * The `LIKE` pattern matching every per-PR database under one base name.
 *
 * ⚠️ The base name is ESCAPED, not interpolated. `_` is a single-character wildcard in `LIKE`, so the
 * obvious `` `${base}_%` `` reads `kitchensink_food_%` as "kitchensink, any character, food, any character,
 * anything" — which matches names this census has no business claiming. `%` and `\` are escaped for the same
 * reason one step further out: the escape must be a property of this function rather than a coincidence of
 * the two base names that happen to call it today.
 *
 * @param base - The shared base database name, e.g. `kitchensink_food`.
 * @returns A `LIKE … ESCAPE '\'` pattern matching `base` followed by a non-empty suffix. Pure.
 */
export function perPrLikePattern(base: string): string {
    return `${base.replace(LIKE_METACHARACTERS, (character) => `\\${character}`)}\\_%`;
}

/**
 * Reduce the census rows to the summary that gets logged.
 *
 * `draining` is split out rather than counted with the rest because `datconnlimit = -2` means PostgreSQL is
 * already dropping that database. The pg18 runbook (§A3) makes an operator hunt for exactly these, since
 * they HALT an upgrade precheck — and reporting one as an ordinary leak would send someone to drop a
 * database that is already going away.
 *
 * @param base - The base database the rows were selected under.
 * @param rows - The catalogue rows, in any order.
 * @returns The summary, with names sorted so successive runs are diffable. Pure.
 */
export function summarizePerPrDatabases(base: string, rows: readonly PerPrDatabaseRow[]): PerPrDatabaseSummary {
    const databases = rows.map((row) => row.datname).sort();
    const draining = rows
        .filter((row) => row.datconnlimit === -2)
        .map((row) => row.datname)
        .sort();

    return { base, count: databases.length, databases, draining };
}

/**
 * Emit ONE structured log line describing the per-PR databases currently under `base`.
 *
 * ⛔ Never throws. A census is not a postcondition: a failure here means the deploy learned nothing, not that
 * the deploy is wrong. Turning it into an assertion would let an unrelated catalogue read block every
 * `DataStack` deploy — see the module docstring.
 *
 * @param pool - A pool connected as the MASTER user (the bootstrap's own).
 * @param base - The shared base database name, e.g. `kitchensink_food`.
 * @sideEffect Reads `pg_database` and writes to stdout/stderr.
 */
export async function reportPerPrDatabases(pool: pg.Pool, base: string): Promise<void> {
    try {
        // ESCAPE is stated rather than relied upon: backslash IS the default, but a default is a
        // setting-shaped assumption and this pattern is the census's entire basis.
        const result = await pool.query<PerPrDatabaseRow>(
            "SELECT datname, datconnlimit FROM pg_database WHERE datname LIKE $1 ESCAPE '\\'",
            [perPrLikePattern(base)],
        );

        console.log(
            JSON.stringify({
                message: 'per-PR logical database census (ADR-0006)',
                ...summarizePerPrDatabases(base, result.rows),
            }),
        );
    } catch (error) {
        console.warn(
            `per-PR database census failed for base "${base}" — the deploy is unaffected, but nothing was ` +
                `learned about leaked pr-{N} databases (pg_database read): ${String(error)}`,
        );
    }
}
