'use client';

/**
 * @module @commise/features-recipes/ingredientMatching — `MatchOpenRow` (web): the one expanded line on phone and 834,
 * in either flow (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). The line, its muted prompt
 * ("Choose the milk you use"; none on a matched line opened by Change), then its `FoodChoiceList`: Search for a food
 * first, the options, Keep as written last. Which line is open, and opening the next after a pick, are the host's.
 *
 * The row is set apart by an edge, not a fill: its options use `surfaceMuted` for hover, which a fill of the same colour
 * would hide.
 *
 * Presentational: props in, markup out. The native leaf is `./MatchOpenRow.native.tsx`.
 */
import type { FC } from 'react';

import { FoodChoiceList } from './FoodChoiceList.js';
import { MatchLineText } from './MatchLineText.js';
import type { MatchOpenRowProps } from './matchOpenRowProps.js';

/** The expanded line. */
export const MatchOpenRow: FC<MatchOpenRowProps> = ({ line, view, ...list }) => (
    <li className="flex flex-col gap-2 rounded-xl border border-line-divider px-3 py-3">
        <div className="flex flex-col gap-1">
            <MatchLineText line={line} />
            {view.prompt === undefined ? null : <p className="break-words text-meta text-ink-muted">{view.prompt}</p>}
        </div>
        <FoodChoiceList view={view.list} {...list} />
    </li>
);
