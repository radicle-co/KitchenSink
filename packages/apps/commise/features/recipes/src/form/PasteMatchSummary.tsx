/**
 * @module @commise/features-recipes/form — `PasteMatchSummary` (web): the block above the pasted lines
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`): "Added 8 lines", the non-zero counts, and the
 * rule that matched lines can be changed and nothing else is chosen for the cook. Not live: the editor's paste
 * announcement says when the lines arrive (`usePasteAnnouncement`).
 *
 * Presentational: props in, markup out. The native leaf is `./PasteMatchSummary.native.tsx`.
 */
import type { FC } from 'react';

import type { PasteMatchSummaryProps } from './pasteMatchSummaryProps.js';

/** The summary above the pasted lines. */
export const PasteMatchSummary: FC<PasteMatchSummaryProps> = ({ view }) => (
    <div className="flex flex-col gap-1 rounded-xl bg-surface-muted px-3 py-3">
        <p className="text-body-md text-ink">{view.added}</p>
        {view.counts !== '' && <p className="break-words text-meta text-ink-muted">{view.counts}</p>}
        <p className="break-words text-meta text-ink-muted">{view.rule}</p>
    </div>
);
