'use client';

/**
 * @module routeLink/RouteAction — a web control that goes somewhere: a real link when it has an `href`, so a new tab
 * works, whose plain click goes to `onPress` with the link's own navigation cancelled, so the app's router moves; a
 * button when it has none. The design system's avatar and back controls use it. Internal to `@commise/ui`.
 *
 * Presentational: props → JSX.
 *
 * @pattern Strategy — a link or a button, chosen by whether the control has somewhere to go
 */
import type { FC, ReactNode } from 'react';

import { isModifiedClick } from './isModifiedClick.js';

/** Props for {@link RouteAction}. */
export interface RouteActionProps {
    /** The accessible name. */
    readonly label: string;
    /** Go. */
    readonly onPress: () => void;
    /** Where it goes, on web. Without one the control is a button. */
    readonly href?: string;
    readonly className: string;
    readonly children: ReactNode;
}

/** A link-or-button that goes somewhere. */
export const RouteAction: FC<RouteActionProps> = ({ label, onPress, href, className, children }) => {
    if (href === undefined) {
        return (
            <button type="button" aria-label={label} onClick={onPress} className={className}>
                {children}
            </button>
        );
    }

    return (
        <a
            href={href}
            aria-label={label}
            onClick={(event) => {
                if (isModifiedClick(event)) {
                    return;
                }

                event.preventDefault();
                onPress();
            }}
            className={className}
        >
            {children}
        </a>
    );
};
