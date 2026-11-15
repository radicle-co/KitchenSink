'use client';

/**
 * @module CookingDone — the web Done body.
 *
 * The title is the page's h1 in the largeTitle role, focusable by the host (`tabIndex={-1}`, `COOKING_DONE_TITLE_ID`) so
 * focus can move to it when Done opens; the host moves it, because a focus move is behaviour. The screen-off line shows
 * only where the screen was kept on. Done's two actions are not here: they are pinned in the foot by
 * `CookingDoneActions`, where Back and Next sit on a step.
 *
 * Presentational: props → JSX.
 */
import { LARGE_TITLE_CLASS } from '@commise/ui/large-title-header';
import type { FC } from 'react';

import type { CookingDoneProps } from './cookingViewProps.js';

/** The id of Done's h1, so the orchestration layer can move focus to it. */
export const COOKING_DONE_TITLE_ID = 'cooking-done-title';

/** The web Done body. */
export const CookingDone: FC<CookingDoneProps> = ({ title, enjoy, screenOff }) => (
    <section
        aria-labelledby={COOKING_DONE_TITLE_ID}
        className="flex flex-col items-center gap-4 px-4 py-12 text-center"
    >
        <h1 id={COOKING_DONE_TITLE_ID} tabIndex={-1} className={`${LARGE_TITLE_CLASS} focus:outline-none`}>
            {title}
        </h1>
        <p className="text-body text-ink">{enjoy}</p>
        {screenOff === undefined ? null : <p className="text-meta text-ink-muted">{screenOff}</p>}
    </section>
);
