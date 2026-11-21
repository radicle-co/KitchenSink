/**
 * @module @commise/features-recipes/detail — the owner's visibility slot on the web recipe page: why a private recipe
 * stays private (board P6), as three siblings. A moment is the assertive region, mounted empty and filled one render
 * later by the host. A standing line is plain muted text, never a live region. A separate polite hidden region,
 * mounted empty, carries the one announcement (KTD-6, designer DN-1).
 *
 * The page renders it once, for the owner only.
 *
 * @pattern Presentational component — pure props to JSX; the notice and the announcement are decided in the controller
 */
import { LiveRegion } from '@commise/ui/live-region';
import type { FC } from 'react';

import type { VisibilityNotice } from '../actions/visibilityNotice.js';

/** Props for `RecipeVisibilityNotice`. */
export interface RecipeVisibilityNoticeProps {
    readonly notice: VisibilityNotice | undefined;
    /** The reason, said once when it first appears; `undefined` says nothing. */
    readonly announcement: string | undefined;
}

/** The owner's visibility notice (web). */
export const RecipeVisibilityNotice: FC<RecipeVisibilityNoticeProps> = ({ notice, announcement }) => (
    <>
        <LiveRegion politeness="assertive" className="text-meta text-danger-text">
            {notice?.kind === 'moment' ? notice.text : ''}
        </LiveRegion>
        {notice?.kind === 'standing' ? <p className="text-meta text-ink-muted">{notice.text}</p> : null}
        <LiveRegion politeness="polite" visuallyHidden>
            {announcement ?? ''}
        </LiveRegion>
    </>
);
