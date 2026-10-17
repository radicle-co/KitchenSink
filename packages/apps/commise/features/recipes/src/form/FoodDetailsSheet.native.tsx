/**
 * @module @commise/features-recipes/form — `FoodDetailsSheet` (native): a quiet row's details, opened from its `⋯`
 * Food details (build spec §7.5.1). The React Native leaf of `./FoodDetailsSheet.tsx`.
 *
 * Presentational: it frames the row's panel body over the field group's Food details view.
 *
 * @pattern Decorator — the sheet frame around the row's one panel body
 */
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import type { FoodDetailsSheetProps } from './FoodDetailsSheet.js';

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
        {children}
    </Sheet>
);
