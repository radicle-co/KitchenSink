'use client';

/**
 * @module @commise/ui/hero-button — the web design-system {@link HeroButton} (see `props.ts`): a solid 44 px
 * `photoChip` disc with an `ink` glyph and a visible focus ring. No backdrop blur, by D12.
 *
 * With an `href` it is a real link (`RouteAction`): a plain click goes to `onPress` with the browser's navigation
 * cancelled so the app's router moves, and a modified click is left to the browser.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';

import { Icon } from '../icon/Icon.js';
import { RouteAction } from '../routeLink/RouteAction.js';
import type { HeroButtonProps } from './props.js';

/**
 * The disc's classes, shared with the ⋯ menu's trigger (`ActionMenu` `appearance="disc"`) so the two cannot differ.
 * Written whole: Tailwind finds a class only when it appears whole in the source.
 */
export const HERO_DISC_CLASS =
    'inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-photo-chip text-ink shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2';

/** The web control over a photo. */
export const HeroButton: FC<HeroButtonProps> = ({ icon, label, onPress, href, expanded, disabled = false }) => {
    const glyph = <Icon name={icon} size={24} tone="ink" />;

    if (href === undefined) {
        return (
            <button
                type="button"
                aria-label={label}
                aria-expanded={expanded}
                aria-disabled={disabled || undefined}
                onClick={disabled ? undefined : onPress}
                className={HERO_DISC_CLASS}
            >
                {glyph}
            </button>
        );
    }

    return (
        <RouteAction label={label} href={href} onPress={onPress} className={HERO_DISC_CLASS}>
            {glyph}
        </RouteAction>
    );
};
