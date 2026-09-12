/**
 * @module @commise/ui/pending-bar — the web bar that says the results on screen are being replaced.
 *
 * A still, 4px `seafoam` bar. The results it sits above stay at full strength and fully usable while newer ones are
 * pending: dimming them would take their text below 4.5:1 (SC 1.4.3), and they can still be opened. It does not
 * move, because a moving bar beside usable content is not covered by SC 2.2.2's loading exemption, so reduce-motion
 * viewers see exactly what everyone else sees.
 *
 * It appears only after {@link PENDING_BAR_DELAY_MS}, and CSS does the waiting: the `animate-pending-bar-reveal`
 * utility is a zero-length opacity animation whose `both` fill holds the bar invisible through the inline
 * `animation-delay`. No timer and no hydration dependency. Deliberately NOT behind `motion-safe:`: it is a delay.
 *
 * Placement: absolutely positioned, so it takes no layout space and nothing shifts. Render it inside a `relative`
 * container that follows a `gap-6` (24px) gap; `-top-3.5` centres the bar in that gap. Hidden from assistive tech, and
 * paired with NO `aria-busy` on the results (JAWS hides busy content): nothing is announced while results are pending,
 * and the settled results are what gets announced.
 *
 * A presentational leaf: `pending` in, bar out.
 *
 * @pattern Delayed reveal — CSS animation-delay on web, a timer child on native
 */
import type { FC } from 'react';

import { PENDING_BAR_DELAY_MS } from './pendingDelay.js';
import type { PendingBarProps } from './props.js';

/** The pending-results bar: nothing while nothing is pending, then the delayed still bar. */
export const PendingBar: FC<PendingBarProps> = ({ pending }) =>
    pending ? (
        <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-3.5 h-1 rounded-full bg-seafoam animate-pending-bar-reveal"
            style={{ animationDelay: `${PENDING_BAR_DELAY_MS}ms` }}
        />
    ) : null;
