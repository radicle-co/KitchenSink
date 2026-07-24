/**
 * Native (jsdom) test setup. jsdom does not implement `window.matchMedia`, which Tamagui touches at import
 * time; provide a minimal no-op so components that pull in Tamagui render under the native test env.
 */

// `__DEV__` is a React Native runtime global that jsdom lacks; some expo/RN modules read it at import time.
// The vitest config also `define`s it, but set it on globalThis for any module evaluated before that applies.
(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).matchMedia = (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
    });
}
