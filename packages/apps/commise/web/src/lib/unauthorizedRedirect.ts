/**
 * @module lib/unauthorizedRedirect — the ONE authoritative 401 → sign-in recovery for the web app.
 *
 * **Pattern: Circuit Breaker** (Release It!) over a full-document redirect. The bounce to sign-in is a
 * recovery *attempt*, and like any retry it needs a trip condition — otherwise a 401 the sign-in round trip
 * cannot fix becomes an infinite navigation loop.
 *
 * ## The incident this exists to make impossible (production, 2026-08-07)
 *
 * Production's bundle was built against the SANDBOX Clerk dev instance
 * (`pk_test_…` → `nice-fowl-6.clerk.accounts.dev`) while `NEXT_PUBLIC_IDENTITY_API_URL` pointed at the
 * PRODUCTION identity service. Prod identity verifies networklessly against the `clerk.commise.app` public
 * key — a different RSA modulus — so every minted token failed signature verification and
 * `GET /api/v1/users/me` answered `401` for as long as the misconfiguration stood.
 *
 * Both 401 handlers then navigated, unconditionally, to
 * `/sign-in?redirect_url=<current path>`. The visitor's Clerk session was VALID client-side, so
 * `<SignIn forceRedirectUrl={`/${locale}`}>` immediately sent them back — Home re-mounted, re-fetched,
 * 401'd, bounced. `/en` ⇄ `/en/sign-in?redirect_url=%2Fen`, forever, with no error ever surfaced.
 *
 * ## The rule
 *
 * A bounce to sign-in can only fix ONE class of 401: "this browser has no usable session". It can never fix
 * a 401 that survives the round trip — a wrong-instance token, a rotated verification key, an `azp`
 * mismatch, clock skew, a service misconfiguration. So the breaker allows **one** bounce per originating
 * path per browsing session; after that the `ApiError` propagates to the caller's error boundary, where the
 * viewer sees a failure they can act on instead of a spinning address bar.
 *
 * The marker lives in `sessionStorage` because the bounce is a FULL-DOCUMENT navigation
 * (`window.location.assign`): module state does not survive it, which is exactly why the previous code could
 * not distinguish hop 1 from hop 100. It is the LIST of originating paths already bounced from — a list, not
 * a slot, because "once per path" cannot be kept in one slot: `/en` bounces, `/en/profile` bounces and
 * overwrites it, `/en` 401s again and is a fresh bounce. Keyed per path so one stuck surface does not disable
 * recovery for every other route.
 *
 * There is deliberately **no** automatic reset on a later success. A stale marker degrades one surface to an
 * error notice; a cleared marker re-arms the loop. Fail safe. {@link resetUnauthorizedRecovery} is the
 * explicit seam for a future "authorization restored" signal.
 */
import { withBasePath } from '@/lib/basePath';
import { navigateTo } from '@/lib/navigation';

/** `sessionStorage` key holding the JSON list of paths we have already attempted sign-in recovery for. */
const RECOVERY_KEY = 'commise.unauthorizedRecovery';

/**
 * Per-DOCUMENT fallback for contexts where `sessionStorage` throws (Safari private mode, partitioned
 * storage). It cannot survive the redirect, so it degrades the breaker from "once per session" to "once per
 * document" — still bounded, never a tight loop within one page load.
 */
const documentAttempts = new Set<string>();

/**
 * Decode a stored marker into the set of paths already attempted. Pure.
 *
 * Three shapes are honoured. The JSON list this module writes. A bare path — the single-slot marker earlier
 * builds wrote; a visitor mid-session across a deploy still carries it, and reading it as garbage would re-arm
 * the breaker on exactly the surface it had tripped on. And anything else, which reads as NO attempts: that
 * is bounded rather than fail-open, because the write after the next bounce replaces it with a well-formed
 * list, so garbage costs at most one extra hop.
 *
 * @param raw - The stored value, or `null` when nothing is stored.
 * @returns The attempted paths.
 */
function parseAttemptedPaths(raw: string | null): ReadonlySet<string> {
    if (raw === null) {
        return new Set();
    }

    if (raw.startsWith('/')) {
        return new Set([raw]);
    }

    try {
        const parsed: unknown = JSON.parse(raw);

        return new Set(Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === 'string') : []);
    } catch {
        return new Set();
    }
}

/**
 * The paths we have already bounced from.
 *
 * @returns The attempted paths — the in-document fallback when storage is unavailable.
 * @sideEffect Reads `sessionStorage`.
 */
function readAttemptedPaths(): ReadonlySet<string> {
    try {
        return parseAttemptedPaths(window.sessionStorage.getItem(RECOVERY_KEY));
    } catch {
        return documentAttempts;
    }
}

/**
 * Persist the full set of attempted paths.
 *
 * @param paths - Every path recovery has been attempted for, including the one just recorded.
 * @sideEffect Writes `sessionStorage` (falling back to module state when storage is unavailable).
 */
function writeAttemptedPaths(paths: ReadonlySet<string>): void {
    try {
        window.sessionStorage.setItem(RECOVERY_KEY, JSON.stringify([...paths]));
    } catch {
        for (const path of paths) {
            documentAttempts.add(path);
        }
    }
}

/**
 * Re-arm the breaker. The explicit seam for an "authorization restored" signal, and how tests reset state.
 *
 * @sideEffect Clears the `sessionStorage` marker and the in-document fallback.
 */
export function resetUnauthorizedRecovery(): void {
    documentAttempts.clear();

    try {
        window.sessionStorage.removeItem(RECOVERY_KEY);
    } catch {
        // Storage unavailable — `documentAttempts` above is the whole state in that case.
    }
}

/**
 * The sign-in URL to bounce to, carrying the originating path so a future return-to feature has it. Pure.
 *
 * `/sign-in` is deliberately locale-LESS: `middleware.ts` locale-negotiates it (preserving the query) to
 * `/{locale}/sign-in`, so this helper never has to know the viewer's locale. `withBasePath` is a no-op in
 * production and prepends `/pr-{N}` under a legacy path-routed preview (ADR-0001); `redirect_url` must NOT
 * be prefixed because `window.location.pathname` already carries the prefix.
 *
 * @param fromPath - The path the 401 originated on (`window.location.pathname`).
 * @returns An app-relative sign-in URL with `redirect_url` percent-encoded.
 */
export function buildSignInRedirectUrl(fromPath: string): string {
    return `${withBasePath('/sign-in')}?redirect_url=${encodeURIComponent(fromPath)}`;
}

/**
 * Attempt sign-in recovery for a `401`, at most once per originating path per browsing session.
 *
 * @returns `true` when the navigation was issued, `false` when the breaker was already open (so the caller's
 *   error surfaces instead of the browser looping).
 * @sideEffect Reads/writes `sessionStorage` and issues a full-document navigation. No-op outside a browser.
 */
export function redirectToSignInOnce(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }

    const fromPath = window.location.pathname;
    const attempted = readAttemptedPaths();

    if (attempted.has(fromPath)) {
        return false;
    }

    writeAttemptedPaths(new Set([...attempted, fromPath]));
    navigateTo(buildSignInRedirectUrl(fromPath));

    return true;
}
