/**
 * The design system's Tamagui provider in a given scheme (ADR-0080): the one place the Tamagui config and a scheme are
 * paired. Presentational: the scheme in, the themed tree out. The app reaches it only through `DesignSystemProvider`,
 * which supplies the device's scheme. A test that asserts both schemes without faking the device mounts it directly
 * (`renderWithTamagui`).
 *
 * @pattern Adapter over `TamaguiProvider` — a scheme name in, Tamagui's provider with the one config out
 */
import type { JSX, ReactNode } from 'react';
import { TamaguiProvider } from 'tamagui';

import type { ColorSchemeName } from '../theme/themeFor.js';
import { tamaguiConfig } from './tamaguiConfig.native.js';

/**
 * Mount the design system around `children` in a given scheme.
 *
 * @param props - The scheme, and the subtree to theme.
 * @returns `children` inside Tamagui's provider.
 */
export function DesignSystemTheme({
    scheme,
    children,
}: {
    readonly scheme: ColorSchemeName;
    readonly children: ReactNode;
}): JSX.Element {
    return (
        <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme}>
            {children}
        </TamaguiProvider>
    );
}
