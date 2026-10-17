/**
 * @module @commise/ui/tooltip — the contract of the design-system `Tooltip`: a short visual label for a control whose
 * accessible name already says the same words (the collapsed sidebar rail's icon-only controls).
 *
 * WEB ONLY. PLATFORM-FORK (`docs/CODING_STANDARDS.md` §14.3): there is no native leaf, by design. A tooltip exists for a
 * pointer hovering or a keyboard focusing, and a phone has neither; the one surface that needs it, the collapsed
 * sidebar rail, does not exist on mobile (ownerDecisions D5). A touch or screen-reader user gets the control's own
 * accessible name, which is the tooltip's words by construction.
 */
import type { ReactNode } from 'react';

/** Where the tip sits: `end` is the side the reading direction runs towards (right in English). */
export type TooltipSide = 'end' | 'top' | 'bottom';

/** The `Tooltip` contract. */
export interface TooltipProps {
    /**
     * The words. ⛔ They must be the wrapped control's own accessible name (or part of it): the tip is `aria-hidden`
     * and adds no description, so it carries nothing a non-visual user would miss.
     */
    readonly label: string;
    /** Where the tip sits. Default `end`. */
    readonly side?: TooltipSide;
    /** The wrapper is a block that fills its row (`block`) instead of hugging the control (`inline-flex`): for a full-width row. */
    readonly fill?: boolean;
    /** The control. Focus and pointer events reach the tooltip from it, so it needs no props of its own. */
    readonly children: ReactNode;
}
