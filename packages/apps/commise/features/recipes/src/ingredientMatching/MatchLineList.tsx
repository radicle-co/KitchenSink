'use client';

/**
 * @module @commise/features-recipes/ingredientMatching — `MatchLineList` (web): a recipe's matched lines, in either flow
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`): one `MatchRow` per line, in the recipe's
 * order, each the row `lineRowOf` gives it — the host's expanded line open, every other open line collapsed and naming
 * its need, every settled line with its controls. Each line carries its own send in flight and its own failure, so
 * several lines can be sending at once. A rule sits above each line (each row draws it, U3), never a bare gap.
 *
 * ONE polite live region per list (U9, WCAG 4.1.3), after the lines, says what the host announces: a checking line
 * resolving, a late review note, a failed choice and the count that changed (`lineChangesOf`). No row has a region of
 * its own, so a change is spoken once.
 *
 * Presentational and controlled: which line is open, what is in flight, what is said and where focus goes are the
 * host's. The native leaf is `./MatchLineList.native.tsx`.
 */
import { useLocale } from '@commise/i18n/react';
import { LiveRegion } from '@commise/ui/live-region';
import type { FC } from 'react';

import type { MatchLineListProps } from './matchLineListProps.js';
import { lineRowOf, sendsOf } from './matchLineView.js';
import { MatchRow } from './MatchRow.js';
import { useMatchCopy } from './useMatchCopy.js';
import { useRetryFocus } from './useRetryFocus.js';

/** A recipe's matched lines. */
export const MatchLineList: FC<MatchLineListProps> = ({
    lines,
    expandedKey,
    currentKey,
    online,
    pending,
    failed,
    announcement,
    focus,
    ...handlers
}) => {
    const copy = useMatchCopy();
    const locale = useLocale();
    const rows = lines.map((line) =>
        lineRowOf(
            line,
            {
                expanded: line.key === expandedKey,
                current: line.key === currentKey,
                online,
                pending: pending.get(line.key),
                failed: failed.has(line.key),
            },
            copy,
            locale,
        ),
    );
    const retryOf = useRetryFocus(sendsOf(rows));

    return (
        <div className="flex flex-col">
            <ul className="flex flex-col">
                {rows.map((row) => (
                    <MatchRow key={row.key} row={row} focus={focus} retry={retryOf(row.key)} {...handlers} />
                ))}
            </ul>
            <LiveRegion politeness="polite" occurrence={announcement.occurrence} visuallyHidden>
                {announcement.text}
            </LiveRegion>
        </div>
    );
};
