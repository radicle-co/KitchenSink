/**
 * @module test-utils/expoLinearGradientStub — jsdom stand-in for `expo-linear-gradient`, aliased in by
 * `vitest.native.config.ts`. The real module bridges to a native view with no jsdom runtime; the U8 brand
 * surfaces (`@commise/ui/surface` GradientSurface, the Button primary CTA) paint through its
 * `LinearGradient`. The stub renders a react-native-web `View`, marks the gradient path via `dataSet`, and
 * forwards children so tests can assert presence + the projected colours. Real gradient rendering is
 * emulator-only (Maestro).
 */
import type { FC, ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

export interface LinearGradientProps extends ViewProps {
    readonly colors: readonly string[];
    readonly locations?: readonly number[];
    readonly start?: { readonly x: number; readonly y: number };
    readonly end?: { readonly x: number; readonly y: number };
    readonly children?: ReactNode;
}

// `dataSet` is a react-native-web runtime prop (→ DOM data-* attributes) absent from react-native's
// ViewProps type; widen the View once so the stub typechecks under the real RN types tsc resolves.
const MarkedView = View as unknown as FC<ViewProps & { readonly dataSet?: Record<string, string | undefined> }>;

export const LinearGradient: FC<LinearGradientProps> = ({ colors, locations, start, end, children, ...rest }) => (
    <MarkedView {...rest} dataSet={{ commiseStub: 'linear-gradient', colors: colors.join('|') }}>
        {children}
    </MarkedView>
);
