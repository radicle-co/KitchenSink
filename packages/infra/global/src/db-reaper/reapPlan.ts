/**
 * @module db-reaper/reapPlan — what a reaper invocation is asking for, and what it would do about it.
 *
 * Every function here is PURE. The reaper's only impure surface is one `SELECT` and, in drop mode, one
 * `DROP DATABASE` per planned name — so the whole decision, including the one that authorises destruction,
 * is decided before anything touches the database and is testable without one.
 *
 * ## The default is COUNT, and that is a safety property
 *
 * ADR-0031's first job is a CENSUS: nobody can currently count the per-PR databases stranded on the shared
 * sandbox instance, because the Phase 0 inventory rides on the `DataStack` bootstrap custom resources and
 * CloudFormation only re-invokes those when their PROPERTIES change — a sandbox global deploy on 2026-09-04
 * left both bootstrap Lambdas with no log streams at all. Counting therefore has to be invocable on demand,
 * and the shape that makes that safe is a default of `count`: an empty payload, a retry that lost its body,
 * or a hand-typed `aws lambda invoke` must all count rather than drop.
 *
 * ## Why the payload is parsed by hand rather than with zod
 *
 * The library-first default applies, and this is a deliberate exception with a concrete reason: the only
 * security-relevant validation in this payload is the `pr-{N}` token, which is not a shape question at all —
 * it is `isPerPrToken`, a predicate with its own module and its own adversarial suite. What is left is two
 * optional string fields, and a schema for that would add a runtime dependency to a bundled Lambda in
 * exchange for a `typeof` check, while moving the boundary that matters away from the module that owns it.
 *
 * DESIGN PATTERN: parse, don't validate — {@link parseReapRequest} turns an unknown payload into a
 * {@link ReapRequest} whose `drop` inhabitant cannot exist without a well-formed token, so no later code has
 * to re-ask whether the token is present.
 */
import {
    isPerPrToken,
    isReapablePerPrDatabase,
    perPrDatabaseNamesFor,
    perPrTokenOfDatabase,
} from './perPrDatabaseScope.js';

/** One row of the reaper's catalogue read, as `pg_database` returns it. */
export interface PerPrDatabaseCatalogRow {
    /** The database name. */
    readonly datname: string;
    /** PostgreSQL's connection limit. `-2` marks a database that is already mid-`DROP`. */
    readonly datconnlimit: number;
}

/** What an invocation is asking for. `count` reads; `drop` reclaims exactly one PR's databases. */
export type ReapAction = 'count' | 'drop';

/**
 * A parsed, well-formed request.
 *
 * `pr` is present iff `action` is `drop`, and when present it has already passed {@link isPerPrToken}.
 */
export type ReapRequest = { readonly action: 'count' } | { readonly action: 'drop'; readonly pr: string };

/** Raised when an invocation payload is not something this reaper will act on. */
export class ReapRequestError extends Error {
    public constructor(reason: string) {
        super(
            `Refusing this reaper invocation: ${reason}. Valid payloads are {} or {"action":"count"} for a ` +
                'census that drops nothing, and {"action":"drop","pr":"pr-{N}"} to reclaim one PR.',
        );
        this.name = 'ReapRequestError';
        Object.setPrototypeOf(this, ReapRequestError.prototype);
    }
}

/** Type guard for {@link ReapRequestError}. */
export function isReapRequestError(error: unknown): error is ReapRequestError {
    return error instanceof ReapRequestError;
}

/**
 * Turn an invocation payload into a request this reaper will act on, or refuse it.
 *
 * ⛔ An absent or empty payload is a COUNT — see the module docstring. An unknown `action` is a REFUSAL
 * rather than a fallback to the default: a caller that asked for something unimplemented got no answer, and
 * silently counting instead would report success for a teardown that reclaimed nothing.
 *
 * @param event - The raw Lambda event.
 * @returns The parsed request.
 * @throws {ReapRequestError} on any payload that is not exactly one of the two valid shapes.
 */
