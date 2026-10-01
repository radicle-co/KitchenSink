/**
 * CORS for the identity service: the adapter from this service's configuration to the shared policy.
 *
 * The policy itself (which origins a service admits, derived from the Clerk `azp` boundary, and why "closed" is an
 * empty list) lives once, in `@kitchensink/clerk-verify`'s `resolveCorsPolicy`. This module decides only the one
 * input that differs between services: whether the process is deployed. Identity keys that on `STAGE` through
 * `isDeployedStage`, the same predicate its config schema and its auth-trace sink use.
 *
 * ⛔ PRECONDITION — THIS SERVICE IS BEARER-ONLY, AND THAT IS WHAT MAKES A PERMISSIVE ORIGIN SURVIVABLE.
 * Nothing in `src/` reads a cookie: there is no `cookie-parser`, no `req.cookies`, no `__session` /
 * `__client_uat` reader, and `AuthMiddleware` authenticates ONLY from `Authorization: Bearer` (Clerk's
 * `__session` cookie is scoped to `commise.app`, not to `identity.*`). A malicious page therefore has no
 * ambient credential to ride, which is why the loopback and preview-pattern branches are safe and why the
 * anchored `azp` regex — not CORS — is the real trust boundary on sandbox (ADR-0001: the sandbox Clerk dev
 * instance reflects any `Origin` regardless of what we send). **If a route ever reads a cookie, a session
 * credential, or accepts a WebSocket upgrade, this precondition is broken and these branches must be
 * re-derived before that route ships.** The one shared guard,
 * `packages/infra/global/__tests__/bearerOnlyPrecondition.test.ts`, finds this package because it calls the shared
 * policy, parses `src/` (AST, not grep — this very comment mentions `req.cookies`) and fails the build if the
 * premise stops holding. See `docs/architecture/decisions/0047-shared-cors-policy.md`.
 *
 * Identity is the one adopter that still grants credentials, because the web app's identity client sends
 * `credentials: 'include'` (`packages/apps/commise/web/src/lib/identityServiceClient.ts`). A browser refuses to show
 * the response to such a fetch unless the server allows credentials. Drop the `credentials: true` below in the same
 * change that drops `include` there: identity reads no cookie, so the flag protects nothing and only widens what an
 * admitted origin could read.
 *
 * @pattern Adapter over `resolveCorsPolicy` — translates `STAGE` into `deployed`, and asks for credentials
 * @module
 */
import {
    resolveCorsPolicy,
    type CorsPolicy,
    type CorsPolicyInput as SharedCorsPolicyInput,
} from '@kitchensink/clerk-verify';

import { isDeployedStage } from './env.schema.js';

/** This service's CORS configuration, exactly as `main.ts` reads it from the environment. */
export type CorsPolicyInput = Omit<SharedCorsPolicyInput, 'deployed' | 'credentials'> & {
    /** `STAGE`: `prod`, `sandbox`, `pr-{N}`, or a non-deployed sentinel (`dev`/`test`/`local`). */
    readonly stage: string;
};

/**
 * Resolve the CORS policy for this stage. Pure.
 *
 * @param input - The stage's `STAGE` / `CLERK_*` configuration.
 * @returns The named mode and the `cors` options to hand to `enableCors`.
 */
export function buildCorsPolicy(input: CorsPolicyInput): CorsPolicy {
    const { stage, ...clerk } = input;

    // `credentials: true` only while identityServiceClient.ts sends `include`. See the module doc.
    return resolveCorsPolicy({ ...clerk, deployed: isDeployedStage(stage), credentials: true });
}
