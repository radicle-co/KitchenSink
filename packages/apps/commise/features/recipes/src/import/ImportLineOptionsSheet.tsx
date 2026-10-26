'use client';

/**
 * @module @commise/features-recipes/import — `ImportLineOptionsSheet` (web): a flagged line's options in a sheet, which
 * Search opens below the wide container class (board FlaggedLine). The board draws no phone sheet; its notes make it
 * the 1194 pane's list (the shared `FoodChoiceList`), search first, titled with the line and its recipe.
 *
 * A pick that did not save says so above the list, with Try again, and the sheet speaks it from its OWN polite region:
 * it is modal, so the page's region behind it is hidden from assistive technology (M6, U9).
 *
 * Presentational and controlled. The native leaf is `./ImportLineOptionsSheet.native.tsx`.
 */
import { useMessages } from '@commise/i18n/react';
import { LiveRegion } from '@commise/ui/live-region';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { lineTextOf } from '../ingredientMatching/matchLine.js';
import { FoodChoiceList } from '../ingredientMatching/FoodChoiceList.js';
import { MatchFailureLine } from '../ingredientMatching/MatchFailureLine.js';
import { useOpenLineView } from '../ingredientMatching/useOpenLineView.js';
import { useRetryFocus } from '../ingredientMatching/useRetryFocus.js';
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
    failed,
    announcement,
    onRetryPick,
    ...list
}) => {
    const view = useOpenLineView(line, { online, pending, failed });
    const retry = useRetryFocus([view.send])(view.send.key);
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
                {view.failure === undefined ? null : (
                    <MatchFailureLine failure={view.failure} onRetry={onRetryPick} focus={retry.tryAgain} />
                )}
                <FoodChoiceList view={view.list} landing={retry.landing} {...list} />
                <LiveRegion politeness="polite" occurrence={announcement.occurrence} visuallyHidden>
                    {announcement.text}
                </LiveRegion>
            </div>
        </Sheet>
    );
};
