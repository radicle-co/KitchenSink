/**
 * Invariants for the NATIVE leg of the backdrop-blur capability probe (`blurSupport.native.ts`).
 *
 * The leaf is a thin adapter: it reads React Native's STATIC `Platform.OS` and defers the whole decision to
 * the pure, platform-neutral `supportsNativeBlur` predicate (exhaustively covered per host in
 * `tokens/__tests__/gradients.test.ts`). Keeping the branch logic in the pure predicate is what makes the
 * android/ios/web cases testable at all — a probe that inlined `Platform.OS === 'ios'` could only ever be
 * observed on whatever host the test runner happens to be.
 *
 * Under this suite `react-native` is aliased to `react-native-web`, so `Platform.OS` is `'web'` — which the
 * predicate reports as blur-capable (expo-blur's web implementation is a real `backdrop-filter`). So this
 * file pins the WIRING (the adapter defers to the predicate for the host it actually runs on), not the
 * per-platform truth table.
 */
import { describe, expect, it } from 'vitest';
import { Platform } from 'react-native';

import { supportsNativeBlur } from '../../tokens/gradients.js';
import { isBlurSupported } from '../blurSupport.native.js';

describe('isBlurSupported (native leg)', () => {
    it('defers to the pure supportsNativeBlur predicate for the host it runs on', () => {
        // Not hardcoded to `true`: this asserts the adapter AGREES with the predicate. Inverting the leaf's
        // logic, or hardcoding either answer, breaks this on some host.
        expect(isBlurSupported()).toBe(supportsNativeBlur(Platform.OS));
    });

    it('is a stable, side-effect-free read — repeated calls agree', () => {
        expect(isBlurSupported()).toBe(isBlurSupported());
    });
});
