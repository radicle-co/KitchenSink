/**
 * The ONE definition of a service's Clerk auth environment (extracted 2026-09-02).
 *
 * Every token-verifying service — identity, food, recipe — needs the same four values wired the same
 * way, and each used to spell the rule out by hand in its own stack. That is one piece of KNOWLEDGE in
 * three places, and this repo has already paid for that shape: the ALB listener priorities were three
 * per-service copies until they drifted (recipe's docstring described food's bands and collided a live
 * priority), which is why `packages/infra/alb`'s `listenerPriority.ts` is now the single allocator. The
 * drift had begun here too — identity resolved its parameter tree with `stage === 'prod' ? 'prod' :
 * 'sandbox'` while food and recipe used `baseStage`, the same rule in two spellings — and pushing the
 * native gate to prod meant three hand edits in three files, guarded by a prod assertion that existed
 * in only one of the three test suites.
 *
 * ## The rule
 *
 * - **`CLERK_JWT_KEY`, always.** The instance's PUBLIC PEM (non-secret), so verification is networkless.
 * - **EXACTLY ONE azp mode.** Prod takes the exact-match list; every other stage takes the anchored
 *   preview pattern plus its preview mode. This mirrors `hasExactlyOneAzpMode`'s runtime invariant at
 *   the env layer — setting neither would make verification skip the azp check entirely (fail-open),
 *   and setting both is ambiguous. ⛔ The two modes are NOT interchangeable and prod must not be
 *   "simplified" onto the pattern: a regex can be mis-anchored into accepting
 *   `pr-1.sandbox.commise.app.evil.com`, a list cannot, and prod carries the largest blast radius
 *   (ADR-0001, whose standing warning is that the anchored pattern IS the sandbox trust boundary).
 *   Non-prod genuinely cannot use a list: per-PR preview origins are created AFTER the shared identity
 *   service deploys, so its allowlist must describe a shape rather than a membership.
 * - **`CLERK_ADMIT_NATIVE_CLIENT` on EVERY stage.** Native (@clerk/expo) tokens carry no `azp` at all.
 *   Since `@clerk/backend` 3.x, BOTH modes reject an azp-less token without this positive gate — 1.34
 *   returned early on absence, 3.16's `assertAuthorizedPartiesClaim` throws whenever a party list is
 *   configured, which 401'd a live device token on every call. ⚠️ The gate admits only a POSITIVE
 *   `client_type: 'native'` claim, minted solely by the `commise-native` Clerk JWT template, never
 *   azp-absence alone — so it widens nothing for a browser token, whose `azp` never reaches that
 *   branch. The template must exist on the stage's Clerk instance or the flag is inert.
 *
 * ## Parameters are an operational prerequisite
 *
 * Every value resolves from SSM at DEPLOY time (`valueForStringParameter`), so the parameters must
 * exist before the stack deploys. Prod reads the prod tree; every other stage — sandbox and each
 * `pr-{N}` — reads the SHARED sandbox tree, because they all authenticate against the one sandbox
 * Clerk instance.
 */
import { aws_ssm as ssm } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

/**
 * The SSM prefix holding a stage's Clerk parameters. Prod has its own; every other stage (sandbox and
 * each `pr-{N}` preview) shares the sandbox tree, because they share the sandbox Clerk instance.
 *
 * @param baseStage - The stage's BASE platform (`prod` or `sandbox`), not the per-PR stage name.
 * @returns The parameter prefix, without a trailing slash.
 */
export function clerkAuthParameterPrefix(baseStage: string): string {
    return `/kitchensink/${baseStage === 'prod' ? 'prod' : 'sandbox'}/clerk`;
}

/**
 * Build the Clerk auth environment for a token-verifying service.
 *
 * @param scope - The construct the SSM lookups resolve against (the service's stack).
 * @param baseStage - The stage's BASE platform (`prod` or `sandbox`); a `pr-{N}` stage passes
 *   `sandbox`, since previews share the sandbox Clerk instance and its parameters.
 * @returns The environment variables to merge into the service's container definition.
 */
export function clerkAuthEnvironment(scope: Construct, baseStage: string): Record<string, string> {
    const prefix = clerkAuthParameterPrefix(baseStage);
    const parameter = (name: string): string => ssm.StringParameter.valueForStringParameter(scope, `${prefix}/${name}`);

    return {
        CLERK_JWT_KEY: parameter('jwt-public-key'),
        // Exactly one mode — see the module docstring for why prod must NOT move to the pattern.
        ...(baseStage === 'prod'
            ? { CLERK_AUTHORIZED_PARTIES: parameter('authorized-parties') }
            : {
                  CLERK_AZP_PATTERN: parameter('azp-pattern'),
                  // The cutover selector (ADR-0001): `transition` also admits the path-routed apex while
                  // the shared sandbox migrates to per-PR subdomains. An SSM change + task restart, not a
                  // code deploy — and anything but the exact string `transition` stays strict.
                  CLERK_AZP_PREVIEW_MODE: parameter('azp-preview-mode'),
              }),
        // ⛔ EVERY stage, prod included. See the module docstring: absence of `azp` is admitted only
        // alongside a positive native claim, so this loosens nothing for browser traffic.
        CLERK_ADMIT_NATIVE_CLIENT: 'true',
    };
}
