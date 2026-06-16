/**
 * Pure force-sample membership test for the `tracesSampler`.
 *
 * The force-sample gate is **server-side and non-bypassable by clients**: the set of force-sampled
 * Clerk subs comes from an out-of-band, admin-set store (e.g. an SSM parameter / short-TTL table)
 * that the runtime's sampler loads and passes here — NOT from a client-supplied `x-debug-trace`
 * header or baggage entry, which an anonymous caller on the public ALB could forge. The sampler runs
 * before any auth middleware, so this predicate must depend only on trusted (out-of-band) state.
 *
 * This function only tests membership; loading `forcedSubs` is the runtime's responsibility.
 */
export const isForceSampled = (sub: string | undefined, forcedSubs: ReadonlySet<string>): boolean =>
    sub !== undefined && sub.length > 0 && forcedSubs.has(sub);
