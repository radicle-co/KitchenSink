'use client';

/**
 * @module @commise/ui/avatar — the web avatar's 32 px disc, alone (`buildSpec.md` §3.3, §3.8): blank while the profile
 * loads, initials on `action` with a name, the `user` glyph without one or after a failed read. Decorative: the control
 * it sits in — the avatar, or the sidebar's profile row — carries the name.
 *
 * Presentational: props → JSX.
 *
 * @pattern Visitor — an exhaustive switch over the disc's three faces
 */
import type { FC } from 'react';

import { Icon } from '../icon/Icon.js';
import { avatarFaceOf, type AvatarDiscProps } from './props.js';

/** The disc's fill and ink per face. The initials sit on `action` at 4.67:1 (§3.3). */
const DISC_CLASS: Readonly<Record<ReturnType<typeof avatarFaceOf>, string>> = {
    blank: 'bg-surface-muted',
    initials: 'bg-action text-label text-on-action',
    glyph: 'bg-surface-muted text-ink-muted',
};

/** The 32 px disc, decorative: the control it sits in carries the name. */
export const AvatarDisc: FC<AvatarDiscProps> = ({ status, initials }) => {
    const face = avatarFaceOf({ status, initials });

    return (
        <span
            aria-hidden="true"
            className={`flex size-8 shrink-0 items-center justify-center rounded-full ${DISC_CLASS[face]}`}
        >
            {face === 'initials' ? initials : null}
            {face === 'glyph' ? <Icon name="user" size={20} /> : null}
        </span>
    );
};
