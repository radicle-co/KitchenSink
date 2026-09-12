/**
 * Which HTTP statuses a deployed stage recovers from on its own — the one status rule this package's service ports
 * retry on.
 *
 * A `429` is the stage throttling, and a `5xx` is a task failing or not yet warm (a `pr-{N}` preview's first request
 * to an idle Fargate Spot task is ordinarily slow). Anything else is the service's answer, and retrying it would hide
 * a refusal behind a loop.
 *
 * ⚠️ Deliberately NARROWER than `@kitchensink/recipe-service-client`'s `shouldRetryRecipeServiceFailure`, which also
 * retries `408` and `425`: that is the client's policy for an idempotent read in an app, and a reset step that
 * widened to it would retry what this package treats as final. Web's `isTerminalRefusal` (`clerkFapiStep.ts`) reads
 * the same numbers the OPPOSITE way — terminal, not transient — for Clerk's email-code steps, so it is a different
 * rule and stays there.
 */

/**
 * Whether a status means the stage will recover on its own. Pure.
 *
 * @param status - An HTTP response status.
 * @returns `true` for `429` and every `5xx`.
 */
export function isTransientStatus(status: number): boolean {
    return status === 429 || status >= 500;
}
