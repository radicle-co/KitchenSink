/**
 * The Sentry `environment` and `release` this build reports under (plan U19).
 *
 * ⛔ WHY IT IS NOT `NODE_ENV`. All three Sentry configs read `process.env.NODE_ENV`, and Next sets that to
 * `production` for EVERY production build — including every preview. So every `pr-{N}` deploy has been
 * reporting into the `production` environment, mixed in with the events from the deploy real users are on.
 * That is worse than having no environment tag: it makes the production filter untrustworthy in the one
 * direction nobody checks, because a preview's errors look exactly like production's.
 *
 * ⚠️ The derivation must run at BUILD time and be inlined, because `instrumentation-client.ts` runs in the
 * browser where `process.env` does not exist — only what `next.config.ts` inlined does. That is why the value
 * comes through a `NEXT_PUBLIC_` variable rather than being computed at module load.
 */

/**
 * The deploy stage a build is for.
 *
 * ⛔ Reads the SAME inputs `derivePreviewBasePath` does, deliberately: a build that serves `/pr-91` and a
 * build that reports as `pr-91` must be the same build, and two derivations from two different variables is
 * how they stop being.
 *
 * @param env - The build environment.
 * @returns `prod` for the production deploy, `pr-{N}` for a preview, `sandbox` otherwise. Pure.
 */
export function deployStageFor(env: Record<string, string | undefined> = process.env): string {
    const explicit = env['DEPLOY_STAGE'];

    if (explicit) {
        return explicit;
    }

    const prId = env['VERCEL_GIT_PULL_REQUEST_ID'];

    if (prId) {
        return `pr-${prId}`;
    }

    // Vercel's own environment name: `production` for the live deploy, `preview` for a branch build without
    // a PR, `development` locally. Only the first is prod.
    return env['VERCEL_ENV'] === 'production' ? 'prod' : 'sandbox';
}

/**
 * The release identifier for a build — the commit it was built from.
 *
 * ⚠️ Undefined rather than a placeholder when unknown. Sentry treats a release as the key it associates
 * source maps and regressions with, so a made-up value ("unknown", "local") silently groups unrelated
 * deploys together, which is harder to notice than an absent release.
 *
 * @param env - The build environment.
 * @returns The commit SHA, or `undefined`. Pure.
 */
export function releaseFor(env: Record<string, string | undefined> = process.env): string | undefined {
    return env['SENTRY_RELEASE'] ?? env['VERCEL_GIT_COMMIT_SHA'] ?? env['GITHUB_SHA'];
}

/** The stage this bundle was built for, inlined by `next.config.ts`. */
export const DEPLOY_STAGE = process.env['NEXT_PUBLIC_DEPLOY_STAGE'] ?? 'sandbox';

/** The release this bundle was built from, inlined by `next.config.ts`. Empty when unknown. */
export const RELEASE = process.env['NEXT_PUBLIC_SENTRY_RELEASE'] ?? '';

/**
 * How much tracing to sample.
 *
 * ⚠️ Keyed on the STAGE, not on `NODE_ENV`, for the same reason as the environment: every preview was
 * sampling at production's rate while being labelled production, so neither number described anything.
 *
 * @param stage - The deploy stage.
 * @returns A sample rate in [0, 1]. Pure.
 */
export function tracesSampleRateFor(stage: string): number {
    return stage === 'prod' ? 0.1 : 1.0;
}
