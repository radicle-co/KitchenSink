'use client';

/**
 * @module @commise/ui/choice-row — the web design-system {@link ChoiceRow}: a 48 px button across its list, its words
 * starting at the edge, then a check when it is chosen, or a spinner while its send is in flight.
 *
 * - ⛔ A BUTTON, never a radio: its press is the choice, and the arrow keys do nothing (WCAG 3.2.2).
 * - Busy and refused rows stay FOCUSABLE: `aria-disabled` with the click cancelled, never native `disabled`, because
 *   the row just pressed holds focus and a browser drops focus from a disabled control (2.4.3). Both take the house
 *   dim (`BUSY_CONTROL_CLASS`); only the busy row says so (`aria-busy`) and spins, as `Button` does — inside a control
 *   the spin is the only busy cue, so it spins under reduced motion too.
 * - The check never carries the state alone: the caller's name says ", chosen" (1.4.1).
 * - The row draws no edge of its own: the list it sits in draws its box and the dividers between rows.
 *
 * Presentational: props → JSX; the focus request is the one effect, and the one reason this leaf holds a ref. The
 * native leaf is `./ChoiceRow.native.tsx`.
 *
 * @pattern Slot — the caller hands in the label, so a tagged food and the quiet keep row share one row
 * @pattern Adapter over the DOM focus API — a level-triggered focus request, acknowledged once taken; `.focus()` has no
 *     declarative form
 */
import { useRef, type FC } from 'react';

import { BUSY_CONTROL_CLASS, busyControlProps } from '../button/busyControlProps.js';
import { useFocusRequest } from '../focusRequest/useFocusRequest.js';
import { Icon } from '../icon/Icon.js';
import { Spinner } from '../spinner/Spinner.js';
import type { ChoiceRowProps } from './props.js';
import { FOCUS_RING_CLASS } from '../focusRing/focusRingClass.js';

/** The row: a 48 px button across its list. */
const ROW_CLASS = `flex min-h-12 w-full items-center gap-3 px-3 py-2 text-start hover:bg-surface-muted ${FOCUS_RING_CLASS.inset} ${BUSY_CONTROL_CLASS}`;

/** The web choice row. */
export const ChoiceRow: FC<ChoiceRowProps> = ({
    children,
    accessibilityLabel,
    chosen,
    busy,
    refused,
    onPress,
    focusRequested = false,
    onFocusRequestHandled,
}) => {
    const node = useRef<HTMLButtonElement>(null);
    useFocusRequest(focusRequested, () => node.current?.focus(), onFocusRequestHandled);

    return (
        <button
            ref={node}
            type="button"
            aria-label={accessibilityLabel}
            {...busyControlProps({ busy, refused, onClick: onPress })}
            className={chosen ? `${ROW_CLASS} bg-selected-fill` : ROW_CLASS}
        >
            {children}
            {busy ? (
                <span aria-hidden="true" className="inline-flex shrink-0 text-action-text">
                    <Spinner className="animate-spin" />
                </span>
            ) : null}
            {!busy && chosen ? <Icon name="check" size={20} tone="actionText" /> : null}
        </button>
    );
};
