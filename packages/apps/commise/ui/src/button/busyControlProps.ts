/**
 * @module @commise/ui/button — the focus rule for a raw web control that cannot be the design-system `Button`.
 *
 * ⛔ A CONTROL WHOSE OWN PRESS CAN MAKE IT UNAVAILABLE KEEPS FOCUS. A real browser drops focus to <body> the moment
 * a focused control becomes natively `disabled` (WCAG 2.2 SC 2.4.3), and the focused control is the one just
 * pressed: a button whose request is now in flight, or a stepper's + that just reached the maximum. So such a
 * control is `aria-disabled`, and the press is CANCELLED — `preventDefault`, not merely skipped, because HTML
 * implicit submission (Enter in a field) fires a click on a form's default button and only cancelling that click
 * stops a second submit.
 *
 * Two shapes over one rule: {@link refusedPressProps} for a control that is unavailable, and
 * {@link busyControlProps} for one whose work is in flight, which also says so (`aria-busy`). `Button` applies the
 * busy one.
 *
 * ⚠️ Native `disabled` is still right for a control nothing the person pressed made unavailable — a form not yet
 * valid, an option their plan does not include: focusable-but-dead is worse there. A control that is both (a
 * submit that is blocked until the form is valid, and busy once submitted) passes that rule as `blocked`, and
 * {@link busyControlProps} owns the precedence: `blocked` disables only while idle, because once busy the
 * control is the one just pressed — and a rule that reads the in-flight state would otherwise strand its focus.
 *
 * Web only; the native leaves keep native `disabled`, which does not move the screen-reader cursor.
 */
import type { MouseEvent } from 'react';

/**
 * The visual treatment of an unavailable control, stated once: `Button`'s surface uses it, and a raw control
 * spreading {@link refusedPressProps} or {@link busyControlProps} applies it beside its own classes.
 */
export const BUSY_CONTROL_CLASS = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

/** The press handler both prop-getters wrap. */
type PressHandler = (event: MouseEvent<HTMLButtonElement>) => void;

/** What {@link refusedPressProps} reads. */
export interface RefusedPressOptions {
    /** Whether the control is unavailable right now. */
    readonly unavailable: boolean;
    /** The press handler, called only while available. */
    readonly onClick?: PressHandler;
}

/** The attributes and press handler {@link refusedPressProps} returns, to spread onto a `<button>`. */
export interface RefusedPressProps {
    readonly 'aria-disabled': true | undefined;
    readonly onClick: PressHandler;
}

/**
 * Props for a raw `<button>` that its own press can make unavailable. Pure.
 *
 * @param options - Whether the control is unavailable, and its press handler.
 * @returns `aria-disabled` and a press handler that cancels the click while unavailable.
 */
export function refusedPressProps({ unavailable, onClick }: RefusedPressOptions): RefusedPressProps {
    return {
        'aria-disabled': unavailable || undefined,
        onClick: (event) => {
            if (unavailable) {
                event.preventDefault();

                return;
            }

            onClick?.(event);
        },
    };
}

/** What {@link busyControlProps} reads. */
export interface BusyControlOptions {
    /** Whether the action this control starts is in flight. */
    readonly busy: boolean;
    /** Whether a rule the press did not cause makes the control unavailable. Natively disables it while idle. */
    readonly blocked?: boolean;
    /** The press handler, called only while idle. */
    readonly onClick?: PressHandler;
}

/** The attributes and press handler {@link busyControlProps} returns, to spread onto a `<button>`. */
export interface BusyControlProps extends RefusedPressProps {
    readonly 'aria-busy': true | undefined;
    readonly disabled: boolean;
}

/**
 * Props for a raw `<button>` whose action can be in flight: {@link refusedPressProps}, plus `aria-busy`, plus
 * native `disabled` for a `blocked` rule while idle. Spread it LAST among a control's availability attributes —
 * it states all of them. Pure.
 *
 * @param options - Whether the control is busy or blocked, and its press handler.
 * @returns The busy and disabled attributes, and a press handler that cancels the click while busy.
 */
export function busyControlProps({ busy, blocked = false, onClick }: BusyControlOptions): BusyControlProps {
    return {
        ...refusedPressProps({ unavailable: busy, onClick }),
        'aria-busy': busy || undefined,
        disabled: !busy && blocked,
    };
}
