/**
 * @module tests/stubs/expoBlur — jsdom stand-in for `expo-blur`, aliased in by `vitest.native.config.ts`.
 * The real `BlurView` bridges to a native blur view absent under jsdom; the GlassCard native leaf renders
 * through it. The stub renders a react-native-web `View`, marks the blur path via `dataSet`, and forwards
 * children so tests can distinguish the frosted path from the solid fallback. Real blur is emulator-only.
 */
import type { FC, ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

export interface BlurViewProps extends ViewProps {
    readonly intensity?: number;
    readonly tint?: 'light' | 'default' | 'dark';
    readonly children?: ReactNode;
}

// `dataSet` is a react-native-web runtime prop (→ DOM data-* attributes) absent from react-native's
// ViewProps type; widen the View once so the stub typechecks under the real RN types tsc resolves.
const MarkedView = View as unknown as FC<ViewProps & { readonly dataSet?: Record<string, string | undefined> }>;

export const BlurView: FC<BlurViewProps> = ({ intensity, tint, children, ...rest }) => (
    <MarkedView {...rest} dataSet={{ commiseStub: 'blur-view', intensity: String(intensity), tint }}>
        {children}
    </MarkedView>
);
