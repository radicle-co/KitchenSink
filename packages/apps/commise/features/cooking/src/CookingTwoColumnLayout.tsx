/**
 * @module CookingTwoColumnLayout — the web two-column layout at L2 and L3: the ingredients column in a slot of
 * `INGREDIENTS_COLUMN` width on the left that scrolls on its own, and the step column in the rest, at most
 * `COOKING_COLUMN` wide and centred in it, as a flex column that may shrink, so a step body fills its height and keeps
 * its footer pinned. The slot is on the canvas with no divider, and its content is inset 16 on every side inside the
 * scroll, so the scroll bar stays at the slot edge. It holds no state and reads no script band: the slot is hidden under the two-column band by `TWO_COLUMN.columnWebClassName`, so the
 * step column alone is left, centred, as the one column.
 * The native twin is `CookingTwoColumnLayout.native.tsx`, on the same props.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';

import { COOKING_COLUMN, INGREDIENTS_COLUMN, TWO_COLUMN } from './cookingLayout.js';
import type { CookingTwoColumnLayoutProps } from './cookingTwoColumnLayoutProps.js';

/** The web two-column layout. */
export const CookingTwoColumnLayout: FC<CookingTwoColumnLayoutProps> = ({ column, children }) => (
    <div className="flex min-h-0 flex-1">
        <div
            className={`${TWO_COLUMN.columnWebClassName} ${INGREDIENTS_COLUMN.webClassName} shrink-0 overflow-y-auto bg-canvas p-4`}
        >
            {column}
        </div>
        <div className="flex min-w-0 flex-1 justify-center">
            <div className={`flex min-h-0 w-full flex-col ${COOKING_COLUMN.webClassName}`}>{children}</div>
        </div>
    </div>
);
