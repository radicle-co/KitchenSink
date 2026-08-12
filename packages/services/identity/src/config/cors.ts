/**
 * CORS for the identity service (U11/F3) — a per-stage DECISION, never a default.
 *
 * The service is fronted by a public ALB and called cross-origin by the web app, so it needs
 * `enableCors()`; because the web client sends `credentials: 'include'`, `credentials: true` is required,
 * which forbids a `*` wildcard. The legitimate callers are exactly the origins the Clerk `azp` boundary
 * already admits, so this DERIVES its matcher from `resolveAzpEnforcement` — the same resolver
 * `ClerkAuthService` uses — rather than maintaining a second, drift-prone allowlist. One trust boundary,
 * two consumers.
 *
 * ⚠️ WHAT WAS WRONG BEFORE, AND IT WAS THE DIRECTION OF FAILURE, NOT THE SANDBOX BEHAVIOUR. This was
 * `origin: parties.length > 0 ? parties : true`. Infra sets `CLERK_AUTHORIZED_PARTIES` only when
 * `stage === 'prod'`; every deployed non-prod stage gets `CLERK_AZP_PATTERN` instead, and `env.schema.ts`
 * enforces exactly one of the two — so on sandbox and on every `pr-{N}` the list was NECESSARILY empty and
 * the branch taken was `true`: reflect any origin, with credentials. `true` is a DEFAULT, not a decision. It
 * cannot distinguish "non-prod, deliberately permissive" from "prod, misconfigured", so a renamed SSM
 * parameter or a bad parameter write would silently turn PROD into an any-origin reflector. Every branch here
 * is now chosen from the stage's own configuration, and the absence of configuration DENIES.
 *
 * ⚠️ `origin` IS ALWAYS A LIST — the type deliberately cannot express `true`. That is the fix, not a style
 * choice: as long as `boolean` is representable, "reflect anything" stays one keystroke away.
 *
 * ⚠️ AND "CLOSED" IS AN EMPTY LIST, NOT `false` — for a reason that is NOT the one this comment used to give.
 * It claimed `origin: false` emits `Access-Control-Allow-Origin: *`, i.e. "the OPPOSITE of denied". That is
 * FALSE, and the claim was load-bearing: `tests/cors-headers.test.ts` cited it as a mutation guard, and the
 * mutant it named was then MEASURED to leave that suite fully green (6 passed, 0 failed). `cors@2.8.6`'s
 * `configureOrigin` does open with `if (!options.origin || options.origin === '*')` → `*`, but that branch is
 * UNREACHABLE for a falsy static option: the package's `middlewareWrapper` tests `corsOptions.origin` first
 * and calls `next()` without touching a header when it is falsy, so `cors()` — and therefore
 * `configureOrigin` — never runs at all. Measured on the installed `cors@2.8.6` through the real
 * `enableCors` path (`ExpressAdapter.enableCors` is `this.use(cors(options))`): `false` yields NO
 * `Access-Control-Allow-Origin`, NO `Vary`, and a preflight the router answers instead of CORS.
 *
 * So `false` is not an open door — it is a SILENT BYPASS, and that is still the reason not to use it: the
 * middleware leaves the request path, so the denial becomes an accident of absence rather than this policy's
 * decision (no `Vary: Origin` for caches, and the preflight — where a browser actually checks — answered by
 * whatever the router does with an unrouted `OPTIONS`). An empty list keeps the middleware IN the path and
 * denies by FAILING THE MATCH. Because absence of the header is what BOTH values produce, the guard in
 * `tests/cors-headers.test.ts` is re-anchored on the OBSERVABLE difference — `Vary: Origin` present and the
 * preflight answered `204` — which is what now reds if `[]` is ever "simplified" to `false`.
 *
 * ⛔ PRECONDITION — THIS SERVICE IS BEARER-ONLY, AND THAT IS WHAT MAKES A PERMISSIVE ORIGIN SURVIVABLE.
 * Nothing in `src/` reads a cookie: there is no `cookie-parser`, no `req.cookies`, no `__session` /
 * `__client_uat` reader, and `AuthMiddleware` authenticates ONLY from `Authorization: Bearer` (Clerk's
 * `__session` cookie is scoped to `commise.app`, not to `identity.*`). A malicious page therefore has no
 * ambient credential to ride, which is why the loopback and preview-pattern branches are safe and why the
 * anchored `azp` regex — not CORS — is the real trust boundary on sandbox (ADR-0001: the sandbox Clerk dev
 * instance reflects any `Origin` regardless of what we send). **If a route ever reads a cookie, a session
 * credential, or accepts a WebSocket upgrade, this precondition is broken and these branches must be
 * re-derived before that route ships.** `tests/bearer-only-precondition.test.ts` parses `src/` (AST, not
 * grep — this very comment mentions `req.cookies`) and fails the build if the premise stops holding.
 */
