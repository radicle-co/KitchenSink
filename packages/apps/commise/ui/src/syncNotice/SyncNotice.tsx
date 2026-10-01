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

import type { SyncNoticeProps } from './props.js';

/** The app-wide connectivity + unsynced-work notice. */
export const SyncNotice: FC<SyncNoticeProps> = ({ state, regionLabel }) => (
    // ⚠️ The region is mounted even while hidden, so a state change ANNOUNCES. A region that appears with its
    // text already in place is not reliably read out — the same reason `RefreshNotice` mounts its own empty.
    <div role="status" aria-label={regionLabel} className="px-4">
        {state.kind !== 'hidden' && (
            <div className="rounded-2xl bg-pearl px-4 py-3">
                <p className="text-body-sm font-semibold text-charcoal">{state.title}</p>
                <p className="text-body-sm text-slate">{state.body}</p>
            </div>
        )}
    </div>
);
