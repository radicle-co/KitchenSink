/**
 * CORS for the recipe service — a per-environment DECISION, never a default.
 *
 * The service sits behind the shared public ALB and is called cross-origin by the web app (web on Vercel,
 * recipe on `recipe[-pr-{N}].commise.app`), so it needs `enableCors()`; the browser client sends the
 * `Authorization` bearer explicitly and `credentials: true` is kept for parity with identity, which forbids a
 * `*` wildcard. The legitimate callers are exactly the origins the Clerk `azp` boundary already admits, so this
 * DERIVES its matcher from `resolveAzpEnforcement` — the same resolver `ClerkAuthService` uses — instead of
 * maintaining a second, drift-prone allowlist. One trust boundary, two consumers.
 *
 * ⚠️ WHAT WAS WRONG BEFORE, AND IT WAS THE DIRECTION OF FAILURE, NOT THE SANDBOX BEHAVIOUR. This was
 * `origin: parties.length > 0 ? parties : true`. `infra/lib/RecipeServiceStack.ts` sets
 * `CLERK_AUTHORIZED_PARTIES` only on the prod stage; every deployed non-prod stage gets `CLERK_AZP_PATTERN`
 * instead, and `config.types.ts`'s `superRefine` enforces exactly one of the two — so on sandbox and on every
 * `pr-{N}` the list was NECESSARILY empty and the branch taken was `true`: reflect any origin, with
 * credentials. `true` is a DEFAULT, not a decision. It cannot distinguish "non-prod, deliberately permissive"
 * from "prod, misconfigured", so a renamed SSM parameter or a bad parameter write would silently turn PROD
 * into an any-origin reflector. Every branch here is now chosen from the environment's own configuration, and
 * the absence of configuration DENIES. (Measured before the fix: booting the real Nest app with the sandbox
 * configuration answered `Access-Control-Allow-Origin: https://evil.example`.)
 *
 * ⚠️ `origin` IS ALWAYS A LIST — the type deliberately cannot express `true`. That is the fix, not a style
 * choice: as long as `boolean` is representable, "reflect anything" stays one keystroke away.
 *
 * ⚠️ AND "CLOSED" IS AN EMPTY LIST, NOT `false` — for a reason that is NOT the one commonly repeated.
 * `cors@2.8.6`'s `configureOrigin` does open with `if (!options.origin || options.origin === '*')` →
 * `Access-Control-Allow-Origin: *`, but that branch is UNREACHABLE for a falsy static option: the package's
 * `middlewareWrapper` tests `corsOptions.origin` first and calls `next()` without touching a header when it is
 * falsy, so `cors()` — and therefore `configureOrigin` — never runs. MEASURED on the installed
 * `cors@2.8.6` + `express`, which is exactly what `enableCors` uses (`ExpressAdapter.enableCors` is
 * `this.use(cors(options))`):
 *
 * | `origin`      | `Access-Control-Allow-Origin` | `Vary`   | preflight        |
 * | ------------- | ----------------------------- | -------- | ---------------- |
 * | `true`        | reflects `https://evil.example` | `Origin` | `204`            |
 * | `false`       | absent                        | absent   | `200` + `Allow:` |
 * | `[]`          | absent                        | `Origin` | `204`            |
 *
 * So `false` is not an open door — it is a SILENT BYPASS: the CORS middleware leaves the request path
 * entirely, and the denial becomes an accident of absence rather than this policy's decision (no
 * `Vary: Origin` for caches, the preflight answered by Express's default `OPTIONS` handler instead of by
 * CORS). An empty list keeps the middleware in the path and denies by FAILING THE MATCH. That difference is
 * invisible in the option value, so `__tests__/corsHeaders.test.ts` asserts it at the header level: the
 * `Vary: Origin` + `204` pair is what turns red if `[]` is ever "simplified" to `false`.
 *
 * ⛔ PRECONDITION — THIS SERVICE IS BEARER-ONLY, AND THAT IS WHAT MAKES A PERMISSIVE ORIGIN SURVIVABLE.
 * Nothing in `src/` reads a cookie: there is no `cookie-parser`, no `req.cookies`, no `__session` /
 * `__client_uat` reader, and both `AuthMiddleware` and `ServiceErasureGuard` authenticate ONLY from
 * `Authorization: Bearer` (Clerk's `__session` cookie is scoped to `commise.app`, not to `recipe.*`). The two
 * unauthenticated routes (`GET /health`, `GET /health/ready`) return no caller data. A malicious page
 * therefore has no ambient credential to ride, which is why the preview-pattern and loopback branches are safe
 * and why the anchored `azp` regex — not CORS — is the real trust boundary on sandbox (ADR-0001: the sandbox
 * Clerk dev instance reflects any `Origin` regardless of what we send). **If any route ever reads a cookie or
 * a session credential, or accepts a WebSocket upgrade, this precondition is broken and the loopback and
 * preview-pattern branches must be re-derived in that same change.**
 * `__tests__/bearerOnlyPrecondition.test.ts` parses `src/` (AST, not grep — this very comment names
 * `req.cookies`) and fails the build if the premise stops holding.
 *
 * NOTE ON SHARING: identity's `src/config/cors.ts` implements the same policy. The two are deliberately
 * separate for now — see that file and this module's `CorsPolicyInput` docstring for the seam a future
 * extraction takes (a resolved `deployed` boolean, because identity keys on `STAGE` and recipe on `NODE_ENV`).
 *
 * @module
 */
