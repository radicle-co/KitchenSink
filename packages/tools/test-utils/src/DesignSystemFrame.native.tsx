/**
 * The design-system frame the shared render helpers put around a tree, native leaf: the design system's Tamagui
 * provider, in the scheme the device reports (ADR-0080). A component built on Tamagui throws for a missing theme
 * without it. The web leaf adds nothing, and a native test lane picks this leaf through `preferNativeLeaves`.
 *
 * One frame per tree: a native test renders through the shared helpers here, or through `@commise/ui/testing/tamagui`
 * for a design-system leaf's own test, never both around one tree.
 *
 * @pattern Strategy — the native leaf of the platform frame; it mounts DesignSystemProvider
 */
import { DesignSystemProvider } from '@commise/ui/tamagui-provider';
import type { JSX, ReactNode } from 'react';

/**
 * Mount the design system around `children`.
 *
 * @param props - The tree.
 * @returns `children` inside the design system's provider.
 */
export function DesignSystemFrame({ children }: { readonly children: ReactNode }): JSX.Element {
    return <DesignSystemProvider>{children}</DesignSystemProvider>;
}
