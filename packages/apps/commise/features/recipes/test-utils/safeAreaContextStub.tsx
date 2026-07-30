/**
 * @module test-utils/safeAreaContextStub — jsdom stand-in for `react-native-safe-area-context`, aliased in
 * by `vitest.native.config.ts`. The real package bridges to a native module that reports the device's
 * window insets (status bar, navigation bar, notch); there is no such runtime under jsdom.
 *
 * The stub reports a FIXED, NON-ZERO inset set. Zeroes would make every inset-aware assertion vacuous —
 * padding computed as `base + 0` is indistinguishable from padding that ignores insets entirely, which is
 * exactly the defect the full-screen sheets shipped. Non-zero values keep those tests falsifiable. A test
 * that needs different values mocks the module itself.
 */
import type { FC, ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

/** The device insets every test sees: a status bar above, a navigation bar below, no side cutouts. */
export const STUB_INSETS = { top: 24, right: 0, bottom: 16, left: 0 } as const;

export interface EdgeInsets {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
}

/** The hook the real package exposes; returns {@link STUB_INSETS}. */
export const useSafeAreaInsets = (): EdgeInsets => STUB_INSETS;

/** Pass-through provider — the stub needs no context to serve a constant. */
export const SafeAreaProvider: FC<{ readonly children?: ReactNode }> = ({ children }) => <>{children}</>;

/** Pass-through `SafeAreaView`, rendered as a plain react-native-web `View`. */
export const SafeAreaView: FC<ViewProps & { readonly children?: ReactNode }> = ({ children, ...rest }) => (
    <View {...rest}>{children}</View>
);
