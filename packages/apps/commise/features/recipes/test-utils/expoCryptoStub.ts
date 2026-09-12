/**
 * Vitest stand-in for `expo-crypto` (F1 — the event-id minter's native leaf). The real module binds
 * native code jsdom cannot load; under vitest the Web Crypto global exists (Node 20+/jsdom), so the
 * stub answers real UUIDs without a node: import this browser-typed project cannot name.
 */
export function randomUUID(): string {
    return crypto.randomUUID();
}
