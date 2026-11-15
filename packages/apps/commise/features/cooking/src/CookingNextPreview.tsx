/**
 * @module CookingNextPreview — the web Next preview: the next step, pinned in the foot above Back and Next while a
 * line of this step is unticked. Under a cooking-frame height of 43.75 rem its line
 * shows on one line, ending in an ellipsis; the clamp is visual only, so a screen reader still reads the whole line.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';

import type { CookingNextPreviewProps } from './cookingViewProps.js';
import { SHORT_SCREEN } from './cookingLayout.js';

/** The web Next preview. */
export const CookingNextPreview: FC<CookingNextPreviewProps> = ({ preview }) => (
    <div className="flex flex-col gap-1 px-4">
        <p className="text-label text-action-text">{preview.overline}</p>
        <p className={`break-words text-body text-ink ${SHORT_SCREEN.previewWebClassName}`}>{preview.line}</p>
    </div>
);
