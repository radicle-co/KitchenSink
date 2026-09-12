/**
 * @module adminServer — which PostgreSQL SERVER the integration tiers may provision on, decided once.
 *
 * ## ⛔ Why a URL being set is not permission to destroy what it points at
 *
 * This reasoning is inherited verbatim from `recipe-workers`' `disposableDatabaseUrl.ts`, which this module
 * replaces. Integration suites recreate schemas, drop tables and delete rows — that is what the tier is for.
 * They used to read `DATABASE_URL`, with no test of where it pointed. But `DATABASE_URL` is the
 * APPLICATION's variable: `.env.development` sets it to the local sandbox's live recipe database, and a
 * tunnel sets it to a shared RDS. One `npm run test:integration` in a shell that had sourced either would
 * have dropped `verification_spend` — the live monthly spend ledger — and nothing in the suites could have
 * told.
 *
 * So the harness reads its own variable, `DATABASE_ADMIN_URL`, pointing at the SERVER's maintenance
 * database, and admits it only when the host is loopback. The second half of the old rule — the database
 * name must end in `_test` — moved with the thing it protects: it is now a precondition on every database
 * the fixture provisions (`roleDatabase`), because the admin URL names the maintenance database and the
 * disposable names are the ones the fixture creates.
 *
 * ## ⛔ Set-but-refused FAILS the run; absent SKIPS
 *
 * A skip is the quiet failure: `verificationSpend.integration.test.ts` once reported thirteen skips for a
 * whole tier because its `beforeAll` threw, so the spend ledger had zero executed coverage behind a green
 * run. A refused URL is a misconfiguration the developer must see.
 *
 * DESIGN PATTERN: Specification + evaluate — a pure {@link decideAdminServerUrl} over the environment, and
 * one impure reading of it ({@link adminServerUrl}), the repo's shape for every guard.
 */

/** Hosts that can only ever mean "this machine". */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** What the decision concluded about the environment. */
export type AdminServerDecision =
    | { readonly kind: 'absent' }
    | { readonly kind: 'usable'; readonly url: string }
    | { readonly kind: 'refused'; readonly url: string; readonly reason: string };

/** The one variable the decision reads. */
export interface AdminServerEnvironment {
    readonly DATABASE_ADMIN_URL?: string | undefined;
}

/** Raised when an admin server is named but refused. Matching guard: {@link isNonDisposableAdminServerError}. */
export class NonDisposableAdminServerError extends Error {
    public readonly url: string;

    public constructor(url: string, reason: string) {
        super(
            `refusing to provision integration databases on '${url}': ${reason}. Point DATABASE_ADMIN_URL at a ` +
                'THROWAWAY PostgreSQL on localhost, e.g. postgres://postgres:postgres@localhost:5432/postgres',
        );
        this.name = 'NonDisposableAdminServerError';
        this.url = url;
        Object.setPrototypeOf(this, NonDisposableAdminServerError.prototype);
    }
}

/**
 * Type guard for {@link NonDisposableAdminServerError}.
 *
 * @param error - Anything thrown.
 * @returns Whether it is the refusal.
 */
export function isNonDisposableAdminServerError(error: unknown): error is NonDisposableAdminServerError {
    return error instanceof NonDisposableAdminServerError;
}

/**
 * Decide whether the environment names a server this tier may provision on.
 *
 * @param env - The variable, as read from `process.env` (or a fake).
 * @returns Absent, usable with the URL, or refused with the reason. Pure.
 */
export function decideAdminServerUrl(env: AdminServerEnvironment): AdminServerDecision {
    const url = env.DATABASE_ADMIN_URL;

    if (url === undefined || url.length === 0) {
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

    if (parsed.pathname.replace(/^\//u, '').length === 0) {
        return { kind: 'refused', url, reason: 'it names no maintenance database' };
    }

    return { kind: 'usable', url };
}

/**
 * The server address, read from the environment.
 *
 * ⚠️ NOT exported from the package: a test file that could obtain this could connect as the superuser, which
 * is the whole thing the role split's integration tiers are moving away from.
 *
 * @returns The admin server URL.
 * @throws {NonDisposableAdminServerError} when one is set but refused, or when none is set at all.
 * @sideEffect Reads `process.env`.
 */
export function adminServerUrl(): string {
    const decision = decideAdminServerUrl({ DATABASE_ADMIN_URL: process.env['DATABASE_ADMIN_URL'] });

    switch (decision.kind) {
        case 'usable':
            return decision.url;
        case 'refused':
            throw new NonDisposableAdminServerError(decision.url, decision.reason);
        case 'absent':
            throw new NonDisposableAdminServerError(
                '<unset>',
                'DATABASE_ADMIN_URL is not set, so there is no server to provision on',
            );
    }
}

/**
 * Whether an admin server is configured at all — the flag every integration suite skips on
 * (`describe.skipIf(!hasAdminServer)`), so a machine with no PostgreSQL skips rather than fails.
 *
 * ⚠️ A REFUSED server is not absent: it stays `true` here so the run reaches {@link adminServerUrl} and
 * fails loudly, which is the whole point of the refusal.
 *
 * @sideEffect Reads `process.env` at module load.
 */
export const hasAdminServer: boolean =
    decideAdminServerUrl({
        DATABASE_ADMIN_URL: process.env['DATABASE_ADMIN_URL'],
    }).kind !== 'absent';
