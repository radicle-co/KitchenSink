/**
 * @module @commise/features-recipes/hooks — the pure rules of the cook's own limit on source lookups
 * (`docs/design/rowEditorOpenDecisions.md` item 10): whether it stands, and the minute it is stated until. Apart from
 * the session's holder (`useSourceLimit.ts`) so a module a server renders can read them without React's hooks.
 */

const MINUTE_MS = 60_000;

/**
 * Whether the limit stands at `now`. Pure.
 *
 * @param limit - The held limit: when it ends, in epoch milliseconds, or `undefined` while none is held.
 * @param now - The time to judge at, in epoch milliseconds.
 * @returns `true` before the held time.
 */
export const isSourceLimited = (limit: { readonly retryAt: number | undefined }, now: number): boolean =>
    limit.retryAt !== undefined && now < limit.retryAt;

/**
 * The time a limit is held and stated until: `until` rounded UP to the next minute, so the minute a surface states never
 * fails (item 10). Pure.
 *
 * @param until - When the limit ends, in epoch milliseconds.
 * @returns The next whole minute at or after it.
 */
export const limitEndOf = (until: number): number => Math.ceil(until / MINUTE_MS) * MINUTE_MS;
