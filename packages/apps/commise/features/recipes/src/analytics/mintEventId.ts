/**
 * Analytics U5 — the event-id minter, WEB leaf (staff-architect REVIEW F1).
 *
 * ⛔ A PLATFORM SEAM on purpose, not an inlined `crypto.randomUUID()`: Hermes ships no `crypto`
 * global and Expo's winter runtime does not install one, so the bare global inside the shared
 * resolver hook would throw on the first successful ingredient search on a device. Metro (and both
 * vitest native configs) resolve the `.native.ts` sibling, which delegates to `expo-crypto`; every
 * web bundler resolves this leaf, where the Web Crypto global is guaranteed. The pure session model
 * takes minting as a PARAMETER (`observeServedList`'s `mintId`) — this seam is what the hook passes.
 */

/** Mint one RFC 4122 v4 id — the KTD5 idempotency key, minted at session start. */
export function mintEventId(): string {
    return crypto.randomUUID();
}