import { resolveAzpEnforcement } from '@kitchensink/clerk-verify';

import { isDeployedStage } from './env.schema.js';

/**
 * Loopback-only origins, for a stage that is not deployed (`dev`/`test`/`local`). Anchored at both ends,
 * loopback hosts only, optional port — so `http://localhost.evil.example` and `http://localhostx:3000` are
 * refused, which `origin: true` was not. Scheme is `https?` because the boundary is the HOST being the local
 * machine, not the scheme. ReDoS-safe: one bounded optional group followed by an anchor.
 */
const LOOPBACK_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/** Headers that must survive the preflight: the bearer credential plus Sentry's trace propagation (B1/B2). */
const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'sentry-trace', 'baggage'];

/** Structural subset of Nest's `CorsOptions` that this service sets (avoids a deep internal import). */
export interface AppCorsOptions {
    /**
     * The admitted origins, as the `cors` middleware's matcher list. ALWAYS a list — a string entry is an
     * exact match, a RegExp entry is tested against the request `Origin`, and an EMPTY list denies every
     * origin. Deliberately not `boolean`: see the header-level caveat in this module's docstring.
     */
    origin: Array<string | RegExp>;
    credentials: boolean;
    allowedHeaders: string[];
}

/** Which rule produced the origin list — the decision, made observable (logged at boot, asserted in tests). */
export type CorsOriginMode =
    /** Prod: the exact-match `CLERK_AUTHORIZED_PARTIES` list. */
    | 'exact-list'
    /** Deployed non-prod: the anchored `CLERK_AZP_PATTERN` preview-subdomain regex. */
    | 'preview-pattern'
    /** Not a deployed stage and nothing configured: loopback origins only. */
    | 'loopback'
    /** A deployed stage with no selector at all — deny everything. */
    | 'closed';

/** The resolved policy: the middleware options plus the named rule that produced them. */
export interface CorsPolicy {
    readonly mode: CorsOriginMode;
    readonly options: AppCorsOptions;
}

/** The stage's own CORS-relevant configuration, exactly as `main.ts` reads it from the environment. */
export interface CorsPolicyInput {
    /** `STAGE` — `prod`, `sandbox`, `pr-{N}`, or a non-deployed sentinel (`dev`/`test`/`local`). */
    readonly stage: string;
    /** Raw `CLERK_AUTHORIZED_PARTIES` (comma-separated), if set. */
    readonly authorizedPartiesRaw: string | undefined;
    /** Raw `CLERK_AZP_PATTERN` — the preview base domain, if set. */
    readonly previewBaseDomain: string | undefined;
    /** Raw `CLERK_AZP_PREVIEW_MODE` — only the exact value `transition` widens the pattern (ADR-0001). */
    readonly previewMode: string | undefined;
}

/**
 * Resolve the CORS policy for this stage. Pure.
 *
 * Precedence: an explicit party list wins (prod, and the e2e harness); otherwise the anchored preview
 * pattern; otherwise loopback on a non-deployed stage; otherwise CLOSED. The first two come from
 * `resolveAzpEnforcement`, so the CORS boundary and the `azp` boundary cannot drift apart — including the
 * `transition`-mode widening, which is decided there and inherited here rather than re-implemented.
 *
 * @param input - The stage's `STAGE` / `CLERK_*` configuration.
 * @returns The named mode and the `cors` options to hand to `enableCors`.
 */
export const buildCorsPolicy = (input: CorsPolicyInput): CorsPolicy => {
    const { authorizedParties, authorizedPartyPattern } = resolveAzpEnforcement({
        authorizedPartiesRaw: input.authorizedPartiesRaw,
        previewBaseDomain: input.previewBaseDomain,
        previewMode: input.previewMode,
    });

    const policy = (mode: CorsOriginMode, origin: Array<string | RegExp>): CorsPolicy => ({
        mode,
        options: { origin, credentials: true, allowedHeaders: [...ALLOWED_HEADERS] },
    });

    if (authorizedParties.length > 0) {
        return policy('exact-list', [...authorizedParties]);
    }

    if (authorizedPartyPattern !== undefined) {
        return policy('preview-pattern', [authorizedPartyPattern]);
    }

    // Nothing configured. A deployed stage in this state is a misconfiguration `env.schema.ts` already
    // rejects at boot, so denying here costs nothing and removes the failure direction that let `true`
    // stand in for a decision. Loopback is the deliberate local-development choice.
    return isDeployedStage(input.stage) ? policy('closed', []) : policy('loopback', [LOOPBACK_ORIGIN]);
};
