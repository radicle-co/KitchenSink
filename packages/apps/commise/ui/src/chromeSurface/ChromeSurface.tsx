/**
 * @module @commise/ui/chrome-surface — the web design-system {@link ChromeSurface}: the bar material under a 12 px
 * blur, solid where the reader asked for less transparency or more contrast (see `props.ts`).
 *
 * It paints BEHIND its parent's content (`-z-10`), so the parent must open a stacking context (`isolate`) and position
 * it (`relative`, `fixed` or `sticky`).
 *
 * Presentational: props → JSX.
 *
 * @pattern Adapter over CSS `backdrop-filter`, with a solid fallback the reader's settings select
 */
import type { FC } from 'react';

import type { ChromeSurfaceProps } from './props.js';

/** The material, and its two solid fallbacks. `paperRaised` is solid `paper` in light and the level-2 grey in dark. */
const MATERIAL_CLASS =
    'bg-bar backdrop-blur-[12px] [@media(prefers-reduced-transparency:reduce)]:bg-paper-raised [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none contrast-more:bg-paper-raised contrast-more:backdrop-blur-none';

/** The web design-system bar material. */
export const ChromeSurface: FC<ChromeSurfaceProps> = ({ edge, visible = true }) => {
    const hairline = edge === 'top' ? 'border-t' : 'border-b';

    return (
        <div
            aria-hidden="true"
            data-material={visible ? 'bar' : 'none'}
            className={`pointer-events-none absolute inset-0 -z-10 ${
                visible ? `${MATERIAL_CLASS} ${hairline} border-line-divider contrast-more:border-ink` : ''
            }`}
        />
    );
};
