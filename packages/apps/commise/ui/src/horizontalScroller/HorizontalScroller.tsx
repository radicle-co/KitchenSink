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
 * - The fade is a 16 px `mask-image` ramp at the scroller's own inline-end edge. A mask erases its own children, so the
 *   chevron is a SIBLING of the scroller.
 * - The chevron has a COLUMN of its own: while the content overflows the wrapper is a two-column grid and the chevron
 *   fills the 24 px column beside the scroller, so it never sits on a chip (drawn over the scroller it hid the last
 *   characters of the chip at the edge: "Vegan 21" read "Vegan 2›" in a 255 px panel). The column is kept for as long
 *   as the content overflows, and only the chevron's opacity changes, so nothing reflows on the first scroll. Whether
 *   the content overflows is read against the WHOLE wrapper (the gutter does not move it), never against the scroller
 *   (the gutter does), or the column would switch itself on and off.
 * - A named scroller (`regionLabel`) is a focusable region whose arrow keys move it by one item. A child that takes
 *   focus is scrolled whole into view, clear of the fade (`scroll-pe-4`).
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
import { FOCUS_RING_CLASS } from '../focusRing/focusRingClass.js';

const NO_SNAP: ScrollerSnap = { kind: 'none' };

/** The mask for the fade: a 16 px ramp at the inline-end edge; left-to-right, then right-to-left. */
const MORE = 'linear-gradient(to_right,black_calc(100%-16px),transparent)';
const MORE_RTL = 'linear-gradient(to_left,black_calc(100%-16px),transparent)';

const SCROLLER =
    'overflow-x-auto scroll-pe-4 [scrollbar-width:thin] ' +
    '[@media(scripting:enabled)]:[scrollbar-color:transparent_transparent] ' +
    'data-[scrolling]:[scrollbar-color:var(--color-line-control)_transparent] ' +
    '[@media(hover:hover)_and_(pointer:fine)]:hover:[scrollbar-color:var(--color-line-control)_transparent] ' +
    `data-[hint=more]:[mask-image:${MORE}] rtl:data-[hint=more]:[mask-image:${MORE_RTL}]`;

/** A named scroller's focus ring is drawn inside it: the mask would erase an outer one. */
const REGION = FOCUS_RING_CLASS.inset;

const SNAP: Readonly<Record<ScrollerSnap['kind'], string>> = {
    none: '',
    item: 'snap-x snap-proximity',
    card: 'snap-x snap-mandatory scroll-ps-4',
};

/** The wrapper: a plain box, or — while the content overflows — the scroller and the chevron's column. */
const BOX = 'relative min-w-0';
const BOX_WITH_GUTTER = `${BOX} grid grid-cols-[minmax(0,1fr)_1.5rem]`;

/** The chevron's column. With nothing to scroll it takes no room (`hidden`), and its opacity is still 0. */
const CHEVRON =
    'pointer-events-none flex w-6 items-center justify-center ' +
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
        // `min-w-0`: as a flex or grid item the box may shrink below its `w-max` content, so the content scrolls inside
        // it instead of widening the row and the page.
        <div className={extent.overflows ? BOX_WITH_GUTTER : BOX}>
            <div
                ref={setScroller}
                {...(named ? { role: 'region', 'aria-label': regionLabel, tabIndex: 0, onKeyDown: stepOnArrow } : {})}
                data-hint={hint.fade ? 'more' : undefined}
                onFocus={bringIntoView}
                className={`${SCROLLER} ${SNAP[snap.kind]} ${named ? REGION : ''}`}
            >
                <div ref={setContent} className="w-max">
                    {children}
                </div>
            </div>
            <span
                aria-hidden="true"
                style={{ opacity: hint.chevron ? 1 : 0 }}
                className={extent.overflows ? CHEVRON : `${CHEVRON} hidden`}
            >
                <Icon name="chevronRight" size={20} tone="inkMuted" />
            </span>
        </div>
    );
};
