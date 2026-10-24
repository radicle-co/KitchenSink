'use client';

/**
 * @module @commise/ui/large-title-header — the web design-system {@link CondensedTitleBar} (see `props.ts`): the 56 px
 * PINNED bar a pushed web screen shows below `nav`. Its back control and menu are always rendered, focusable and
 * clickable; the material (`ChromeSurface`) shows once the page has scrolled, and the one-line title, repeated for sight
 * only, once the H1 is under the bar. Where the viewport covers the notch (`viewport-fit=cover`) it pads its top by
 * `env(safe-area-inset-top)`. Its height is the one `--pinned-bar-block` property (`tokens/themeCss.ts`: `--pinned-bar-height`, the same number
 * as `PINNED_BAR_HEIGHT`, plus the inset); from `medium` its back control names the parent too, as native's does.
 *
 * The chevron sits on the page's content gutter: the bar pads its start by `<main>`'s own padding (16 px, 24 px from
 * `medium`) and the control starts its glyph at its own edge, so the control's box and the chevron both line up with the
 * H1 below (`pinnedBackBar.md` §6; native does the same through `barStartPadding`). A centred glyph would sit 10 px in.
 *
 * The band itself takes no clicks (`pointer-events-none`) and each control opts back in, so an empty stretch of the bar
 * never blocks the page behind it. Nothing is `inert`, `aria-hidden` or `opacity-0` as a whole: only the material and the
 * title fade, and not under `prefers-reduced-motion`.
 *
 * Presentational: props → JSX; `surfaceShown` and `titleShown` are display derivation.
 *
 * @pattern Composite — the back control, the title and the menu over one floating-layer material
 */
import type { FC } from 'react';

import { ChromeSurface } from '../chromeSurface/ChromeSurface.js';
import { Icon } from '../icon/Icon.js';
import { RouteAction } from '../routeLink/RouteAction.js';
import type { CondensedTitleBarWebProps } from './props.js';

/** The web design-system condensed title bar. */
export const CondensedTitleBar: FC<CondensedTitleBarWebProps> = ({
    title,
    back,
    menu,
    surfaceShown,
    titleShown,
    barRef,
}) => (
    <div
        ref={barRef}
        data-condensed={titleShown ? 'true' : 'false'}
        className="pointer-events-none fixed inset-x-0 top-0 z-40 isolate flex h-[var(--pinned-bar-block)] items-center gap-2 pl-4 pr-2 pt-[env(safe-area-inset-top)] medium:pl-6 nav:hidden"
    >
        <ChromeSurface edge="bottom" visible={surfaceShown} />
        {back === undefined ? null : (
            <RouteAction
                label={back.label}
                onPress={back.onPress}
                {...(back.href === undefined ? {} : { href: back.href })}
                className="pointer-events-auto inline-flex min-h-11 min-w-11 max-w-[40%] items-center justify-start gap-1 rounded-md text-label text-action-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
                <Icon name="chevronLeft" size={24} />
                {/* From tablet width (`medium`, 600) the control names its parent, as native does ("‹ Collections"); the
                    control's own label names it in full, so this is for sight only. */}
                <span aria-hidden="true" className="hidden min-w-0 truncate medium:inline">
                    {back.parent}
                </span>
            </RouteAction>
        )}
        {title === undefined ? (
            <div className="min-w-0 flex-1" />
        ) : (
            <p
                aria-hidden="true"
                className={`min-w-0 flex-1 truncate text-bar-title text-ink transition-opacity motion-reduce:transition-none ${
                    titleShown ? 'opacity-100' : 'opacity-0'
                }`}
            >
                {title}
            </p>
        )}
        {menu === undefined ? null : <div className="pointer-events-auto flex">{menu}</div>}
    </div>
);
