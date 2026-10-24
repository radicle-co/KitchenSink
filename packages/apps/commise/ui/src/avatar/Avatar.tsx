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

/** The 44 × 44 target, its focus ring, and the 32 px disc inside it (§3.3). */
const TARGET_CLASS =
    'inline-flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

/** The web design-system avatar. */
export const Avatar: FC<AvatarProps> = ({ status, initials, label, onPress, href }) => {
    const disc = <AvatarDisc status={status} initials={initials} />;

    return (
        <RouteAction label={label} onPress={onPress} {...(href === undefined ? {} : { href })} className={TARGET_CLASS}>
            {disc}
        </RouteAction>
    );
};
