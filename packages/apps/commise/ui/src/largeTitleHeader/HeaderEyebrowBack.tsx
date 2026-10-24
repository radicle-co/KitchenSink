'use client';

/**
 * @module @commise/ui/large-title-header — the web {@link HeaderEyebrowBack}: the "‹ {parent}" eyebrow Back, drawn from
 * `nav` (840) and `display: none` below it, where the pinned `CondensedTitleBar` owns Back
 * (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §6). Hidden with `display: none`, so it leaves the accessibility tree
 * too and the page has exactly one Back at every width.
 *
 * It is its own leaf so every web surface that needs the 840+ Back draws ONE element: the settled `LargeTitleHeader`, and
 * the states that have no header to carry it (collection loading and failed read, §5), which render it above their content.
 *
 * Presentational: props → JSX.
 *
 * @pattern Adapter over `RouteAction` — the "‹ {parent}" eyebrow, shown from 840
 */
import type { FC } from 'react';

import { Icon } from '../icon/Icon.js';
import { RouteAction } from '../routeLink/RouteAction.js';
import type { HeaderBack } from './props.js';

const CLASS_NAME =
    'col-start-1 row-start-1 hidden min-h-11 min-w-11 items-center gap-1 self-center justify-self-start rounded-md text-action-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring nav:inline-flex nav:basis-full nav:min-h-6 nav:text-label';

/** Props for {@link HeaderEyebrowBack}. */
export interface HeaderEyebrowBackProps {
    /** The way back. */
    readonly back: HeaderBack;
}

/** The web eyebrow Back. */
export const HeaderEyebrowBack: FC<HeaderEyebrowBackProps> = ({ back }) => (
    <RouteAction
        label={back.label}
        onPress={back.onPress}
        {...(back.href === undefined ? {} : { href: back.href })}
        className={CLASS_NAME}
    >
        <Icon name="chevronLeft" size={24} />
        <span className="hidden nav:inline">{back.parent}</span>
    </RouteAction>
);
