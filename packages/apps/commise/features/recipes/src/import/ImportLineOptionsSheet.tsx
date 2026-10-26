'use client';

/**
 * @module @commise/features-recipes/import — `ImportLineOptionsSheet` (web): a flagged line's options in a sheet, which
 * Search opens below the wide container class (board FlaggedLine). The board draws no phone sheet; its notes make it
 * the 1194 pane's list (the shared `FoodChoiceList`), search first, titled with the line and its recipe.
 *
 * Presentational and controlled. The native leaf is `./ImportLineOptionsSheet.native.tsx`.
 */
import { useMessages } from '@commise/i18n/react';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { lineTextOf } from '../ingredientMatching/matchLine.js';
import { useChoiceListView } from '../ingredientMatching/useChoiceListView.js';
import { FoodChoiceList } from '../ingredientMatching/FoodChoiceList.js';
import { importMessages } from './messages.js';
import type { ImportLineOptionsSheetProps } from './props.js';

/** A flagged line's options, in a sheet. */
export const ImportLineOptionsSheet: FC<ImportLineOptionsSheetProps> = ({
    open,
    onOpenChange,
    title,
    line,
    online,
    pending,
    ...list
}) => {
    const view = useChoiceListView(line, { online, pending });
    const { flagged: f } = useMessages(importMessages);

    return (
        <Sheet
            open={open}
            onOpenChange={onOpenChange}
            title={title}
            closeLabel={fillTemplate(f.sheetClose, { line: lineTextOf(line.line) })}
            size="content"
        >
            <div className="flex flex-col gap-3">
                <FoodChoiceList view={view} {...list} />
            </div>
        </Sheet>
    );
};
