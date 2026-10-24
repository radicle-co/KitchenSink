/**
 * @module tests/stubs/expoLinearGradient — jsdom stand-in for `expo-linear-gradient`, aliased in by
 * `vitest.native.config.ts`. The real module bridges to a native view absent under jsdom; the mobile
 * leaves (GradientSurface, the Button primary CTA) paint via its `LinearGradient`. The stub renders a
 * react-native-web `View`, marks the gradient path via `dataSet`, and forwards children so tests can
 * assert presence + the projected colours. Real gradient rendering is emulator-only (Maestro).
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

/** Serialize a unit-square point for assertion, or `undefined` when the prop was not supplied. Pure. */
function point(value: LinearGradientProps['start']): string | undefined {
    return value === undefined ? undefined : `${value.x},${value.y}`;
}

export const LinearGradient: FC<LinearGradientProps> = ({ colors, locations, start, end, children, ...rest }) => (
    <MarkedView
        {...rest}
        dataSet={{
            commiseStub: 'linear-gradient',
            colors: colors.join('|'),
            // `locations`/`start`/`end` are exposed so a test can assert the gradient's DIRECTION and stop
            // placement, not just its palette. Without them a leaf that projected a mirrored or degenerate
            // vector (e.g. every stop at 0, or bottom-right → top-left) rendered flat on device while the
            // colour-only assertion stayed green.
            locations: locations?.join('|'),
            start: point(start),
            end: point(end),
        }}
    >
        {children}
    </MarkedView>
);
