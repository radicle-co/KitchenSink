/**
 * @module @commise/ui/surface-tone — the platform-neutral prop contract of {@link Surface}, the container that states
 * what it is painted (`componentFixes.md` §10). The web (`Surface.tsx`) and native (`Surface.native.tsx`) leaves both
 * implement it; each ignores the one hook that belongs to the other platform.
 */
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import type { SurfaceTone } from './surfaceTone.js';

/** What a surface takes. */
export interface SurfaceProps {
    /** The surface it paints, and so the surface every control inside it reads. */
    readonly tone: SurfaceTone;
    readonly children?: ReactNode;
    /** An accessible name, which makes the surface a named group. Optional: most surfaces are only paint. */
    readonly accessibilityLabel?: string;
    /** Web only: extra utility classes for the surface's element (layout, radius, padding). Ignored on native. */
    readonly className?: string;
    /** Web only: the element. Defaults to `div`. Ignored on native. */
    readonly as?: 'div' | 'section';
    /** Native only: extra style for the surface's `View` (layout, radius, padding). Ignored on web. */
    readonly style?: StyleProp<ViewStyle>;
}
