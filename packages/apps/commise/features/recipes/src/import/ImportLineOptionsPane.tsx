'use client';

/**
 * @module @commise/features-recipes/import — `ImportLineOptionsPane` (web): a flagged line's options beside the list at
 * the wide container class (board FlaggedLine, 1194 and web). A region headed by the line and its recipe, a pick that did
 * not save with Try again (M6), then the same list the sheet shows (the shared `FoodChoiceList`), search first. It has no
 * live region: the flagged list beside it has the page's one.
 *
 * Presentational and controlled. The native leaf is `./ImportLineOptionsPane.native.tsx`.
 */
import { useId, type FC } from 'react';

import { FoodChoiceList } from '../ingredientMatching/FoodChoiceList.js';
import { MatchFailureLine } from '../ingredientMatching/MatchFailureLine.js';
import { useOpenLineView } from '../ingredientMatching/useOpenLineView.js';
import type { ImportLineOptionsPaneProps } from './props.js';

/** A flagged line's options, as a pane. */
export const ImportLineOptionsPane: FC<ImportLineOptionsPaneProps> = ({
    title,
    line,
    online,
    pending,
    failed,
    onRetryPick,
    ...list
}) => {
    const view = useOpenLineView(line, { online, pending, failed });
    const headingId = useId();

    return (
        <section
            aria-labelledby={headingId}
            className="flex flex-col gap-3 rounded-lg border border-line-divider bg-paper p-4"
        >
            <h2 id={headingId} className="break-words text-section-title text-ink">
                {title}
            </h2>
            {view.failure === undefined ? null : <MatchFailureLine failure={view.failure} onRetry={onRetryPick} />}
            <FoodChoiceList view={view.list} {...list} />
        </section>
    );
};
