// Keeping a k6 VU's Clerk bearer alive for longer than the bearer lives.
//
// ⛔ THE PROBLEM, MEASURED. A Clerk session token's `exp - iat` on this instance is exactly 60 seconds. A
// deployed scenario's default shape is 30s ramp + 1m hold + 15s down = 105, and the legs run sequentially
// for ~20 minutes after a single provisioning pass. On run 34041143051 that produced 434 successes out of
// 3884 in the first scenario — the ~60s before expiry — and then a clean zero out of 12252, 1215 and 3996
// in the ones after it.
//
// ⚠️ THE FAILURE IMITATES A RATE LIMIT and was first diagnosed as one, because 88% failures on a suite whose
// VU-to-pool ratio genuinely does exceed `RATE_LIMIT_SEARCH` is exactly what throttling looks like. The
// distinguishing evidence is the ZERO: a limiter admits its budget every minute forever, so it can never
// produce 0 out of 12252. Only expiry can.
//
// ⛔ THIS IS THE CHEAP HALF OF CLERK'S FAPI, and it must stay that way. Signing in is per-IP rate limited —
// the entire reason a pool is provisioned up front instead of minted per VU — while minting FROM a live
// session is a different endpoint and is not limited. This module therefore only ever posts to
// `/client/sessions/{id}/tokens`; it can neither sign in nor create a session, and has no code path that
// could start doing so.
//
// The `Origin` header is load-bearing, not decoration: Clerk stamps it into the token as `azp`, and `azp`
// is what the deployed services' anchored `CLERK_AZP_PATTERN` admits (ADR-0033). Dropping it yields a token
// every service refuses, and the refusal arrives as an opaque 401 from the service rather than an error
// here — which is precisely the confusion this module exists to end.
import http from 'k6/http';

/** Refresh this many seconds after minting — a quarter of the lifetime is left as headroom. */
const REFRESH_AFTER_SECONDS = 45;

/**
 * Read the sign-in handles `provisionPool.ts` stored, in roster order.
 *
 * ⚠️ INIT-CONTEXT ONLY — k6's `open()` cannot be called from a VU. Call this at module scope and hold the
 * result; the refreshing happens later, in `freshBearer`.
 *
 * @param {string} envName - The `__ENV` key holding the path to `handles.json`.
 * @returns {Array<object>} The handles, minus `admin`; empty when no path was supplied.
 */
export function loadSessionHandles(envName) {
    const path = __ENV[envName] || '';

    if (path === '') {
        return [];
    }

    let raw;

    try {
        raw = open(path);
    } catch (error) {
        throw new Error(
            `session.js: cannot read the sign-in handles at '${path}' (${error}). They are generated, ` +
                'gitignored credential material — run `npm run provision:pool --workspace=packages/tools/loadtest`.',
        );
    }

    // `admin` is a different principal with different scopes; a scenario that wanted it would ask for it by
    // name, and rotating VUs onto it would quietly measure an admin's authorization path.
    const stored = JSON.parse(raw);

    return Object.keys(stored)
        .filter((name) => name !== 'admin')
        .map((name) => stored[name]);
}

// Per-VU state. k6 gives every VU its own JS runtime, so these are genuinely per-VU rather than shared —
// which is what keeps a VU on ONE identity across refreshes. Rotating identities mid-run would show a
// per-USER rate limiter traffic no real client produces.
let bearer = null;
let mintedAt = 0;

/**
 * The bearer this VU should present, re-minted whenever the held one is close to expiring.
 *
 * @param {Array<object>} handles - The result of {@link loadSessionHandles}.
 * @param {string} fallback - The bearer to use when no handles were supplied (an unauthenticated or
 *   single-token run), so a suite without a pool behaves exactly as it did before.
 * @returns {string} A bearer minted within the last {@link REFRESH_AFTER_SECONDS} seconds.
 * @sideEffect Performs a Clerk Frontend-API re-mint when the held bearer is stale.
 */
export function freshBearer(handles, fallback) {
    if (handles.length === 0) {
        return fallback;
    }

    const now = Date.now() / 1000;

    if (bearer !== null && now - mintedAt < REFRESH_AFTER_SECONDS) {
        return bearer;
    }

    const handle = handles[(__VU - 1 + handles.length) % handles.length];
    // Tagged so the re-mint is separable from the traffic under test in every percentile. It is NOT
    // excluded from `http_req_failed`: a re-mint that fails means the following requests are unauthorized,
    // so it SHOULD redden the run rather than hide inside a filtered metric.
    const response = http.post(
        `${handle.fapi}/client/sessions/${handle.sessionId}/tokens?__clerk_db_jwt=${handle.devJwt}`,
        null,
        { headers: { Origin: handle.origin }, tags: { operation: 'clerkRemint' } },
    );
    const minted = response.status === 200 ? response.json('jwt') : null;

    if (!minted) {
        // Loud and specific. A revoked session (a teardown that ran early, an instance reset) is
        // indistinguishable from a transient HTTP failure, and treating either as "keep the old token"
        // resurrects the exact silent-401 run this module was written to end.
        throw new Error(
            `session.js: could not re-mint a bearer for VU ${__VU} (status ${response.status}) — the run's ` +
                'Clerk session is gone or unreachable.',
        );
    }

    bearer = minted;
    mintedAt = now;

    return bearer;
}
