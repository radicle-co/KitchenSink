/**
 * Vitest stub for `expo-linear-gradient`. The real module bridges to a native view that has no
 * jsdom/react-native-web implementation, so the native component tests alias the import here. The stub
 * renders a react-native-web `View` (→ a DOM node) that forwards the gradient props and children, and
 * marks itself via `dataSet` so a test can assert the gradient path was taken (`[data-commise-stub]`)
 * without any production test id. Mirrors the real `LinearGradientProps` surface the leaves rely on.
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

export const LinearGradient: FC<LinearGradientProps> = ({ colors, locations, start, end, children, ...rest }) => (
    <View {...rest} dataSet={{ commiseStub: 'linear-gradient', colors: colors.join('|') }}>
        {children}
    </View>
);
