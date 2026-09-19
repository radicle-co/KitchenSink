/**
 * Native (jsdom) test setup. jsdom does not implement `window.matchMedia`, which Tamagui touches at import
 * time; provide a minimal no-op so components that pull in Tamagui render under the native test env.
 */
import { AccessibilityInfo } from 'react-native';

import { configureAsyncUtilBudget } from '@commise/test-utils/async-util-budget';

configureAsyncUtilBudget();

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

/**
 * react-native-web (what `react-native` resolves to here) does not implement the two screen-reader calls the
 * native leaves make — moving the reading cursor and the iOS announcement — so any screen rendering a leaf that
 * uses them would throw `is not a function`. They are no-ops here, as they are on a device with no screen reader
 * running. A suite that asserts on them mocks `react-native` itself, which wins over this.
 */
if (typeof AccessibilityInfo.sendAccessibilityEvent !== 'function') {
    AccessibilityInfo.sendAccessibilityEvent = () => undefined;
}

if (typeof AccessibilityInfo.announceForAccessibilityWithOptions !== 'function') {
    AccessibilityInfo.announceForAccessibilityWithOptions = () => undefined;
}
