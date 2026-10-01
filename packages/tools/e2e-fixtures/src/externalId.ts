/**
 * Wait for a freshly-created Clerk user to acquire the `external_id` the services authorize on.
 *
 * ## Why this cannot be skipped, and why the client's own retry does not cover it
 *
 * A service resolves the caller by the token's `external_id` claim — the app-user ULID — not by Clerk's
 * `sub`. That claim is written by the Clerk WEBHOOK (`identityWebhook.ts`), which is a separate,
 * asynchronous path: Clerk → API Gateway → a VPC Lambda → RDS → a Clerk `PATCH`. A token minted moments
 * after `createUser` therefore carries no `external_id`, and every call answers `401` with
 * `code: IDENTITY_SYNC_PENDING`.
 *
 * ⛔ `RecipeServiceClient`'s `maxIdentitySyncRetries` does NOT close this. That retries a token REFRESH,
 * and a refresh cannot conjure a claim the webhook has not written yet — it only helps once the backfill
 * has landed and the cached token predates it. Waiting for the fact itself is the caller's job.
 *
 * ⚠️ The deadline is a MEASURED value, not a guess: the webhook Lambda is DB-bound, and ADR-0007 stops the
 * sandbox RDS overnight, so a run dispatched inside that window can wait forever. That is precisely why the
 * failure names the window instead of timing out anonymously.
 */

/** How often to re-read, and how long to wait. Both injected so the unit tests run instantly. */
export interface AwaitExternalIdOptions {
    readonly deadlineMs: number;
    readonly pollMs: number;
    /** Reads the user's current `externalId`; `null`/`undefined` means "not yet". */
    readonly read: () => Promise<string | null | undefined>;
    /** Injected clock and sleep, so a test never actually waits. */
    readonly now: () => number;
    readonly sleep: (ms: number) => Promise<void>;
}

/**
 * The default deadline. Generous on purpose: the cost of waiting sixty seconds once per run is nothing
 * against the cost of a whole emulator job failing on a race, and the failure below is unambiguous.
 */
export const EXTERNAL_ID_DEADLINE_MS = 90_000;

/** The default poll interval. */
export const EXTERNAL_ID_POLL_MS = 2_000;

/**
 * Resolve to the user's `external_id`, or throw once the deadline passes.
 *
 * ⛔ It THROWS rather than returning `undefined`. An absent `external_id` is not a degraded state a caller
 * can proceed through — every subsequent call would `401`, and the run would report a wall of unrelated
 * failures instead of the one fact that explains them.
 *
 * @sideEffect Calls `read` repeatedly and sleeps between attempts.
 */
export async function awaitExternalId(email: string, options: AwaitExternalIdOptions): Promise<string> {
    const started = options.now();

    for (;;) {
        const externalId = await options.read();

        if (externalId !== null && externalId !== undefined && externalId !== '') {
            return externalId;
        }

        if (options.now() - started >= options.deadlineMs) {
            throw new Error(
                `${email} still has no external_id after ${options.deadlineMs}ms. The Clerk webhook backfills ` +
                    'it through a DB-bound VPC Lambda, so the usual causes are: the webhook is failing, or the ' +
                    'sandbox RDS is inside its ADR-0007 nightly stop window (00:00-09:00 ET).',
            );
        }

        await options.sleep(options.pollMs);
    }
}
