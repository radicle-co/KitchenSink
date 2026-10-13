/**
 * @module @commise/ui/tooltip — where the tip sits relative to its control, in the page's reading direction.
 */
import type { Placement } from '@floating-ui/react-dom';

import type { TooltipSide } from './props.js';

/**
 * @param side - The side, with `end` following the reading direction (the side a row's text runs towards).
 * @param direction - The page's `dir`.
 * @returns Floating UI's physical placement. Pure.
 */
export function placementFor(side: TooltipSide, direction: 'ltr' | 'rtl'): Placement {
    switch (side) {
        case 'end':
            return direction === 'rtl' ? 'left' : 'right';
        case 'top':
            return 'top';
        case 'bottom':
            return 'bottom';
    }
}

/**
 * The padding that joins the tip to its control. A gap between them would end the hover the moment the pointer crossed
 * it, so the tip's hit box reaches the control instead, and the label sits 16 px from it.
 *
 * @param placement - The placement Floating UI settled on (after any flip).
 * @returns The padding classes, wide on the side facing the control. Pure.
 */
export function bridgeClassFor(placement: Placement): string {
    switch (placement.split('-')[0]) {
        case 'left':
            return 'pr-4 pl-2 py-2';
        case 'top':
            return 'pb-4 pt-2 px-2';
        case 'bottom':
            return 'pt-4 pb-2 px-2';
        default:
            return 'pl-4 pr-2 py-2';
    }
}
