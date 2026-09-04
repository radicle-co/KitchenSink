/**
 * WHICH DATABASE THE INTEGRATION TIER MAY DESTROY — decided once, for every suite in this directory.
 *
 * DESIGN PATTERN: the decide/evaluate split this repo uses for every guard — a pure Specification
 * ({@link decideDatabaseUrl}) over the two environment variables, and one impure reading of it
 * ({@link disposableDatabaseUrl}) that every `*.integration.test.ts` calls at module load.
 *
 * ## ⛔ WHY A URL BEING SET IS NOT PERMISSION TO DROP TABLES IN IT
 *
 * Every suite here recreates schema, DROPs a table or DELETEs rows — that is what an integration tier is
 * for. They used to read `DATABASE_URL`, preferred over `TEST_DATABASE_URL`, with no test of where it
 * pointed. `DATABASE_URL` is the APPLICATION's connection variable: `.env.development` sets it to the local
 * sandbox's live recipe database, a tunnel sets it to a shared RDS. One `npm run test:integration` in a shell
 * that had sourced either would have dropped `verification_spend` — the live monthly spend ledger — and
 * deleted every erasure job row for the fixture owners. Nothing in the suites could have told.
 *
 * So a URL is admitted only when BOTH hold:
 *
 *  1. **the host is loopback** (`localhost`, `127.0.0.1`, `::1`) — a database this machine runs, never a
 *     tunnel's far end presenting as one is not something this can see, which is why (2) exists too;
 *  2. **the database name ends in `_test`** — the convention CI's `recipe_workers_test` already follows, and
 *     the one thing a `.env` pointed at a real database will never satisfy by accident.
 *
 * `TEST_DATABASE_URL` is read FIRST: when both are set, the variable whose name says "test" is the one a
 * developer meant for this tier. Absent both, the suites skip in lockstep exactly as before.
 *
 * ## ⛔ SET-BUT-REFUSED FAILS THE RUN; IT DOES NOT SKIP
 *
 * A skip is the quiet failure. `verificationSpend.integration.test.ts` once reported thirteen SKIPs for a
 * whole tier because its `beforeAll` threw — the spend ledger had zero executed coverage and every run was
 * green. A refused URL is a misconfiguration the developer must see, so {@link disposableDatabaseUrl} throws
 * at import and the file fails to load. The message names the URL and the rule it broke.
 */

/** The suffix a disposable database's name must carry. CI's `recipe_workers_test` is the model. */
export const DISPOSABLE_DATABASE_NAME_SUFFIX = '_test';

/** Hosts that can only ever mean "this machine". */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** What the guard concluded about the environment. */
export type DatabaseUrlDecision =
    | { readonly kind: 'absent' }
    | { readonly kind: 'disposable'; readonly url: string }
    | { readonly kind: 'refused'; readonly url: string; readonly reason: string };

/** The two variables the decision reads. */
export interface DatabaseUrlEnvironment {
    readonly TEST_DATABASE_URL?: string | undefined;
    readonly DATABASE_URL?: string | undefined;
}

/**
 * Raised when a database URL is set but does not name a disposable database. Matching guard:
 * {@link isNonDisposableDatabaseError}.
 */
export class NonDisposableDatabaseError extends Error {
    public readonly url: string;

    public constructor(url: string, reason: string) {
        super(
            `refusing to run the recipe-workers integration tier against '${url}': ${reason}. ` +
                `Point TEST_DATABASE_URL (or DATABASE_URL) at a THROWAWAY database on localhost whose name ends in ` +
                `'${DISPOSABLE_DATABASE_NAME_SUFFIX}', e.g. postgresql://postgres:postgres@localhost:5432/recipe_workers_test`,
        );
        this.name = 'NonDisposableDatabaseError';
        this.url = url;
        Object.setPrototypeOf(this, NonDisposableDatabaseError.prototype);
    }
}

/** Type guard for {@link NonDisposableDatabaseError}. */
export function isNonDisposableDatabaseError(error: unknown): error is NonDisposableDatabaseError {
    return error instanceof NonDisposableDatabaseError;
}

/**
 * Decide whether the environment names a database this tier may destroy.
 *
 * @param env - The two variables, as read from `process.env` (or a fake).
 * @returns Absent, disposable with the URL to use, or refused with the reason. Pure.
 */
export function decideDatabaseUrl(env: DatabaseUrlEnvironment): DatabaseUrlDecision {
    const url = firstSet(env.TEST_DATABASE_URL, env.DATABASE_URL);

    if (url === undefined) {
        return { kind: 'absent' };
    }

    let parsed: URL;

    try {
        parsed = new URL(url);
    } catch {
        return { kind: 'refused', url, reason: 'it is not a parseable URL' };
    }

    if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
        return { kind: 'refused', url, reason: `its host '${parsed.hostname}' is not loopback` };
    }

    const name = parsed.pathname.replace(/^\//u, '');

    if (name.length === 0) {
        return { kind: 'refused', url, reason: 'it names no database' };
    }

    if (!name.endsWith(DISPOSABLE_DATABASE_NAME_SUFFIX)) {
        return {
            kind: 'refused',
            url,
            reason: `its database '${name}' does not end in '${DISPOSABLE_DATABASE_NAME_SUFFIX}'`,
        };
    }

    return { kind: 'disposable', url };
}

/**
 * Read the environment and hand back a URL this tier may destroy, or nothing.
 *
 * @returns The URL, or `undefined` when neither variable is set (the suites then skip in lockstep).
 * @throws {NonDisposableDatabaseError} When a URL is set but refused — the suite must FAIL, not skip.
 * @sideEffect Reads `process.env`.
 */
export function disposableDatabaseUrl(): string | undefined {
    const decision = decideDatabaseUrl({
        TEST_DATABASE_URL: process.env['TEST_DATABASE_URL'],
        DATABASE_URL: process.env['DATABASE_URL'],
    });

    switch (decision.kind) {
        case 'absent':
            return undefined;
        case 'disposable':
            return decision.url;
        case 'refused':
            throw new NonDisposableDatabaseError(decision.url, decision.reason);
    }
}

/** The first non-empty value, or `undefined`. An empty string is "unset" — it is what `.env` templates leave. */
function firstSet(...values: readonly (string | undefined)[]): string | undefined {
    return values.find((value) => value !== undefined && value.length > 0);
}