import { resolveAzpEnforcement } from '@kitchensink/clerk-verify';

/**
 * Loopback-only origins, for local development. Anchored at BOTH ends, loopback hosts only, optional port —
 * so `http://localhost.evil.example` and `http://localhostx:3000` are refused, which `origin: true` was not.
 * Scheme is `https?` because the boundary is the HOST being this machine, not the scheme. ReDoS-safe: one
 * bounded optional group followed by an anchor.
 */
const LOOPBACK_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/**
 * Headers that must survive the preflight. `Content-Type` and `Authorization` are what
 * `@kitchensink/recipe-service-client` actually sends (`application/json` is not a CORS-safelisted
 * `Content-Type` value, so omitting it blocks every mutation); `sentry-trace`/`baggage` carry the browser's
 * distributed-tracing context.
 */
const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'sentry-trace', 'baggage'];

/**
 * The one `NODE_ENV` value that means "this process is on a developer's machine". Deployed tasks run
 * `staging` or `production` (`infra/lib/RecipeServiceStack.ts`), and `config.types.ts` requires `NODE_ENV`
 * to be one of the three — so anything unrecognized reaching {@link isDeployedEnvironment} is treated as
 * DEPLOYED, which is the fail-closed direction.
 */
const LOCAL_NODE_ENV = 'development';

/**
 * Whether `nodeEnv` names a DEPLOYED environment (`staging` / `production`) rather than a developer machine.
 * Recipe keys its environment on `NODE_ENV` — unlike identity and food, which key on `STAGE` (see the note in
 * `infra/lib/RecipeServiceStack.ts`) — and `NODE_ENV` is the discriminator this service's config schema
 * actually validates, so a security decision derived from it cannot be steered by an unvalidated variable.
 * Unknown or absent values count as deployed. Pure.
 *
 * @param nodeEnv - The raw `NODE_ENV` value.
 * @returns `false` only for exactly `development`.
 */
export function isDeployedEnvironment(nodeEnv: string | undefined): boolean {
    return nodeEnv !== LOCAL_NODE_ENV;
}

/** Structural subset of Nest's `CorsOptions` that this service sets (avoids a deep internal import). */
export interface AppCorsOptions {
    /**
     * The admitted origins, as the `cors` middleware's matcher list. ALWAYS a list — a string entry is an
     * exact match, a RegExp entry is tested against the request `Origin`, and an EMPTY list denies every
     * origin. Deliberately not `boolean`: see the header-level table in this module's docstring.
     */
    origin: Array<string | RegExp>;
    credentials: boolean;
    allowedHeaders: string[];
}

/** Which rule produced the origin list — the decision, made observable (logged at boot, asserted in tests). */
export type CorsOriginMode =
    /** Prod (and any environment with an explicit list): the exact-match `CLERK_AUTHORIZED_PARTIES` entries. */
    | 'exact-list'
    /** Deployed non-prod: the anchored `CLERK_AZP_PATTERN` preview-subdomain regex. */
    | 'preview-pattern'
    /** A developer machine with nothing configured: loopback origins only. */
    | 'loopback'
    /** A deployed environment with no selector at all — deny everything. */
    | 'closed';

/** The resolved policy: the middleware options plus the named rule that produced them. */
export interface CorsPolicy {
    readonly mode: CorsOriginMode;
    readonly options: AppCorsOptions;
}

/**
 * The environment's own CORS-relevant configuration, exactly as `main.ts` reads it from `process.env`.
 *
 * Taken as an argument rather than read here so the policy stays pure and every branch is directly testable.
 * If this ever moves into a shared package alongside identity's copy, `nodeEnv` becomes a resolved
 * `deployed: boolean` — that is the ONLY difference between the two services' inputs, and pushing the
 * discriminator to the caller lets each keep the variable its own config schema validates.
 */
export interface CorsPolicyInput {
    /** `NODE_ENV` — `production` / `staging` on a deployed task, `development` on a developer machine. */
    readonly nodeEnv: string | undefined;
    /** Raw `CLERK_AUTHORIZED_PARTIES` (comma-separated), if set. */
    readonly authorizedPartiesRaw: string | undefined;
    /** Raw `CLERK_AZP_PATTERN` — the preview base domain, if set. */
    readonly previewBaseDomain: string | undefined;
    /** Raw `CLERK_AZP_PREVIEW_MODE` — only the exact value `transition` widens the pattern (ADR-0001). */
    readonly previewMode: string | undefined;
}

/**
 * Resolve the CORS policy for this environment. Pure.
 *
 * Precedence: an explicit party list wins (prod, and the e2e harness); otherwise the anchored preview
 * pattern; otherwise loopback on a developer machine; otherwise CLOSED. The first two come from
 * `resolveAzpEnforcement`, so the CORS boundary and the `azp` boundary cannot drift apart — including the
 * `transition`-mode widening, which is decided there and inherited here rather than re-implemented.
 *
 * @param input - The environment's `NODE_ENV` / `CLERK_*` configuration.
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

    // Nothing configured. A deployed environment in this state is a misconfiguration `config.types.ts`
    // already rejects at boot, so denying here costs nothing and removes the failure direction that let
    // `true` stand in for a decision. Loopback is the deliberate local-development choice.
    return isDeployedEnvironment(input.nodeEnv) ? policy('closed', []) : policy('loopback', [LOOPBACK_ORIGIN]);
};
