/**
 * Vitest stand-in for `expo-crypto` under the native lane. The real module binds native code jsdom cannot load (its
 * `__DEV__` global is a React Native one). Under vitest the Web Crypto global exists, so the stub answers real random
 * bytes, as the device would.
 */
export function getRandomBytes(byteCount: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(byteCount));
}
