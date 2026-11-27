'use client';

/**
 * @module @commise/ui/window-scope — what makes a web window a window for the snackbar: one level deeper than the
 * window around it, with an outlet inside it for the snackbar host to draw in.
 *
 * While a modal Radix dialog is open, Radix keeps Tab inside it, hides the rest of the page from screen readers and
 * closes it on a press outside, so a snackbar drawn at the page's foot cannot be reached. Every web window mounts one
 * `WindowScope` inside its Radix content, so the snackbar shown while it is open is drawn inside it. It is the web
 * twin of native's `OverlayHost`, and the one home of that rule: a window that mounts its own outlet and its own depth
 * is a window that can forget one of them.
 *
 * It renders no element of its own: its children, then the outlet, last, so Undo follows the window's own controls in
 * the focus order. The outlet is `absolute`, so the box around the scope must be the window's `fixed` box, and that
 * box must not scroll itself.
 *
 * @pattern Scoped context + Mediator slot — provides the depth, and mounts the slot the snackbar host's Mediator fills
 */
import { useContext, type FC, type ReactNode } from 'react';

import { SnackbarOutlet } from '../snackbar/SnackbarOutlet.js';
import { OverlayDepthContext } from './overlayDepthContext.js';

/** Props for {@link WindowScope}. */
export interface WindowScopeProps {
    /** The window's content. */
    readonly children?: ReactNode;
    /** The window's pinned foot, px: the snackbar sits 16 above it. Unset: 16 above the window's own foot. */
    readonly footHeight?: number;
}

/**
 * One window's scope: the depth for its children and the snackbar's outlet. Presentational: its props and one context
 * read in, JSX out, with no data of its own and no effect.
 *
 * @param props - The window's content and, when it has one, the height of its pinned foot.
 * @returns The content, then the outlet.
 */
export const WindowScope: FC<WindowScopeProps> = ({ children, footHeight }) => {
    const depth = useContext(OverlayDepthContext) + 1;

    return (
        <OverlayDepthContext value={depth}>
            {children}
            <SnackbarOutlet depth={depth} footHeight={footHeight} />
        </OverlayDepthContext>
    );
};
