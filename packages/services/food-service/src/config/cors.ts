/**
 * CORS for the food service: the adapter from this service's configuration to the shared policy (plan 002 S4, R41).
 *
 * The policy itself (which origins a service admits, derived from the Clerk `azp` boundary, and why "closed" is an
 * empty list) lives once, in `@kitchensink/clerk-verify`'s `resolveCorsPolicy`. This module decides only the one input
 * that differs between services: whether the process is deployed. Food keys that on `STAGE`, the variable its config
 * schema validates and its infra sets on every deployed task, as identity does.
 *
 * ⚠️ DELIBERATE — see `docs/architecture/decisions/0047-shared-cors-policy.md`. The preview-pattern and loopback
 * branches are safe only because this service is BEARER-ONLY: `FoodAuthGuard` and `FoodServiceErasureGuard` read
 * `Authorization: Bearer` and nothing else, no route reads a cookie or a session, and none accepts a WebSocket
 * upgrade. `packages/infra/global/__tests__/bearerOnlyPrecondition.test.ts` finds this package because it calls the
 * shared policy, and fails the build if that stops being true.
 *
 * @pattern Adapter over `resolveCorsPolicy` — translates `STAGE` into `deployed` and adds no behaviour
 * @module
 */
import {
    resolveCorsPolicy,
    type CorsPolicy,
    type CorsPolicyInput as SharedCorsPolicyInput,
} from '@kitchensink/clerk-verify';

import { isDeployedStage, settingFromEnv } from './env.schema.js';

/** This service's CORS configuration, exactly as {@link corsPolicyFromEnv} reads it. */
export type CorsPolicyInput = Omit<SharedCorsPolicyInput, 'deployed' | 'credentials'> & {
    /** `STAGE`: `prod`, `sandbox`, `pr-{N}`, or a local sentinel (`dev` / `test` / `local`). */
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

    return resolveCorsPolicy({ ...clerk, deployed: isDeployedStage(stage) });
}

/**
 * Resolve the CORS policy from the process environment. `main.ts` calls this, and so does the mocked integration
 * harness, so the policy a test installs is the one a deployed task installs.
 *
 * The three `CLERK_*` values are read raw, exactly as `FoodAuthGuard` reads them, because the CORS boundary must be
 * the `azp` boundary. `STAGE` goes through the config schema, which owns its default.
 *
 * @returns The named mode and the `cors` options to hand to `enableCors`.
 * @throws {Error} when `STAGE` is set to a value the config schema rejects.
 * @sideEffect Reads `process.env`.
 */
export function corsPolicyFromEnv(): CorsPolicy {
    return buildCorsPolicy({
        stage: settingFromEnv('STAGE'),
        authorizedPartiesRaw: process.env['CLERK_AUTHORIZED_PARTIES'],
        previewBaseDomain: process.env['CLERK_AZP_PATTERN'],
        previewMode: process.env['CLERK_AZP_PREVIEW_MODE'],
    });
}
