'use client';

/**
 * @module @commise/ui/avatar — the web avatar's disc, alone (`buildSpec.md` §3.3, §3.8): blank while the profile
 * loads, initials on `action` with a name, the `user` glyph without one or after a failed read. Decorative: the control
 * it sits in — the avatar, or the sidebar's profile row — carries the name.
 *
 * Presentational: props → JSX.
 *
 * @pattern Visitor — an exhaustive switch over the disc's three faces
 * @pattern Variant — the disc's form is a closed `Record` over `AvatarSize`, the discriminated-union render map
 */
import type { FC } from 'react';

import { Icon } from '../icon/Icon.js';
import { initialsPxOf } from './initialsSize.js';
import { AVATAR_DISC_PT, avatarFaceOf, type AvatarDiscProps, type AvatarSize } from './props.js';

/** The disc's fill and ink per face. The initials sit on `action` at 4.67:1 (§3.3). */
const DISC_CLASS: Readonly<Record<ReturnType<typeof avatarFaceOf>, string>> = {
    blank: 'bg-surface-muted',
    initials: 'bg-action font-semibold text-on-action',
    glyph: 'bg-surface-muted text-ink-muted',
};

/** The disc's box per form: 32 px plain, or 36 px with the small shadow and a 1 px divider ring (the Home header). */
const SIZE_CLASS: Readonly<Record<AvatarSize, string>> = {
    default: 'size-8',
    large: 'size-9 shadow-sm ring-1 ring-line-divider',
};

/** The disc, decorative: the control it sits in carries the name. */
export const AvatarDisc: FC<AvatarDiscProps> = ({ status, initials, size = 'default' }) => {
    const face = avatarFaceOf({ status, initials });

    return (
        <span
            aria-hidden="true"
            className={`flex ${SIZE_CLASS[size]} shrink-0 items-center justify-center rounded-full ${DISC_CLASS[face]}`}
        >
            {face === 'initials' ? (
                <span style={{ fontSize: initialsPxOf(AVATAR_DISC_PT[size]) }}>{initials}</span>
            ) : null}
            {face === 'glyph' ? <Icon name="user" size={20} /> : null}
        </span>
    );
};
