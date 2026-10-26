/**
 * @module @commise/features-recipes/form — `PasteMatchSummary` (web): the block above the pasted lines
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`): "Added 8 lines" (16 px), then ONE paragraph
 * in the 14 px `list` role, muted: the non-zero counts in the owner's order and words ("3 matched · 4 to choose · 1
 * being checked.") and the rule that matched lines can be changed and nothing else is chosen for the cook (U4). Words
 * on the page, not a fill card. Not live: the matched lines' list says what changes (`lineAnnouncement.ts`), and the
 * editor's paste announcement says when the lines arrive.
 *
 * Presentational: props in, markup out. The native leaf is `./PasteMatchSummary.native.tsx`.
 */
import type { FC } from 'react';

import type { PasteMatchSummaryProps } from './pasteMatchSummaryProps.js';

/** The summary above the pasted lines. */
export const PasteMatchSummary: FC<PasteMatchSummaryProps> = ({ view }) => (
    <div className="flex flex-col gap-1">
        <p className="text-body text-ink">{view.added}</p>
        <p className="break-words text-list text-ink-muted">{view.paragraph}</p>
    </div>
);
