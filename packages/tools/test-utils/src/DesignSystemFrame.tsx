/**
 * The design-system frame the shared render helpers put around a tree, web leaf. Web styles with Tailwind and never
 * loads Tamagui (ADR-0080), so the frame adds nothing. A native test lane resolves the `.native` sibling instead, which
 * mounts the design system's Tamagui provider.
 *
 * One frame per tree: a native test renders through the shared helpers here, or through `@commise/ui/testing/tamagui`
 * for a design-system leaf's own test, never both around one tree.
 *
 * @pattern Null Object — web leaf; the .native sibling mounts DesignSystemProvider
 */
import type { JSX, ReactNode } from 'react';

/**
 * Pass `children` through unchanged.
 *
 * @param props - The tree.
 * @returns `children`.
 */
export function DesignSystemFrame({ children }: { readonly children: ReactNode }): JSX.Element {
    return <>{children}</>;
}
