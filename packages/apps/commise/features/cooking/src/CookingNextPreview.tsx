/**
 * @module CookingNextPreview — the web Next preview: the next step, pinned in the foot above Back and Next while a
 * line of this step is unticked. Under a cooking-frame height of 43.75 rem its line
 * shows on one line, ending in an ellipsis; the clamp is visual only, so a screen reader still reads the whole line.
 * Under 40 rem it leaves the foot for the end of the scrolling step: the same text is drawn there, whole, and the
 * frame's height shows one copy.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';

import type { CookingNextPreviewProps } from './cookingViewProps.js';
import { PREVIEW_IN_BODY, SHORT_SCREEN } from './cookingLayout.js';

/** Props for the web Next preview. */
export interface CookingNextPreviewWebProps extends CookingNextPreviewProps {
    /** Which of the two copies this is: the foot's, or the scrolling step's. The frame's height shows one of them. */
    readonly place: 'foot' | 'body';
}

/** The web Next preview. */
export const CookingNextPreview: FC<CookingNextPreviewWebProps> = ({ preview, place }) => (
    <div
        className={`flex-col gap-1 px-4 ${place === 'foot' ? `flex ${PREVIEW_IN_BODY.footWebClassName}` : PREVIEW_IN_BODY.bodyWebClassName}`}
    >
        <p className="text-label text-action-text">{preview.overline}</p>
        <p className={`break-words text-body text-ink ${place === 'foot' ? SHORT_SCREEN.previewWebClassName : ''}`}>
            {preview.line}
        </p>
    </div>
);
