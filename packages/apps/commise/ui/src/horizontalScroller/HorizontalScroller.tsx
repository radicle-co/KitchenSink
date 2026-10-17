'use client';

/**
 * @module @commise/ui/horizontal-scroller — the web design-system {@link HorizontalScroller}
 * (`docs/design/uiOverhaul/horizontalScrollHint.md`).
 *
 * The one horizontal scroller of the app. Its scrollbar stays hidden until the reader scrolls (and, with a fine
 * pointer, while the pointer is over it); a decorative chevron shows at the inline-end edge only while the content
 * overflows and the scroller rests at its start; a fade over the end shows while more lies ahead.
 *
 * - The scrollbar is always `thin`, so it never moves the layout; once scripts run it is transparent at rest, and it is
 *   coloured while `data-scrolling` is set by the hook. With no script it keeps the browser's own colour.
 * - The fade is a `mask-image` on the scroller. A mask erases its own children, so the chevron is a SIBLING of the
 *   scroller in a `relative` wrapper. While the chevron shows the mask widens from 24 px to a 40 px band whose last
 *   24 px are fully transparent, which is where the glyph sits.
 * - A named scroller (`regionLabel`) is a focusable region whose arrow keys move it by one item. A child that takes
 *   focus is scrolled whole into view, clear of the band (`scroll-pe-10`).
 *
 * Presentational: props → JSX; the position is read by {@link useScrollHint}.
 *
 * @pattern Decorator — adds the scroll hint to a scroller that knows nothing of it
 * @pattern Observer — reports where it rests to the owner through `onPosition`
 */
import type { FC, FocusEvent, KeyboardEvent } from 'react';

import { Icon } from '../icon/Icon.js';
import type { HorizontalScrollerProps, ScrollerSnap } from './props.js';
import { scrollBehaviorOf } from './scrollBehavior.js';
import { itemStepOf, scrollHintOf } from './scrollHint.js';
import { useScrollHint } from './useScrollHint.js';

const NO_SNAP: ScrollerSnap = { kind: 'none' };

/** The mask for a fade alone, and for the wider band the chevron sits in; left-to-right, then right-to-left. */
const MORE = 'linear-gradient(to_right,black_calc(100%-24px),transparent)';
const MORE_RTL = 'linear-gradient(to_left,black_calc(100%-24px),transparent)';
const START = 'linear-gradient(to_right,black_calc(100%-40px),transparent_calc(100%-24px))';
const START_RTL = 'linear-gradient(to_left,black_calc(100%-40px),transparent_calc(100%-24px))';

const SCROLLER =
    'overflow-x-auto scroll-pe-10 [scrollbar-width:thin] ' +
    '[@media(scripting:enabled)]:[scrollbar-color:transparent_transparent] ' +
    'data-[scrolling]:[scrollbar-color:var(--color-line-control)_transparent] ' +
    '[@media(hover:hover)_and_(pointer:fine)]:hover:[scrollbar-color:var(--color-line-control)_transparent] ' +
    `data-[hint=more]:[mask-image:${MORE}] rtl:data-[hint=more]:[mask-image:${MORE_RTL}] ` +
    `data-[hint=start]:[mask-image:${START}] rtl:data-[hint=start]:[mask-image:${START_RTL}]`;

/** A named scroller's focus ring is drawn inside it: the mask would erase an outer one. */
const REGION = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring';

const SNAP: Readonly<Record<ScrollerSnap['kind'], string>> = {
    none: '',
    item: 'snap-x snap-proximity',
    card: 'snap-x snap-mandatory scroll-ps-4',
};

const CHEVRON =
    'pointer-events-none absolute inset-y-0 end-0 flex w-6 items-center justify-center ' +
    'motion-safe:transition-opacity motion-safe:duration-150 motion-safe:ease-out';

/**
 * Move a focused region by one item on a left or right arrow. In a right-to-left page the arrows keep their physical
 * direction, as every scroller does.
 *
 * @param event - The key press.
 * @sideEffect Scrolls the region.
 */
function stepOnArrow(event: KeyboardEvent<HTMLElement>): void {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;

    if (direction === 0 || event.target !== event.currentTarget) {
        return;
    }

    event.preventDefault();
    const [first, second] = event.currentTarget.querySelectorAll('li');
    const firstBox = first?.getBoundingClientRect();
    const pitch =
        firstBox === undefined || second === undefined
            ? 0
            : Math.abs(second.getBoundingClientRect().left - firstBox.left);

    event.currentTarget.scrollBy({
        left: direction * itemStepOf(firstBox?.width ?? 0, pitch, event.currentTarget.clientWidth),
        behavior: scrollBehaviorOf(),
    });
}

/**
 * Bring a child that took focus whole into view; the scroller's own focus scrolls nothing.
 *
 * @param event - The focus event, which bubbles from the child.
 * @sideEffect Scrolls the scroller.
 */
function bringIntoView(event: FocusEvent<HTMLElement>): void {
    if (event.target !== event.currentTarget) {
        event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
}

/** The web horizontal scroller. */
export const HorizontalScroller: FC<HorizontalScrollerProps> = ({
    children,
    snap = NO_SNAP,
    regionLabel,
    onScroller,
    onPosition,
}) => {
    const { setScroller, setContent, extent } = useScrollHint(onScroller, onPosition);
    const hint = scrollHintOf(extent);
    const named = regionLabel !== undefined;

    return (
        <div className="relative">
            <div
                ref={setScroller}
                {...(named ? { role: 'region', 'aria-label': regionLabel, tabIndex: 0, onKeyDown: stepOnArrow } : {})}
                data-hint={hint.chevron ? 'start' : hint.fade ? 'more' : undefined}
                onFocus={bringIntoView}
                className={`${SCROLLER} ${SNAP[snap.kind]} ${named ? REGION : ''}`}
            >
                <div ref={setContent} className="w-max">
                    {children}
                </div>
            </div>
            <span aria-hidden="true" style={{ opacity: hint.chevron ? 1 : 0 }} className={CHEVRON}>
                <Icon name="chevronRight" size={20} tone="inkMuted" />
            </span>
        </div>
    );
};
