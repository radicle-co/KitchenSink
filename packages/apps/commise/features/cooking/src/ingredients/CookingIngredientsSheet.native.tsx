/**
 * @module CookingIngredientsSheet — the cooking ingredients list in the house bottom `Sheet` (L1 and L1w). The sheet's
 * title row draws the title and the × close, named `copy.close`; there is no Done (designer's D73). Every close route
 * reaches `onClose`, because the host answers by changing `open`.
 *
 * Presentational: props → JSX.
 */
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import { CookingIngredientsList } from './CookingIngredientsList.native.js';
import type { CookingIngredientsSheetProps } from './cookingIngredientsFrameProps.js';

/** The native ingredients sheet. */
export const CookingIngredientsSheet: FC<CookingIngredientsSheetProps> = ({
    open,
    onClose,
    copy,
    view,
    ...commands
}) => (
    <Sheet
        open={open}
        onOpenChange={(next) => {
            if (!next) {
                onClose();
            }
        }}
        title={view.title}
        closeLabel={copy.close}
        size="full"
    >
        <CookingIngredientsList view={view} copy={copy} {...commands} />
    </Sheet>
);
