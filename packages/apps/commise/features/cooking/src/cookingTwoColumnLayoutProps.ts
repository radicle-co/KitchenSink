/**
 * @module cookingTwoColumnLayoutProps — the props of the two-column layout at L2 and L3, on web and native: the
 * ingredients column and the step column. The screen picks this layout by `layoutBand`, so it has no band or mode prop.
 */
import type { ReactNode } from 'react';

/** What `CookingTwoColumnLayout` (web and native) is given. */
export interface CookingTwoColumnLayoutProps {
    /** The ingredients column, drawn in a fixed slot on the left that scrolls on its own. */
    readonly column: ReactNode;
    /** The step column: at most `COOKING_COLUMN.maxPx` wide and centred in the space the slot leaves. */
    readonly children: ReactNode;
}
