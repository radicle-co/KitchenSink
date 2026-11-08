'use client';

/**
 * @module @commise/ui/avatar — the web design-system {@link Avatar}: the profile entry (`buildSpec.md` §3.3, §3.8).
 *
 * A real link to Profile when it has an `href` (a plain click goes to `onPress`, so the app's router moves); a button
 * without one — `RouteAction` owns that rule.
 *
 * Presentational: props → JSX.
 *
 * @pattern Visitor — an exhaustive switch over the disc's three faces
 */
import type { FC } from 'react';

import { RouteAction } from '../routeLink/RouteAction.js';
import { AvatarDisc } from './AvatarDisc.js';
import type { AvatarProps } from './props.js';
import { FOCUS_RING_CLASS } from '../focusRing/focusRingClass.js';

/** The 44 × 44 target, its focus ring, and the disc inside it (§3.3), at either size. */
const TARGET_CLASS = `inline-flex size-11 shrink-0 items-center justify-center rounded-full ${FOCUS_RING_CLASS.offset}`;

/** The web design-system avatar. */
export const Avatar: FC<AvatarProps> = ({ status, initials, label, onPress, href, size }) => {
    const disc = <AvatarDisc status={status} initials={initials} {...(size === undefined ? {} : { size })} />;

    return (
        <RouteAction label={label} onPress={onPress} {...(href === undefined ? {} : { href })} className={TARGET_CLASS}>
            {disc}
        </RouteAction>
    );
};
