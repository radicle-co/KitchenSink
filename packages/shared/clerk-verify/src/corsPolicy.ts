/**
 * The CORS origin policy for every browser-facing service: which origins may call it cross-origin.
 *
 * The legitimate callers are exactly the origins the Clerk `azp` boundary admits, so the matcher is DERIVED from
 * {@link resolveAzpEnforcement}, the same resolver the token check uses. The CORS boundary and the `azp` boundary
 * therefore cannot drift, and that includes the `transition`-mode widening (ADR-0033).
 *
 * ⚠️ `origin` IS ALWAYS A LIST. The type cannot express `true` ("reflect any origin"), because `true` cannot tell
 * "non-prod, deliberately permissive" from "prod, misconfigured": a renamed SSM parameter would silently turn prod
 * into an any-origin reflector with credentials. Every branch is chosen from configuration, and a deployed service
 * with no configuration DENIES.
 *
 * ⚠️ AND "CLOSED" IS AN EMPTY LIST, NOT `false`. Measured on `cors@2.8.6` through Nest's `enableCors`
 * (`ExpressAdapter.enableCors` is `this.use(cors(options))`):
 *
 * | `origin` | `Access-Control-Allow-Origin`   | `Vary`   | preflight        |
 * | -------- | ------------------------------- | -------- | ---------------- |
 * | `true`   | reflects `https://evil.example` | `Origin` | `204`            |
 * | `false`  | absent                          | absent   | `200` + `Allow:` |
 * | `[]`     | absent                          | `Origin` | `204`            |
 *
 * `false` does not emit `*`: the package's `middlewareWrapper` calls `next()` for a falsy option before
 * `configureOrigin` runs. It is a SILENT BYPASS instead. The middleware leaves the request path, so the denial
 * becomes an accident of absence (no `Vary: Origin` for caches, the preflight answered by the router). An empty list
 * keeps the middleware in the path and denies by failing the match. Each consuming service asserts that difference at
 * the header level, because the option value cannot show it.
 *
 * Credentials are OFF unless the adopter asks for them. A bearer-only service has no cookie to send, so
 * `Access-Control-Allow-Credentials: true` would only widen what a slip past the bearer-only guard could read: a
 * same-site cookie riding an `include` fetch from any admitted origin, which on sandbox is any `pr-{N}` page. The list
 * type, not credentials, is what keeps `*` out.
 *
 * ⛔ PRECONDITION: the loopback and preview-pattern branches are safe only for a BEARER-ONLY service, one where no
 * route reads a cookie or session credential and none accepts a WebSocket upgrade. A page on an admitted origin then
 * has no ambient credential to ride, and the anchored `azp` regex, not CORS, is the trust boundary on sandbox. A
 * package that calls this function is found by `packages/infra/global/__tests__/bearerOnlyPrecondition.test.ts`,
 * which fails when that premise stops holding for its routes (ADR-0047). Adopting the policy needs no test of its own.
 *
 * @pattern Policy — a pure function from configuration to the admitted origins, derived from the `azp` resolver
 * @module
 */
import { resolveAzpEnforcement } from './clerkVerify.js';

/**
 * Loopback-only origins, for a service that is not deployed. Anchored at both ends, loopback hosts only, optional
 * port, so `http://localhost.evil.example` and `http://localhostx:3000` are refused. The scheme is `https?` because
 * the boundary is the HOST being this machine. ReDoS-safe: one bounded optional group followed by an anchor.
 */
const LOOPBACK_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/**
 * Headers that must survive the preflight. `application/json` is not a CORS-safelisted `Content-Type`, so omitting
 * `Content-Type` blocks every mutation; `Authorization` carries the bearer; `sentry-trace`/`baggage` carry the
 * browser's distributed-tracing context.
 */
const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'sentry-trace', 'baggage'] as const;

/**
 * Response headers a browser script may read beyond the CORS-safelisted ones. `Retry-After` rides every `429` and
 * `503`, and without this a browser client reads it as `null` and cannot back off on time.
 */
const EXPOSED_HEADERS = ['Retry-After'] as const;

