/**
 * @module CookingTwoColumnLayout — the web two-column layout at L2 and L3: the ingredients column in a 300 wide slot on
 * the left that scrolls on its own, and the step column in the rest, at most 680 wide and centred in it. The slot is on
 * the canvas with no divider, and its content is inset 16 on every side inside the scroll, as the house sheet's edge
 * is, so the scroll bar stays at the slot edge. It holds no state and reads no band: the screen picks it by
 * `layoutBand`. The native twin is `CookingTwoColumnLayout.native.tsx`, on the same props.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';

import { COOKING_COLUMN, INGREDIENTS_COLUMN } from './cookingLayout.js';
import type { CookingTwoColumnLayoutProps } from './cookingTwoColumnLayoutProps.js';

/** The web two-column layout. */
export const CookingTwoColumnLayout: FC<CookingTwoColumnLayoutProps> = ({ column, children }) => (
    <div className="flex min-h-0 flex-1">
        <div className={`${INGREDIENTS_COLUMN.webClassName} shrink-0 overflow-y-auto bg-canvas p-4`}>{column}</div>
        <div className="flex min-w-0 flex-1 justify-center">
            <div className={`w-full ${COOKING_COLUMN.webClassName}`}>{children}</div>
        </div>
    </div>
);
