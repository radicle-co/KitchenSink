/**
 * @module @commise/ui/sync-notice — the web sync notice.
 *
 * A presentational leaf: it renders the caller's strings and nothing else — no state, no data, no branching
 * beyond the state union.
 *
 * ⛔ POLITE, NOT ASSERTIVE. Nothing has failed and the cook did not just act — their work is saved and will
 * send itself. An assertive region would interrupt a screen reader to deliver reassurance, which is the
 * wrong trade; the repo's own rule reserves assertive for "an action the viewer just took failing".
 *
 * @pattern Adapter over the ARIA live-region protocol — connectivity expressed as a polite `status`
 *     announcement, with no control because there is nothing for the viewer to do.
 */
import type { FC } from 'react';

import { Surface } from '../surfaceTone/Surface.js';
import type { SyncNoticeProps } from './props.js';

/** The app-wide connectivity + unsynced-work notice. */
export const SyncNotice: FC<SyncNoticeProps> = ({ state, regionLabel, quiet = false }) => (
    // ⚠️ The region is mounted even while hidden, so a state change ANNOUNCES. A region that appears with its
    // text already in place is not reliably read out — the same reason `RefreshNotice` mounts its own empty.
    // ⚠️ `quiet` drops the role AND the name, never adds `aria-live="off"`: a name on a div with no role is
    // prohibited by ARIA 1.2, and an `aria-live` attribute would exempt the notice from the dialog's hiding.
    <div role={quiet ? undefined : 'status'} aria-label={quiet ? undefined : regionLabel} className="px-4">
        {state.kind !== 'hidden' && (
            <Surface tone="muted" className="rounded-lg px-4 py-3">
                <p className="text-body-sm font-semibold text-ink">{state.title}</p>
                {state.body !== undefined && <p className="text-body-sm text-ink-muted">{state.body}</p>}
            </Surface>
        )}
    </div>
);
