/**
 * Vitest stub for `expo-blur`. The real `BlurView` bridges to a native blur view with no jsdom/
 * react-native-web implementation, so the native component tests alias the import here. The stub renders
 * a react-native-web `View` (→ a DOM node) forwarding children, and marks itself via `dataSet` so a test
 * can assert the blur path was taken (`[data-commise-stub="blur-view"]`) vs. the solid fallback — with no
 * production test id. Mirrors the `BlurViewProps` the leaves rely on.
 */
import type { FC, ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

export interface BlurViewProps extends ViewProps {
    readonly intensity?: number;
    readonly tint?: 'light' | 'default' | 'dark';
    readonly children?: ReactNode;
}

export const BlurView: FC<BlurViewProps> = ({ intensity, tint, children, ...rest }) => (
    <View {...rest} dataSet={{ commiseStub: 'blur-view', intensity: String(intensity), tint }}>
        {children}
    </View>
);
