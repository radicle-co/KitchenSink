/**
 * @module @commise/ui/testing/safe-area-context — a stand-in for `react-native-safe-area-context` under jsdom, for
 * the native suites to alias in (`vitest.native.config.ts`). The real package bridges to a native module that
 * reports the device's window insets; there is no such runtime under jsdom.
 *
 * The insets are FIXED and NON-ZERO: `base + 0` padding cannot be told from padding that ignores the insets, which is
 * the defect an edge-to-edge Android `Modal` ships. A test that needs other values mocks the module itself.
 *
 * ⚠️ It lives HERE, beside the design system's inset-aware `Sheet`, rather than in `@commise/test-utils`, for the
 * reason `hardwareBack.native.ts` gives: that package depends on `@commise/ui`, so the design system cannot import
 * it back without a cycle. It is the ONE copy; every native suite aliases this file.
 *
 * Its two components are presentational pass-throughs: they render their children and hold no state.
 *
 * @pattern Stub — a test double presenting `react-native-safe-area-context`'s exported surface
 */
import { createContext, type FC, type ReactNode } from 'react';
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

/**
 * The context the real package publishes the insets through, holding {@link STUB_INSETS}. React Navigation reads it
 * directly (`SafeAreaInsetsContext.Consumer` in its bottom tabs, `useContext` in its provider shim), not the hook.
 */
export const SafeAreaInsetsContext = createContext<EdgeInsets | null>(STUB_INSETS);

/** The window metrics the real package measures before first render: a phone-sized frame and {@link STUB_INSETS}. */
export const initialWindowMetrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: STUB_INSETS,
} as const;

/** Pass-through provider: the stub serves a constant and needs no context. */
export const SafeAreaProvider: FC<{ readonly children?: ReactNode }> = ({ children }) => <>{children}</>;

/** Pass-through `SafeAreaView`, rendered as a plain react-native-web `View`. */
export const SafeAreaView: FC<ViewProps & { readonly children?: ReactNode }> = ({ children, ...rest }) => (
    <View {...rest}>{children}</View>
);
