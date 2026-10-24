'use client';

/**
 * @module @commise/ui/tooltip — the web {@link Tooltip} (see `props.ts`): a short label beside a control, drawn in a
 * PORTAL on `document.body` and anchored with Floating UI, so a clipping ancestor cannot cut it. That is why it exists:
 * the collapsed sidebar rail is `overflow-y-auto`, which makes its `overflow-x` clip too, and the in-flow
 * `absolute start-full` tip it replaced was a 4 px sliver on hover and invisible on focus (W-02).
 *
 * WCAG 1.4.13: it SHOWS on hover and on keyboard focus (`:focus-visible` only, so a click's focus does not add a second
 * trigger), is DISMISSIBLE with Escape without the pointer or focus moving, is HOVERABLE (the tip is a hit target and
 * joins the control by padding, not a gap, so the pointer can cross onto it — and a portal is its wrapper's child in React's
 * tree, so the pointer over the tip is still the pointer over the control), and PERSISTS until both have left. What
 * those rules mean is the pure machine in `tooltipEngagement`; this leaf maps DOM events onto it.
 *
 * A presentational design-system primitive, web only (no native twin: `props.ts`). Visual only: the tip is `aria-hidden` and adds no `aria-describedby`, because the control's own name already says the
 * words. A touch pointer does not open it (there is no hover to leave).
 *
 * `'use client'`: it holds state and subscribes to the document.
 *
 * @pattern Adapter over `@floating-ui/react-dom` — anchoring, flipping and shifting of a portalled tip
 * @pattern State — `tooltipEngagement` decides when it shows; this leaf draws
 */
import { autoUpdate, flip, shift, useFloating } from '@floating-ui/react-dom';
import { useEffect, useReducer, type FC, type FocusEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';

import type { TooltipProps } from './props.js';
import { IDLE, isOpen, reduceEngagement, type EngagementEvent } from './tooltipEngagement.js';
import { bridgeClassFor, placementFor } from './tooltipPlacement.js';

/** The tip keeps this far from the window's edge when it shifts to stay on screen. */
const VIEWPORT_PADDING = 8;

/**
 * @param target - What took focus.
 * @returns Whether the browser would draw a focus ring on it (keyboard focus, not a click's). An engine that does not
 *     know `:focus-visible` throws on the selector: treat that as focus, since showing a label is the safer error.
 */
function isFocusVisible(target: EventTarget): boolean {
    if (!(target instanceof Element)) {
        return false;
    }

    try {
        return target.matches(':focus-visible');
    } catch {
        return true;
    }
}

/** A tooltip around one control. */
export const Tooltip: FC<TooltipProps> = ({ label, side = 'end', fill = false, children }) => {
    const [engagement, send] = useReducer(reduceEngagement, IDLE);
    const open = isOpen(engagement);
    const {
        refs: { setReference, setFloating },
        elements: { reference },
        floatingStyles,
        placement,
    } = useFloating({
        open,
        strategy: 'fixed',
        placement: placementFor(side, open && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'),
        middleware: [flip(), shift({ padding: VIEWPORT_PADDING })],
        whileElementsMounted: autoUpdate,
    });

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const dismissOnEscape = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                send('escape');
            }
        };

        document.addEventListener('keydown', dismissOnEscape);

        return () => document.removeEventListener('keydown', dismissOnEscape);
    }, [open]);

    // @sideEffect While a dismissal holds a hover, watches where the pointer goes next. Escape on the TIP takes it away
    // from under a resting pointer, and a browser sends no leave from a node that is gone: the next move's boundary event
    // comes from the page under the old spot, so the control would never hear the hover end and the dismissal would
    // outlive both engagements, hiding the tip from a later keyboard focus. The first move onto anything outside the
    // control ends the hover.
    const dismissedWhileHovered = engagement.hovered && engagement.dismissed;

    useEffect(() => {
        if (!dismissedWhileHovered) {
            return undefined;
        }

        const endHoverOutside = (event: globalThis.PointerEvent): void => {
            const inside =
                reference instanceof Element && event.target instanceof Node && reference.contains(event.target);

            if (!inside && event.pointerType !== 'touch') {
                send('hoverEnd');
            }
        };

        document.addEventListener('pointerover', endHoverOutside);

        return () => document.removeEventListener('pointerover', endHoverOutside);
    }, [dismissedWhileHovered, reference]);

    const onPointer = (event: PointerEvent, type: Extract<EngagementEvent, 'hoverStart' | 'hoverEnd'>): void => {
        if (event.pointerType !== 'touch') {
            send(type);
        }
    };

    const onFocus = (event: FocusEvent): void => {
        if (isFocusVisible(event.target)) {
            send('focusStart');
        }
    };

    return (
        <span
            ref={setReference}
            className={fill ? 'block' : 'inline-flex'}
            onPointerEnter={(event) => onPointer(event, 'hoverStart')}
            onPointerLeave={(event) => onPointer(event, 'hoverEnd')}
            onFocus={onFocus}
            onBlur={() => send('focusEnd')}
        >
            {children}
            {open
                ? createPortal(
                      <div
                          ref={setFloating}
                          style={floatingStyles}
                          data-tooltip=""
                          data-placement={placement}
                          aria-hidden="true"
                          className={`z-50 ${bridgeClassFor(placement)}`}
                      >
                          <span className="block whitespace-nowrap rounded-md bg-inverse px-2 py-1 text-caption text-inverse-ink">
                              {label}
                          </span>
                      </div>,
                      document.body,
                  )
                : null}
        </span>
    );
};
