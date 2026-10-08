/**
 * @module @commise/features-recipes/form — the native `ShortlistPanel`, rows 6 and 7's panel (SPECIFY.1 rows 6 and 7).
 *
 * Orchestration: `useShortlistPanel` searches, derives the view and makes the pick; this leaf hands the view to the
 * presentational native `CandidatesPanelBody`. The native sheet renders it only while shown.
 *
 * @pattern Presentation Model — `shortlistPanelOf`, through `useShortlistPanel`, derives the view the body draws
 */
import type { FC } from 'react';

import { CandidatesPanelBody } from './CandidatesPanelBody.native.js';
import type { ShortlistPanelProps } from './shortlistPanel.model.js';
import { useShortlistPanel } from './useShortlistPanel.js';

/** Rows 6 and 7's panel: the line's re-derived shortlist, one pick for this line. */
export const ShortlistPanel: FC<ShortlistPanelProps> = (props) => {
    const panel = useShortlistPanel(props);

    return (
        <CandidatesPanelBody
            view={panel.view}
            onPick={panel.onPick}
            onRetryRead={panel.onRetryRead}
            onNoneOfThese={panel.onNoneOfThese}
        />
    );
};
