/**
 * Vitest stand-in for `expo-crypto` (F1 — the event-id minter's native leaf). The real module binds
 * native code jsdom cannot load; under vitest the Web Crypto global exists, so the stub answers real
 * UUIDs.
 */
export function randomUUID(): string {
    return crypto.randomUUID();
}

/** The timer id's native leaf draws its random bytes here; the Web Crypto global answers as the device would. */
export function getRandomBytes(byteCount: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(byteCount));
}
