'use client';

/**
 * @module @commise/features-recipes/ingredientMatching — `MatchLineList` (web): a recipe's matched lines, in either flow
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`): one `MatchRow` per line, in the recipe's
 * order, each the row `lineRowOf` gives it — the host's expanded line open, every other open line collapsed and naming
 * its need, every settled line with its controls.
 *
 * Presentational and controlled: which line is open, the pick in flight and where focus goes are the host's. The
 * native leaf is `./MatchLineList.native.tsx`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import type { MatchLineListProps } from './matchLineListProps.js';
import { lineRowOf } from './matchLineView.js';
import { MatchRow } from './MatchRow.js';
import { matchLineMessages } from './messages.js';

/** A recipe's matched lines. */
export const MatchLineList: FC<MatchLineListProps> = ({
    lines,
    expandedKey,
    currentKey,
    online,
    pending,
    searchFocus,
    ...handlers
}) => {
    const copy = { line: useMessages(matchLineMessages), details: useMessages(recipeMessages).ingredientDetails };
    const locale = useLocale();

    return (
        <ul className="flex flex-col gap-1">
            {lines.map((line) => {
                const expanded = line.key === expandedKey;
                const row = lineRowOf(
                    line,
                    { expanded, current: line.key === currentKey, online, pending: expanded ? pending : undefined },
                    copy,
                    locale,
                );

                return <MatchRow key={line.key} row={row} searchFocus={searchFocus} {...handlers} />;
            })}
        </ul>
    );
};
