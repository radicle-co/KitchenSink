/**
 * @module @commise/ui/offline-notice — the web offline read slot.
 *
 * ⚠️ KEEPS `role="status"` even though the announcement is unreliable here. A Suspense fallback mounts
 * ALREADY populated, and a live region that appears with its text in place is not guaranteed to be announced.
 * Unreliable is not the same as absent, though: the region costs nothing, never interrupts, and is the only
 * channel this surface has — removing it would trade a partial announcement for none. The swap BACK to
 * content is deliberately silent.
 *
 * A presentational leaf: it renders the message and nothing else — no state, no data, no branching.
 *
 * @pattern Adapter over the ARIA live-region protocol — the parked-read state expressed as a `status`
 *     announcement rather than as a visual affordance, because this surface deliberately has no control to
 *     focus or press.
 */
import type { FC } from 'react';

import type { OfflineReadSlotProps } from './props.js';

/** The offline read slot: one quiet line where the screen's content would be. */
export const OfflineReadSlot: FC<OfflineReadSlotProps> = ({ message }) => (
    // No title, icon, accent or border — deliberately quieter than the app-wide connectivity banner, so the
    // two read as a hierarchy rather than as two alarms competing on one screen.
    // Contrast: `slate` on `white` is 5.24:1 and on `pearl` 4.81:1, both clearing the 4.5:1 body floor (1.4.3).
    <p role="status" className="px-4 py-8 text-center text-body-sm text-slate">
        {message}
    </p>
);
