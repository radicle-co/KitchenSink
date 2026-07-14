/**
 * Native (jsdom) test setup. jsdom does not implement `window.matchMedia`, which Tamagui touches at import
 * time; provide a minimal no-op so components that pull in Tamagui render under the native test env.
 */
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
