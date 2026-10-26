'use client';

/**
 * @module @commise/features-recipes/ingredientMatching — `MatchClosedRow` (web): an open line drawn collapsed, in either flow
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`): on phone and 834 while another line is open,
 * and in the list beside the side pane at 1194 and on web. The whole row is one button that opens the line; it says the
 * line and what it needs ("Choose a food · 5 options") in muted words, never amber, because a choice is not a failure.
 * The line the pane shows is `aria-current`, drawn with the selected fill.
 *
 * Presentational: props in, markup out. The native leaf is `./MatchClosedRow.native.tsx`.
 */
import { Icon } from '@commise/ui/icon';
import type { FC } from 'react';

import { MatchLineText } from './MatchLineText.js';
import type { MatchClosedRowProps } from './matchClosedRowProps.js';

/** One collapsed open line. */
export const MatchClosedRow: FC<MatchClosedRowProps> = ({ line, need, current, onOpen }) => (
    <li>
        <button
            type="button"
            aria-current={current ? 'true' : undefined}
            className="flex min-h-12 w-full items-center gap-2 rounded-xl px-1 py-2 text-start hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring aria-[current=true]:bg-selected-fill"
            onClick={onOpen}
        >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
                <MatchLineText line={line} />
                <span className="break-words text-meta text-ink-muted">{need}</span>
            </span>
            <Icon name="chevronRight" size={20} tone="inkMuted" />
        </button>
    </li>
);
