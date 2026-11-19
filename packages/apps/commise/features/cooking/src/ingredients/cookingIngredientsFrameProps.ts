/**
 * @module cookingIngredientsFrameProps — the props of the two frames around the one cooking ingredients list, on web and
 * native. The screen picks the sheet at L1 and L1w and the column at L2 and L3 by `layoutBand`, so there is no mode
 * prop. Each frame draws the title once (the list draws none) and neither draws a Done: the sheet's × is the one close
 * (designer's D73).
 */
import type { CookingMessages } from '../messages.js';

import type { CookingIngredientsListProps } from './cookingIngredientsListProps.js';

/** The pinned column, always open at L2 and L3: the list's props, with no close. */
export type CookingIngredientsColumnProps = CookingIngredientsListProps;

/** The bottom sheet at L1 and L1w. */
export interface CookingIngredientsSheetProps extends Omit<CookingIngredientsListProps, 'copy'> {
    /** The Clear ticks label, and the accessible name of the sheet's × close. */
    readonly copy: Pick<CookingMessages['ingredients'], 'clear' | 'close'>;
    readonly open: boolean;
    /** Every close route calls this: ×, swipe down, the scrim, Escape on web, Back on Android. */
    readonly onClose: () => void;
}
