'use client';

/**
 * @module @commise/ui/large-title-header — the web design-system {@link LargeTitleHeader} (see `props.ts`).
 *
 * Below `nav` (840) a grid: the 44 px row holds the back control and the action, the title spans the row under it.
 * From `nav` a wrapping flex row: the back control becomes an eyebrow on its own line, the title takes `flex: 1 1 18rem`
 * and the action `flex: none`, so without room the action drops below the title as one group.
 *
 * DOM order is back → H1 → subtitle → action → `afterTitle` → segments: a screen reader meets the title first, then the
 * avatar, then the floating button (§4.2 focus order), wherever each is drawn.
 *
 * The H1's focus ref is `useFocusOnSignal`'s, sanctioned in the ref register: `.focus()` has no declarative form.
 *
 * Presentational: props → JSX.
 *
 * @pattern Visitor — an exhaustive switch over the `HeaderAction` union
 */
import type { FC, ReactNode } from 'react';

import { useFocusOnSignal } from '../dialogFocus/useFocusOnSignal.js';
import { Icon } from '../icon/Icon.js';
import { RouteAction } from '../routeLink/RouteAction.js';
import { LARGE_SUBTITLE_CLASS, LARGE_TITLE_CLASS } from './largeTitleClass.js';
import type { HeaderAction, HeaderBack, LargeTitleHeaderProps } from './props.js';

/** The back control: a 44 px ‹ below `nav`, the "‹ {parent}" eyebrow from it. */
const BackLink: FC<{ readonly back: HeaderBack }> = ({ back }) => {
    const className =
        'col-start-1 row-start-1 inline-flex min-h-11 min-w-11 items-center gap-1 self-center justify-self-start rounded-md text-action-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring nav:basis-full nav:min-h-6 nav:text-label';
    const content = (
        <>
            <Icon name="chevronLeft" size={24} />
            <span className="hidden nav:inline">{back.parent}</span>
        </>
    );

    return (
        <RouteAction
            label={back.label}
            onPress={back.onPress}
            {...(back.href === undefined ? {} : { href: back.href })}
            className={className}
        >
            {content}
        </RouteAction>
    );
};

/** The action group at the end of the title row. */
function actionOf(action: HeaderAction): ReactNode {
    switch (action.kind) {
        case 'avatar':
            // The sidebar's profile row is the avatar from `nav`, so the header drops it there.
            return <div className="col-start-3 row-start-1 justify-self-end nav:hidden">{action.avatar}</div>;
        case 'controls':
            return (
                <div className="col-start-3 row-start-1 flex items-center gap-2 justify-self-end nav:flex-none nav:self-start">
                    {action.button}
                    {action.menu}
                </div>
            );
    }
}

/** The web design-system large title header. */
export const LargeTitleHeader: FC<LargeTitleHeaderProps> = ({
    headingId,
    title,
    subtitle,
    back,
    action,
    afterTitle,
    segments,
    focusSignal = 0,
}) => {
    const heading = useFocusOnSignal<HTMLHeadingElement>(focusSignal);
    const hasRow = back !== undefined || action !== undefined;

    return (
        <header
            className={`grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 nav:flex nav:flex-wrap nav:items-baseline nav:gap-x-4 nav:gap-y-1 ${
                hasRow ? 'grid-rows-[2.75rem_auto]' : ''
            }`}
        >
            {back === undefined ? null : <BackLink back={back} />}
            <div className={`col-span-3 min-w-0 nav:flex-[1_1_18rem] ${hasRow ? 'row-start-2' : 'row-start-1'}`}>
                <h1 id={headingId} ref={heading} tabIndex={-1} className={`${LARGE_TITLE_CLASS} focus:outline-none`}>
                    {title}
                </h1>
                {subtitle === undefined ? null : <p className={LARGE_SUBTITLE_CLASS}>{subtitle}</p>}
            </div>
            {action === undefined ? null : actionOf(action)}
            {afterTitle}
            {segments === undefined ? null : <div className="col-span-3 mt-3 nav:basis-full">{segments}</div>}
        </header>
    );
};
