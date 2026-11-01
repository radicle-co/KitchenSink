/**
 * @module @commise/features-account/profile/ProfileFactRow — a read-only Profile row (web): the label and a value the
 * cook cannot change here (their username and email, which Clerk owns). It is text, not a control: no button role, no
 * chevron, no press fill, so nothing invites a press that does nothing. A long value wraps anywhere rather than
 * overflowing 320 px.
 *
 * The label and the value are a `LabelValuePair`: the value at the end of the line, or under the label when the group's
 * column has too little room (designer ruling 2026-11-01, `nativeBoards/designAnswers.md`).
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';

import { LabelValuePair } from './LabelValuePair.js';
import type { ProfileFactRowProps } from './props.js';

/** The read-only row. */
export const ProfileFactRow: FC<ProfileFactRowProps> = ({ label, value }) => (
    <div className="flex min-h-14 w-full items-center px-4 py-2 text-body">
        <LabelValuePair label={<span className="text-ink">{label}</span>} value={value} />
    </div>
);
