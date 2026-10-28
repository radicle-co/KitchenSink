/**
 * @module @commise/features-account/profile/ProfileFactRow — a read-only Profile row (web): the label and a value the
 * cook cannot change here (their username and email, which Clerk owns). It is text, not a control: no button role, no
 * chevron, no press fill, so nothing invites a press that does nothing. A long value wraps anywhere rather than
 * overflowing 320 px.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';

import type { ProfileFactRowProps } from './props.js';

/** The read-only row. */
export const ProfileFactRow: FC<ProfileFactRowProps> = ({ label, value }) => (
    <div className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-body">
        <span className="text-ink">{label}</span>
        <span className="min-w-0 text-end text-ink-muted [overflow-wrap:anywhere]">{value}</span>
    </div>
);
