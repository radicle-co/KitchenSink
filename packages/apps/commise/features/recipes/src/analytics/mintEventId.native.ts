/**
 * Analytics U5 — the event-id minter, NATIVE leaf (staff-architect REVIEW F1).
 *
 * ⛔ Hermes has NO `crypto` global (verified against RN 0.86's core setup and Expo 57's winter
 * runtime, which installs `TextDecoder`/`URL`/`fetch` and not `crypto`), so this leaf delegates to
 * `expo-crypto` — a real native UUID, not a polyfill hung on a global nothing else installs. Metro
 * and the vitest native configs resolve this sibling; web bundlers never see it.
 */
import * as Crypto from 'expo-crypto';

/** Mint one RFC 4122 v4 id — the KTD5 idempotency key, minted at session start. */
export function mintEventId(): string {
    return Crypto.randomUUID();
}
