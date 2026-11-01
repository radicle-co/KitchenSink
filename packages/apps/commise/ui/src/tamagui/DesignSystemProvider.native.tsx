/**
 * @module @commise/ui/tamagui-provider — the design system's Tamagui provider (ADR-0080). Native-only, like the config
 * it mounts: web styles with Tailwind and never loads Tamagui.
 *
 * Orchestration, not a render leaf: it reads the device's scheme (`useColorSchemeName`, the one place native code
 * reads it) and hands it to `DesignSystemTheme`, the one place the Tamagui config and a scheme are paired. The app's
 * provider tree mounts it, and so do the test renders (`@commise/ui/testing/tamagui`, and `@commise/test-utils` in a
 * native lane), so a component test paints in the scheme the app would. A change of device scheme re-themes the tree
 * (D17).
 *
 * @pattern Facade over `TamaguiProvider` — the device's scheme and the config are bound behind it, so a caller mounts
 *     one component
 */
import type { JSX, ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

import { useColorSchemeName } from '../theme/useColorSchemeName.native.js';
import { DesignSystemTheme } from './DesignSystemTheme.native.js';

/**
 * Mount the design system around `children`, in the device's scheme.
 *
 * @param props - The subtree to theme.
 * @returns `children` inside Tamagui's provider.
 */
export function DesignSystemProvider({ children }: { readonly children: ReactNode }): JSX.Element {
    return (
        <DesignSystemTheme scheme={useColorSchemeName()} textScale={useWindowDimensions().fontScale}>
            {children}
        </DesignSystemTheme>
    );
}
