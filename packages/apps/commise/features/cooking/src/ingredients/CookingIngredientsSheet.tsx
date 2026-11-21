'use client';

/**
 * @module CookingIngredientsSheet — the cooking ingredients list in the house bottom `Sheet` (L1 and L1w), for web and
 * native alike: the house `Sheet` and the list each resolve to their own platform leaf, so this one file serves both.
 * The sheet's title row draws the title and the × close, named `copy.close`; there is no Done (designer's D73). Every
 * close route reaches `onClose`, because the host answers by changing `open`.
 *
 * Presentational: props → JSX.
 *
 * @platform shared
 */
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import { CookingIngredientsList } from './CookingIngredientsList.js';
import type { CookingIngredientsSheetProps } from './cookingIngredientsFrameProps.js';

/** The ingredients sheet, on web and native. */
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
