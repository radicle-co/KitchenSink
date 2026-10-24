'use client';

/**
 * @module @commise/ui/pushed-page — the web design-system {@link PushedPageFrame} (see `props.ts`): below 840 the same
 * pinned bar as native, over the document's scroll; from 840 nothing changes, because the bar is `nav:hidden` and the
 * header's own eyebrow link is the Back there (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §6).
 *
 * ORCHESTRATION of the page's frame. It mounts its OWN nested `ScrollHost` with the page's `headingId` and the bar's
 * RENDERED height as `topInset`: the app shell's host has no `headingId`, so it never reports `condensed`, and the observer
 * must measure the H1 from under the bar, which on a notched phone is taller than `--pinned-bar-height` (the inset is added).
 * The bar is `fixed` at the top and comes before the page in the DOM, so the reading order and the screen agree. Where the
 * shell offers a slot (`PinnedBarSlotContext`) the bar is drawn into it, ahead of the shell's own notice.
 *
 * The frame adds NO padding of its own: `<main>` takes the bar's height as its top padding on a pushed page below 840
 * (`globals.css`, keyed on `data-pushed-page`), so what the shell draws above the page (the connectivity notice) sits under
 * the bar instead of behind it. `data-pushed-page` also lets the stylesheet keep focused controls clear of the bar with
 * `scroll-padding-top` (SC 2.4.11).
 *
 * @pattern Template — ScrollHost, pinned CondensedTitleBar, content inset
 */
import { useContext, useState, type FC } from 'react';
import { createPortal } from 'react-dom';

import { CondensedTitleBar } from '../largeTitleHeader/CondensedTitleBar.js';
import { PINNED_BAR_HEIGHT } from '../largeTitleHeader/barGeometry.js';
import { ScrollHost } from '../scrollHost/ScrollHost.js';
import { useScrollHost } from '../scrollHost/scrollHostContext.js';
import type { ScrollBind } from '../scrollHost/props.js';
import { barFactsOf } from './barFacts.js';
import { PinnedBarSlotContext } from './pinnedBarSlot.js';
import { useRenderedHeight } from './useRenderedHeight.js';
import type { PushedPageFrameProps, PushedPageInset } from './props.js';

/** Web: `<main>` owns the room under the bar. */
const INSET: PushedPageInset = { paddingTop: 0 };

/** The frame inside its host: the bar, then the page. */
const Frame: FC<
    Omit<PushedPageFrameProps, 'headingId'> & {
        readonly bind: ScrollBind;
        readonly barRef: (node: HTMLElement | null) => void;
    }
> = ({ back, title, menu, children, bind, barRef }) => {
    const { atTop, condensed } = useScrollHost();
    const { surfaceShown, titleShown } = barFactsOf({ atTop, condensed });
    const slot = useContext(PinnedBarSlotContext);
    const bar = (
        <CondensedTitleBar
            {...(title === undefined ? {} : { title })}
            back={back}
            {...(menu === undefined ? {} : { menu })}
            surfaceShown={surfaceShown}
            titleShown={titleShown}
            barRef={barRef}
        />
    );

    return (
        <div data-pushed-page="">
            {slot === null ? bar : createPortal(bar, slot)}
            {children(bind, INSET)}
        </div>
    );
};

/** The web design-system pushed-page frame. */
export const PushedPageFrame: FC<PushedPageFrameProps> = ({ headingId, back, title, menu, children }) => {
    const [bar, setBar] = useState<HTMLElement | null>(null);
    const barHeight = useRenderedHeight(bar, PINNED_BAR_HEIGHT);

    return (
        <ScrollHost headingId={headingId} topInset={barHeight}>
            {(bind) => (
                <Frame
                    back={back}
                    {...(title === undefined ? {} : { title })}
                    {...(menu === undefined ? {} : { menu })}
                    bind={bind}
                    barRef={setBar}
                >
                    {children}
                </Frame>
            )}
        </ScrollHost>
    );
};
