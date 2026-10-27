/**
 * @module @commise/ui/surface-tone — the web {@link Surface}: an element wearing its tone's classes
 * (`surfaceToneClass.ts`), which paint its fill and set the inheriting custom properties its controls read. A surface
 * nested in another overrides all four, and a container that states nothing inherits its parent's, so a missed container
 * falls back to the surface above it, never to a wrong colour.
 *
 * A portal leaves the DOM tree, so a popup root (a sheet, a dialog, a menu) states its own tone rather than inheriting
 * what it was opened from; it does so with `surfaceToneClass` directly on the element the library gives it.
 *
 * A presentational leaf: props to an element, with no state and no behaviour.
 *
 * @pattern Ambient Context — the provider half: a surface states its tone once as inherited custom properties
 */
import type { FC } from 'react';

import type { SurfaceProps } from './props.js';
import { surfaceToneClass } from './surfaceToneClass.js';

/** A web surface: painted, and stated. */
export const Surface: FC<SurfaceProps> = ({
    tone,
    children,
    className,
    as: Element = 'div',
    role,
    'aria-label': ariaLabel,
}) => (
    <Element
        className={className === undefined ? surfaceToneClass(tone) : `${surfaceToneClass(tone)} ${className}`}
        aria-label={ariaLabel}
        role={role}
    >
        {children}
    </Element>
);
