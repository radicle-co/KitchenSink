'use client';

/**
 * @module @commise/ui/loading-notice — the web `LoadingNotice`: a status region for a load that has no shape to
 * reserve, in the page's flow where `StateNotice` sits, so a load that fails swaps in place.
 *
 * The region is `role="status"` and its CONTENT is the caption. `status` does not take its name from content, so the
 * caption names it by reference (`aria-labelledby`, which is the caption itself rather than a second copy of it as an
 * `aria-label` would be); there is no `aria-busy` (the notice replaces its region, so no node stays to be busy). The spinner is
 * decorative. It enters after 400 ms through `EnterTransition` (§18's Doherty hold), whose keyframe is `both`-filled,
 * so the notice stays hidden during the hold and under reduced motion it shows at once.
 * ⚠️ The visible caption and name are guaranteed; a spoken announcement is not, since a status region inserted with its
 * text already inside is not reliably spoken. Loading is not a must-hear message.
 *
 * `'use client'`: `EnterTransition` and the feature leaves that render this are reachable from App Router
 * server pages (caught by `next build`, not by typecheck).
 *
 * Presentational: props → JSX.
 *
 * @pattern Decorator — `EnterTransition`'s 400 ms hold over a status region, so a fast load never flashes a spinner
 */
import { useId, type FC } from 'react';

import { EnterTransition } from '../motion/EnterTransition.js';
import { Spinner } from '../spinner/Spinner.js';
import type { LoadingNoticeProps } from './props.js';

/** The hold before the notice shows, so a load that ends inside the Doherty budget never flashes a spinner. */
const LOADING_NOTICE_DELAY_MS = 400;

/** The web loading notice. */
export const LoadingNotice: FC<LoadingNoticeProps> = ({ label }) => {
    const captionId = useId();

    return (
        <EnterTransition delayMs={LOADING_NOTICE_DELAY_MS}>
            <div
                role="status"
                aria-labelledby={captionId}
                className="flex max-w-reading flex-wrap items-center gap-3 py-8"
            >
                <Spinner className="motion-safe:animate-spin text-action" />
                <span id={captionId} className="text-body-sm text-ink-muted">
                    {label}
                </span>
            </div>
        </EnterTransition>
    );
};
