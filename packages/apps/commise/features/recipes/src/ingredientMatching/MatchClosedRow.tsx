'use client';

/**
 * @module @commise/features-recipes/ingredientMatching — `MatchClosedRow` (web): an open line drawn collapsed, in either
 * flow (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`): on phone and 834 while another line is
 * open, and in the list beside the side pane at 1194 and on web. The whole row is one button that opens the line; it
 * says the line (16 px) and what it needs ("Choose a food · 5 options") in muted 14 px words, never amber, because a
 * choice is not a failure — unless its choice did not save, which it says in attention with the warning glyph in place
 * of the need (Try again is where the choice was made, the side pane).
 *
 * - The line the pane shows is `aria-current`, drawn with the selected fill AND the 2 px selected-edge ring Combobox's
 *   active option takes (U10): the fill alone is 1.2:1 against the paper, under WCAG 1.4.11's 3:1; the ring is 3.9:1
 *   on the fill in the light theme and 5.1:1 in the dark.
 * - Focus is an OUTLINE inset inside that ring: as a second ring, the `aria-[current]` variant would win its colour and
 *   a focused current row would look unfocused (2.4.7).
 * - While the line's choice is being sent it refuses to open: focusable, the press cancelled (M1, 2.4.3).
 * - A rule sits above it, as above every line (U3).
 *
 * Presentational: props in, markup out. The native leaf is `./MatchClosedRow.native.tsx`.
 */
import { BUSY_CONTROL_CLASS, refusedPressProps } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { PRESS_FILL_CLASS } from '@commise/ui/surface-tone';
import type { FC } from 'react';

import { MatchLineText } from './MatchLineText.js';
import type { MatchClosedRowProps } from './matchClosedRowProps.js';

/** The row's button: the whole line, 48 px at least. */
const ROW_CLASS = `flex min-h-12 w-full items-center gap-2 rounded-xl px-1 py-3 text-start ${PRESS_FILL_CLASS.pointer} focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-focus-ring aria-[current=true]:bg-selected-fill aria-[current=true]:ring-2 aria-[current=true]:ring-inset aria-[current=true]:ring-selected-edge ${BUSY_CONTROL_CLASS}`;

/** One collapsed open line. */
export const MatchClosedRow: FC<MatchClosedRowProps> = ({ line, need, current, refusing, failure, onOpen }) => (
    <li className="border-t border-line-divider">
        <button
            type="button"
            aria-current={current ? 'true' : undefined}
            {...refusedPressProps({ unavailable: refusing, onClick: onOpen })}
            className={ROW_CLASS}
        >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
                <MatchLineText line={line} />
                {failure === undefined ? (
                    <span className="break-words text-list text-ink-muted">{need}</span>
                ) : (
                    <span className="flex min-w-0 items-center gap-2">
                        <Icon name="triangleAlert" size={16} tone="attention" />
                        <span className="min-w-0 break-words text-list text-attention">{failure}</span>
                    </span>
                )}
            </span>
            <Icon name="chevronRight" size={20} tone="inkMuted" />
        </button>
    </li>
);