export function parseReapRequest(event: unknown): ReapRequest {
    if (event === undefined || event === null) {
        return { action: 'count' };
    }

    if (typeof event !== 'object' || Array.isArray(event)) {
        throw new ReapRequestError(`the payload is a ${Array.isArray(event) ? 'array' : typeof event}, not an object`);
    }

    const { action = 'count', pr } = event as { action?: unknown; pr?: unknown };

    if (action === 'count') {
        if (pr !== undefined) {
            // A `pr` here would read as "count this PR's databases", which is not what a count does — it
            // reports the WHOLE instance, because the number worth having is the stranded total.
            throw new ReapRequestError('a count reports the whole instance and takes no `pr`');
        }

        return { action: 'count' };
    }

    if (action !== 'drop') {
        throw new ReapRequestError(`\`action\` was ${JSON.stringify(action)}, which is neither "count" nor "drop"`);
    }

    if (typeof pr !== 'string' || !isPerPrToken(pr)) {
        throw new ReapRequestError(
            `a drop needs \`pr\` to be exactly \`pr-{digits}\`; got ${JSON.stringify(pr ?? null)}`,
        );
    }

    return { action: 'drop', pr };
}

/** What one census run found across the whole shared instance. */
export interface PerPrDatabaseCensus {
    /** How many per-PR databases exist in total — the number the pg18 runbook §A4 asks for. */
    readonly total: number;
    /** Every per-PR database, grouped under the PR token that owns it, each list sorted. */
    readonly byToken: Readonly<Record<string, readonly string[]>>;
    /** The subset PostgreSQL has already marked for deletion (`datconnlimit = -2`), sorted. */
    readonly draining: readonly string[];
    /**
     * Suffixed databases under a per-PR base that belong to NO pr token — `kitchensink_recipes_dev` and the
     * like. Reported rather than hidden: silence would make a census read as "everything is accounted for".
     */
    readonly unrecognized: readonly string[];
}

/**
 * Group a catalogue read into the census the reaper reports.
 *
 * ⚠️ `draining` is split out rather than counted with the rest for the reason `summarizePerPrDatabases`
 * gives: `datconnlimit = -2` means PostgreSQL is already dropping that database, the pg18 runbook halts an
 * upgrade precheck on exactly these, and reporting one as an ordinary leak sends an operator to drop a
 * database that is already going away.
 *
 * @param rows - The catalogue rows, in any order.
 * @returns The census, every list sorted so successive runs are diffable. Pure.
 */
export function censusOfPerPrDatabases(rows: readonly PerPrDatabaseCatalogRow[]): PerPrDatabaseCensus {
    const byToken: Record<string, string[]> = {};
    const unrecognized: string[] = [];
    let total = 0;

    for (const { datname } of [...rows].sort((left, right) => left.datname.localeCompare(right.datname))) {
        const token = perPrTokenOfDatabase(datname);

        if (token === null) {
            unrecognized.push(datname);
            continue;
        }

        (byToken[token] ??= []).push(datname);
        total += 1;
    }

    return {
        total,
        byToken,
        draining: rows
            .filter((row) => row.datconnlimit === -2 && perPrTokenOfDatabase(row.datname) !== null)
            .map((row) => row.datname)
            .sort(),
        unrecognized,
    };
}

/** A census, plus exactly what a drop would remove and what it found already gone. */
export interface ReapPlan {
    /** The whole-instance census, reported on every invocation whatever the action. */
    readonly census: PerPrDatabaseCensus;
    /** The databases to drop, sorted. Always empty for a count. */
    readonly drop: readonly string[];
    /** Names this PR could own that are not present — so "already reclaimed" is distinguishable. */
    readonly absent: readonly string[];
}

/**
 * Decide what one invocation will do, from the catalogue it read.
 *
 * ⛔ Every name in {@link ReapPlan.drop} has passed {@link isReapablePerPrDatabase}. That is not the last
 * word: `executeReap` re-runs the same verdict immediately before quoting each name into SQL, because a
 * predicate that regressed must fail at the destruction site rather than one call earlier.
 *
 * @param rows - The catalogue rows.
 * @param request - A request that has already been through {@link parseReapRequest}.
 * @returns The plan. Pure.
 */
export function planReap(rows: readonly PerPrDatabaseCatalogRow[], request: ReapRequest): ReapPlan {
    const census = censusOfPerPrDatabases(rows);

    if (request.action === 'count') {
        return { census, drop: [], absent: [] };
    }

    const present = new Set(rows.map((row) => row.datname));
    const candidates = perPrDatabaseNamesFor(request.pr);

    return {
        census,
        drop: candidates.filter((name) => present.has(name) && isReapablePerPrDatabase(request.pr, name)).sort(),
        absent: candidates.filter((name) => !present.has(name)).sort(),
    };
}
