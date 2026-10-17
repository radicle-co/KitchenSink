'use client';

/**
 * @module @commise/ui/large-title-header — the web design-system {@link CondensedTitleBar} (see `props.ts`): the 56 px
 * bar a PUSHED web screen shows below `nav` once its H1 scrolls under the top. It sits on the floating layer
 * (`ChromeSurface`), keeps the back control one tap away, and repeats the title for sight only.
 *
 * Presentational: props → JSX; `visible` is display derivation.
 *
 * @pattern Composite — the back control, the title and the menu over one floating-layer material
 */
import type { FC } from 'react';

import { ChromeSurface } from '../chromeSurface/ChromeSurface.js';
import { Icon } from '../icon/Icon.js';
import { RouteAction } from '../routeLink/RouteAction.js';
import type { CondensedTitleBarProps } from './props.js';

/** The web design-system condensed title bar. */
export const CondensedTitleBar: FC<CondensedTitleBarProps> = ({ title, back, menu, visible }) => (
    <div
        data-condensed={visible ? 'true' : 'false'}
        // Hidden bars take no clicks and no focus; the large header's own controls are on screen then.
        inert={!visible}
        className={`fixed inset-x-0 top-0 z-40 isolate flex h-14 items-center gap-2 px-2 transition-opacity motion-reduce:transition-none nav:hidden ${
            visible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
    >
        <ChromeSurface edge="bottom" visible={visible} />
        {back === undefined ? null : (
            <RouteAction
                label={back.label}
                onPress={back.onPress}
                {...(back.href === undefined ? {} : { href: back.href })}
                className="inline-flex size-11 items-center justify-center rounded-md text-action-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
                <Icon name="chevronLeft" size={24} />
            </RouteAction>
        )}
        <p aria-hidden="true" className="min-w-0 flex-1 truncate text-bar-title text-ink">
            {title}
        </p>
        {menu}
    </div>
);
