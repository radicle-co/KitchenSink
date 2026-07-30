/**
 * Native (jsdom) test setup. jsdom does not implement `window.matchMedia`, which Tamagui touches at import
 * time; provide a minimal no-op so components that pull in Tamagui render under the native test env.
 */
import { configure } from '@testing-library/react';

/**
 * Testing Library's async utilities (`findBy*`, `waitFor`) default to a 1000ms budget. Several screens here
 * gate their UI behind a REAL 250ms debounce (`DISCOVERY_SEARCH_DEBOUNCE_MS`) — comfortable locally, but the
 * CI `Test` job runs the whole monorepo's suites as 39 concurrent turbo tasks, and event-loop contention can
 * eat the remaining ~750ms. That surfaced as `RecipeDiscoveryScreen.native.test.tsx` failing to find
 * "Filter by Flour" in CI while passing 5/5 locally in isolation.
 *
 * Raising the budget does NOT weaken any assertion: every `findBy*` still requires the element to actually
 * appear, and a genuinely missing element still fails — just after a longer wait. The alternative, fake
 * timers, would be deterministic but would defeat the debounce tests that deliberately assert real timing
 * behaviour (`echoes the typed value immediately but debounces the value fed to the query`).
 */
configure({ asyncUtilTimeout: 5_000 });

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
