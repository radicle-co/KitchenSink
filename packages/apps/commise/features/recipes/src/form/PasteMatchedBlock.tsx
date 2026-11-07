'use client';

/**
 * @module @commise/features-recipes/form — `PasteMatchedBlock` (web): what stands in the Ingredients section for the
 * paste's MATCHED lines (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`): the notice when matching
 * cannot run, the summary ("Added 8 lines", the counts), and the lines themselves through `MatchLineList` — with the side
 * pane beside them at the wide container class (1194 and web). The draft lines it draws are the ones the section leaves
 * out of its ordinary rows, so no line is drawn twice.
 *
 * Presentational, but it holds a ref: when the last open line is chosen the summary takes focus, so the cook who just
 * chose does not lose their place to the page (SC 2.4.3). The native leaf is `./PasteMatchedBlock.native.tsx`.
 *
 * @pattern Adapter over `useFocusOnSignal` — the DOM focus move the host's signal asks for
 */
import { useFocusOnSignal } from '@commise/ui/dialog-focus';
import type { FC } from 'react';

import { MatchLineList } from '../ingredientMatching/MatchLineList.js';
import { PasteChoicePane } from './PasteChoicePane.js';
import { PasteMatchNotice } from './PasteMatchNotice.js';
import { PasteMatchSummary } from './PasteMatchSummary.js';
import type { PasteMatchedBlockProps } from './pasteMatchedBlockProps.js';

/** The paste's matched lines, with their summary and notice. */
export const PasteMatchedBlock: FC<PasteMatchedBlockProps> = ({ matching, wide }) => {
    const summary = useFocusOnSignal<HTMLDivElement>(matching.summaryFocusSignal);
    const layout = matching.layoutFor(wide);

    return (
        <div className="flex flex-col gap-3">
            {matching.notice === undefined ? null : <PasteMatchNotice notice={matching.notice} />}
            {matching.summary === undefined ? null : (
                <div ref={summary} tabIndex={-1} className="outline-none">
                    <PasteMatchSummary view={matching.summary} />
                </div>
            )}
            {layout === undefined ? null : (
                <div className="flex flex-col gap-4 @wide/main:flex-row @wide/main:items-start">
                    <div className="min-w-0 flex-1">
                        <MatchLineList {...layout.list} />
                    </div>
                    {layout.pane === undefined ? null : (
                        <div className="w-96 shrink-0">
                            <PasteChoicePane {...layout.pane} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
