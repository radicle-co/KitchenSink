'use client';

/**
 * @module @commise/features-recipes/ingredientMatching — `MatchOpenRow` (web): the one expanded line on phone and 834,
 * in either flow (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). The line (16 px), its muted
 * prompt in the 14 px `list` role ("Choose the milk you use"; none on a line reopened by Change), a choice that did not
 * save with Try again, then its `FoodChoiceList`: Search for a food first, then the options and Keep as written in their
 * box. Which line is open, and opening the next after a pick, are the host's.
 *
 * The line is not a card of its own (U2): a rule sits above it, as above every line (U3), and the options' box carries
 * the only border.
 *
 * Presentational: props in, markup out. The native leaf is `./MatchOpenRow.native.tsx`.
 */
import type { FC } from 'react';

import { FoodChoiceList } from './FoodChoiceList.js';
import { MatchFailureLine } from './MatchFailureLine.js';
import { MatchLineText } from './MatchLineText.js';
import type { MatchOpenRowProps } from './matchOpenRowProps.js';

/** The expanded line. */
export const MatchOpenRow: FC<MatchOpenRowProps> = ({ line, view, onRetryPick, retry, ...list }) => (
    <li className="flex flex-col gap-2 border-t border-line-divider py-3">
        <div className="flex flex-col gap-1">
            <MatchLineText line={line} />
            {view.prompt === undefined ? null : <p className="break-words text-list text-ink-muted">{view.prompt}</p>}
            {view.failure === undefined ? null : (
                <MatchFailureLine failure={view.failure} onRetry={onRetryPick} focus={retry.tryAgain} />
            )}
        </div>
        <FoodChoiceList view={view.list} landing={retry.landing} {...list} />
    </li>
);
