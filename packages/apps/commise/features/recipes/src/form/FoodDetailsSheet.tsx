'use client';

/**
 * @module @commise/features-recipes/form — `FoodDetailsSheet` (web): a quiet row's details, opened from its `⋯` Food
 * details (build spec §7.5.1). A healthy row shows no glyph, so its nutrition and explanation panels open here. Titled by
 * the row's food; its own focus return goes back to the `⋯` that opened it.
 *
 * Presentational: it frames the row's panel body over the field group's Food details view.
 *
 * @pattern Decorator — the sheet frame around the row's one panel body
 */
import { Sheet } from '@commise/ui/sheet';
import type { FC, ReactNode } from 'react';

import type { FoodDetailsView } from './useIngredientsFields.js';

/** Props for {@link FoodDetailsSheet}. */
export interface FoodDetailsSheetProps {
    readonly view: FoodDetailsView;
    readonly closeLabel: string;
    /** The row's panel body. */
    readonly children: ReactNode;
}

/** The Food details sheet. */
export const FoodDetailsSheet: FC<FoodDetailsSheetProps> = ({ view, closeLabel, children }) => (
    <Sheet
        open={view.open}
        onOpenChange={(next) => {
            if (!next) {
                view.onClose();
            }
        }}
        title={view.row?.displayName ?? ''}
        closeLabel={closeLabel}
        size="content"
    >
        <div className="text-body-sm text-ink">{children}</div>
    </Sheet>
);
