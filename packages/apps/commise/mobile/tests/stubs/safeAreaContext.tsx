/**
 * @module tests/stubs/safeAreaContext — jsdom stand-in for `react-native-safe-area-context`, aliased in by
 * `vitest.native.config.ts`. The real package's source is Flow-typed and bridges to a native module that
 * reports the device's window insets; under Vitest it fails to parse at all (`Unexpected token 'typeof'`).
 *
 * Mirrors `packages/apps/commise/features/recipes/test-utils/safeAreaContextStub.tsx` — the shared
 * `FullScreenSheet` native primitive reads `useSafeAreaInsets`, so any mobile screen composing a recipe
 * feature leaf pulls this module into the graph. Individual tests that need specific insets still
 * `vi.mock` the module themselves; that mock takes precedence over this alias.
 *
 * The insets are NON-ZERO on purpose: zeroes would make inset-aware assertions vacuous (`base + 0` is
 * indistinguishable from ignoring insets entirely — the very defect `FullScreenSheet` exists to prevent).
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
