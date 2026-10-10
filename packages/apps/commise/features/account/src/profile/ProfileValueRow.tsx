/**
 * @module @commise/features-account/profile/ProfileValueRow — a read-only Profile row (web): the label and the value
 * the cook cannot change here (their email). Not a control, so it is not focusable and not a button.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';

import type { ProfileValueRowProps } from './props.js';

/** A read-only row. The value wraps anywhere: an email is one unbroken string at 320 px. */
export const ProfileValueRow: FC<ProfileValueRowProps> = ({ label, value }) => (
    <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-2">
        <span className="shrink-0 text-body text-ink">{label}</span>
        {/* One line, truncated (§9.1): the header shows the whole address; broken anywhere it read "examp / le". */}
        <span title={value} className="min-w-0 truncate text-end text-body text-ink-muted">
            {value}
        </span>
    </div>
);
