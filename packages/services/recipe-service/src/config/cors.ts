/**
 * CORS for the recipe service: the adapter from this service's configuration to the shared policy.
 *
 * The policy itself (which origins a service admits, derived from the Clerk `azp` boundary, and why "closed" is an
 * empty list) lives once, in `@kitchensink/clerk-verify`'s `resolveCorsPolicy`. This module decides only the one
 * input that differs between services: whether the process is deployed. Recipe keys that on `NODE_ENV`, the
 * discriminator its config schema validates, where identity keys it on `STAGE`.
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
 * preview-pattern branches must be re-derived in that same change.** The one shared guard,
 * `packages/infra/global/__tests__/bearerOnlyPrecondition.test.ts`, finds this package because it calls the shared
 * policy, parses `src/` (AST, not grep — this very comment names `req.cookies`) and fails the build if the premise
 * stops holding. See `docs/architecture/decisions/0047-shared-cors-policy.md`.
 *
 * @pattern Adapter over `resolveCorsPolicy` — translates `NODE_ENV` into `deployed` and adds no behaviour
 * @module
 */
import {
    resolveCorsPolicy,
    type CorsPolicy,
    type CorsPolicyInput as SharedCorsPolicyInput,
} from '@kitchensink/clerk-verify';

/**
 * The one `NODE_ENV` value that means "this process is on a developer's machine". Deployed tasks run
 * `staging` or `production` (`infra/lib/RecipeServiceStack.ts`), and `config.types.ts` requires `NODE_ENV`
 * to be one of the three, so anything unrecognized reaching {@link isDeployedEnvironment} is treated as
 * DEPLOYED, which is the fail-closed direction.
 */
const LOCAL_NODE_ENV = 'development';

/**
 * Whether `nodeEnv` names a DEPLOYED environment (`staging` / `production`) rather than a developer machine.
 * Unknown or absent values count as deployed. Pure.
 *
 * @param nodeEnv - The raw `NODE_ENV` value.
 * @returns `false` only for exactly `development`.
 */
export function isDeployedEnvironment(nodeEnv: string | undefined): boolean {
    return nodeEnv !== LOCAL_NODE_ENV;
}

/** This service's CORS configuration, exactly as `main.ts` reads it from `process.env`. */
export type CorsPolicyInput = Omit<SharedCorsPolicyInput, 'deployed' | 'credentials'> & {
    /** `NODE_ENV`: `production` / `staging` on a deployed task, `development` on a developer machine. */
    readonly nodeEnv: string | undefined;
};

/**
 * Resolve the CORS policy for this environment. Pure.
 *
 * @param input - The environment's `NODE_ENV` / `CLERK_*` configuration.
 * @returns The named mode and the `cors` options to hand to `enableCors`.
 */
export function buildCorsPolicy(input: CorsPolicyInput): CorsPolicy {
    const { nodeEnv, ...clerk } = input;

    return resolveCorsPolicy({ ...clerk, deployed: isDeployedEnvironment(nodeEnv) });
}
