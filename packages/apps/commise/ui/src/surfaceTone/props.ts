/**
 * @module @commise/ui/surface-tone — the platform-neutral prop contract of {@link Surface}, the container that states
 * what it is painted (`componentFixes.md` §10). The web (`Surface.tsx`) and native (`Surface.native.tsx`) leaves both
 * implement it; each ignores the one hook that belongs to the other platform.
 */
import type { ReactNode } from 'react';
import type { LayoutChangeEvent, StyleProp, ViewProps, ViewStyle } from 'react-native';

import type { SurfaceTone } from './surfaceTone.js';

/** What a surface takes. */
export interface SurfaceProps {
    /** The surface it paints, and so the surface every control inside it reads. */
    readonly tone: SurfaceTone;
    readonly children?: ReactNode;
    /** The surface's ARIA role, when it has one (`group`, `alert`, `complementary`). Absent: the surface is only paint. */
    readonly role?: ViewProps['role'];
    /** The surface's accessible name. Optional: most surfaces are only paint. */
    readonly 'aria-label'?: string;
    /** Web only: extra utility classes for the surface's element (layout, radius, padding). Ignored on native. */
    readonly className?: string;
    /** Web only: the element. Defaults to `div`. Ignored on native. */
    readonly as?: 'div' | 'section';
    /** Native only: extra style for the surface's `View` (layout, radius, padding). Ignored on web. */
    readonly style?: StyleProp<ViewStyle>;
    /** Native only: keep the `View` in the native tree. Ignored on web. */
    readonly collapsable?: boolean;
    /** Native only: the surface's layout, for a bar that is measured. Ignored on web. */
    readonly onLayout?: (event: LayoutChangeEvent) => void;
    /** Native only: announce changes inside the surface. Ignored on web (use `role="status"`). */
    readonly accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
}
