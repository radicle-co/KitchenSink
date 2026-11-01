/**
 * @module @commise/features-account/profile/ProfileFactRow — a read-only Profile row (web): the label and a value the
 * cook cannot change here (their username and email, which Clerk owns). It is text, not a control: no button role, no
 * chevron, no press fill, so nothing invites a press that does nothing. A long value wraps anywhere rather than
 * overflowing 320 px.
 *
 * The value sits at the end of the line beside its label. When the group's column (its `rows` container) has less than
 * 17.5 rem of room, the value stacks under its label at the start, 4 px below it (designer ruling 2026-11-01,
 * `nativeBoards/designAnswers.md`). 17.5 rem is the native rule's 280 at the default text size, and a rem follows the
 * browser's text size. Each variant is written out whole, because Tailwind generates only the class names it finds.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';

import type { ProfileFactRowProps } from './props.js';

/** The read-only row. */
export const ProfileFactRow: FC<ProfileFactRowProps> = ({ label, value }) => (
    <div
        className={
            'flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-body ' +
            '@max-[17.5rem]/rows:flex-col @max-[17.5rem]/rows:items-start @max-[17.5rem]/rows:justify-center ' +
            '@max-[17.5rem]/rows:gap-1'
        }
    >
        <span className="text-ink">{label}</span>
        <span className="min-w-0 text-end text-ink-muted [overflow-wrap:anywhere] @max-[17.5rem]/rows:text-start">
            {value}
        </span>
    </div>
);