/** How long, in seconds, a browser may cache a preflight answer. Without it a browser asks again about every five seconds. */
const PREFLIGHT_MAX_AGE_SECONDS = 600;

/** Structural subset of Nest's `CorsOptions` that the policy sets (avoids a Nest dependency here). */
export interface AppCorsOptions {
    /**
     * The admitted origins, as the `cors` middleware's matcher list: a string entry is an exact match, a RegExp entry
     * is tested against the request `Origin`, and an EMPTY list denies every origin. Never a boolean.
     */
    origin: Array<string | RegExp>;
    credentials: boolean;
    allowedHeaders: string[];
    /** `Access-Control-Expose-Headers`, sent on actual responses (not on preflights). */
    exposedHeaders: string[];
    /** `Access-Control-Max-Age` in seconds, sent on preflights only. */
    maxAge: number;
}

/** Which rule produced the origin list: the decision, made observable (logged at boot, asserted in tests). */
export type CorsOriginMode =
    /** An explicit `CLERK_AUTHORIZED_PARTIES` list (prod, and a test harness that sets one). */
    | 'exact-list'
    /** Deployed non-prod: the anchored `CLERK_AZP_PATTERN` preview-subdomain regex. */
    | 'preview-pattern'
    /** Not deployed and nothing configured: loopback origins only. */
    | 'loopback'
    /** Deployed with no selector at all: deny everything. */
    | 'closed';

/** The resolved policy: the middleware options plus the named rule that produced them. */
export interface CorsPolicy {
    readonly mode: CorsOriginMode;
    readonly options: AppCorsOptions;
}

/** The CORS-relevant configuration, read by the service from its own environment. */
export interface CorsPolicyInput {
    /**
     * Whether the process is a deployed task rather than a developer machine. Each service decides it from the
     * variable its own config schema validates, so a security decision is never steered by an unvalidated variable.
     */
    readonly deployed: boolean;
    /** Raw `CLERK_AUTHORIZED_PARTIES` (comma-separated), if set. */
    readonly authorizedPartiesRaw: string | undefined;
    /** Raw `CLERK_AZP_PATTERN`, the preview base domain, if set. */
    readonly previewBaseDomain: string | undefined;
    /** Raw `CLERK_AZP_PREVIEW_MODE`. Only the exact value `transition` widens the pattern. */
    readonly previewMode: string | undefined;
    /**
     * Whether to send `Access-Control-Allow-Credentials: true`. Defaults to `false`. Pass `true` only while a browser
     * client of the service still sends `credentials: 'include'`, and name that client beside the `true`.
     */
    readonly credentials?: boolean;
}

/**
 * Resolve the CORS policy. Pure.
 *
 * Precedence: an explicit party list wins, because it is the narrower selector; otherwise the anchored preview
 * pattern; otherwise loopback when not deployed; otherwise CLOSED. A deployed service with neither selector is a
 * misconfiguration its config schema already rejects at boot, so denying here costs nothing.
 *
 * @param input - The service's `deployed` decision and its raw `CLERK_*` configuration.
 * @returns The named mode and the `cors` options to hand to `enableCors`.
 */
export function resolveCorsPolicy(input: CorsPolicyInput): CorsPolicy {
    const { authorizedParties, authorizedPartyPattern } = resolveAzpEnforcement({
        authorizedPartiesRaw: input.authorizedPartiesRaw,
        previewBaseDomain: input.previewBaseDomain,
        previewMode: input.previewMode,
    });

    const policy = (mode: CorsOriginMode, origin: Array<string | RegExp>): CorsPolicy => ({
        mode,
        options: {
            origin,
            credentials: input.credentials ?? false,
            allowedHeaders: [...ALLOWED_HEADERS],
            exposedHeaders: [...EXPOSED_HEADERS],
            maxAge: PREFLIGHT_MAX_AGE_SECONDS,
        },
    });

    if (authorizedParties.length > 0) {
        return policy('exact-list', [...authorizedParties]);
    }

    if (authorizedPartyPattern !== undefined) {
        return policy('preview-pattern', [authorizedPartyPattern]);
    }

    return input.deployed ? policy('closed', []) : policy('loopback', [LOOPBACK_ORIGIN]);
}
