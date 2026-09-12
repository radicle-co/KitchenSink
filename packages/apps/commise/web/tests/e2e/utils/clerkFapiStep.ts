/**
 * Which Clerk email-code step a browser response belongs to, read from its URL path.
 *
 * The two email-code flows verify against their in-flight attempt with a `prepare_*` send and an `attempt_*`
 * check (`/v1/client/sign_ins/sia_…/prepare_second_factor`, `/v1/client/sign_ups/sua_…/attempt_verification`).
 * `submitClerkEmailCode` watches those responses so that a REFUSED step fails the spec at once, named, rather
 * than as a heading timeout followed by a recovery that spends a second verification.
 *
 * ⛔ Built from path segments only, and without the attempt id: the query string of every Frontend API call
 * made by a development instance carries the dev-browser JWT (`__clerk_db_jwt`).
 */

/** The attempt collection an email-code flow verifies against. */
export type ClerkAttempt = 'sign_ins' | 'sign_ups';

/**
 * The step name — `"<attempt> <action>"` — or `null` when the URL is not a prepare/attempt call on `attempt`.
 * Pure.
 *
 * @param url - A response URL.
 * @param attempt - The collection this flow verifies against.
 * @returns The step, or `null`.
 */
export function clerkFapiStep(url: string, attempt: ClerkAttempt): string | null {
    let pathname: string;

    try {
        pathname = new URL(url).pathname;
    } catch {
        return null;
    }

    const match = new RegExp(`/v1/client/${attempt}/[^/]+/((?:prepare|attempt)_[a-z_]+)$`, 'u').exec(pathname);

    return match?.[1] === undefined ? null : `${attempt} ${match[1]}`;
}

/**
 * Whether a refused email-code step ends the flow, rather than being the race its Resend recovery handles. Pure.
 *
 * A refused SEND (`prepare_*`, any non-2xx) is terminal: re-sending only spends another verification into the
 * same refusal. A refused CHECK (`attempt_*`) is terminal only when throttled (429) or failed (5xx); an ordinary
 * 4xx there is Clerk's "send a verification code before attempting to verify" — the early-entry race
 * `submitClerkEmailCode` recovers from by re-sending.
 *
 * @param step - A name from {@link clerkFapiStep}.
 * @param status - The response status.
 * @returns `true` when the flow must stop and report the refusal.
 */
export function isTerminalRefusal(step: string, status: number): boolean {
    if (status < 400) {
        return false;
    }

    return step.includes(' prepare_') || status === 429 || status >= 500;
}
