/**
 * @module tokens/layout — the ONE numeric source for breakpoints, container thresholds, content widths, gutters and
 * spacing roles (`docs/design/uiOverhaul/buildSpec.md` §1.2, §1.3, §1.6; blueprint A8).
 *
 * Web reads these numbers as `rem` custom properties in `theme.css` (`themeCss.ts`); native reads them through
 * `layout/containerClass.ts`. Pixels here, unit-neutral, like `scale.ts`. Pure data.
 *
 * ## Two kinds of threshold, and why they are different numbers
 *
 * - **Viewport** classes decide the SHELL and the gutter only (compact < 600 ≤ medium < 840 ≤ expanded, Android's
 *   window size classes). The sidebar replaces the tab bar at 840 (owner decision D5), on web only.
 * - **Container** classes decide everything inside `<main>` (narrow < 600 ≤ regular < 960 ≤ wide), measured on the
 *   width content actually gets: `<main>`'s content box on web, the window less its gutters on native.
 *
 * ## ⚠️ The widest content width is `page`, not the spec's `content-wide`
 *
 * Tailwind v4's `--container-*` namespace drives BOTH `max-w-*` and the `@{name}/main:` container variants, and the
 * container threshold `wide` lives in the same namespace. A content width named `wide` would therefore make
 * `@wide/main:` fire at 1440 instead of 960. So the 1440 width is `page`; the max-width utility named `wide` exists,
 * equals the 960 threshold, and is never used as a width. The compiled behaviour is asserted by
 * `web/tests/__integration__/tailwindTheme.integration.test.ts`.
 */
import { spacing } from './scale.js';

/** The viewport (window) thresholds, px. A width at a threshold is in the class above it. */
export const viewportThreshold = {
    medium: 600,
    expanded: 840,
} as const;

/** The container thresholds, px, on the width content gets. A width at a threshold is in the class above it. */
export const containerThreshold = {
    regular: 600,
    wide: 960,
} as const;

/** The content widths, px (§1.3): the most a column of each kind may take. Left-aligned to the gutter. */
export const contentWidth = {
    reading: 640,
    list: 768,
    detail: 1152,
    page: 1440,
} as const;

/** The page gutter per viewport class, px (§1.2). Padding on `<main>` on web. */
export const gutter = {
    compact: 16,
    medium: 24,
    expanded: 32,
} as const;

/** A container class: the layout content takes at the width it gets. */
export type ContainerClass = 'narrow' | 'regular' | 'wide';

/** A viewport class: the shell's layout at the window's width. */
export type ViewportClass = keyof typeof gutter;

/** A value that differs by container class. */
export type PerContainerClass<T> = Readonly<Record<ContainerClass, T>>;

/**
 * The spacing roles, px (§1.6), on the 4 px ramp. Space between groups is always larger than space within them.
 * `gapGrid` widens above `@narrow`.
 */
export const spacingRole = {
    gapInline: spacing[1],
    gapWithin: spacing[2],
    gapGroup: spacing[4],
    gapSection: spacing[6],
    gapGrid: { narrow: spacing[4], regular: spacing[5], wide: spacing[5] },
    headerToContent: spacing[5],
    gapRow: spacing[3],
} as const satisfies Record<string, number | PerContainerClass<number>>;
