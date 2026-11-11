'use client';

/**
 * @module @commise/ui/avatar — the web avatar's disc (`buildSpec.md` §3.2, §3.3, §3.8): blank while the profile loads,
 * initials on `action` with a name, the `user` glyph without one or after a failed read. Decorative: the control it sits in
 * — the sidebar's profile row, or the You tab — carries the name.
 *
 * Two forms: the 32 `default` of the sidebar's row, and the 24 `tab` glyph, a box of CSS px and never rem, because a glyph
 * does not scale with the text and the icons beside it are 24. `active` adds a 2 `ink` ring drawn as a shadow, which takes
 * no layout room, so the tab's label keeps the others' baseline.
 *
 * Presentational: props → JSX.
 *
 * @pattern Visitor — an exhaustive switch over the disc's three faces
 * @pattern Variant — the disc's form is a closed `Record` over `AvatarSize`, the discriminated-union render map
 */
import type { CSSProperties, FC } from 'react';

import { Icon } from '../icon/Icon.js';
import { initialsPxOf } from './initialsSize.js';
import { AVATAR_DISC_PT, avatarFaceOf, type AvatarDiscProps, type AvatarSize } from './props.js';

/** The disc's fill and ink per face. The initials sit on `action` at 4.67:1 (§3.3). */
const DISC_CLASS: Readonly<Record<ReturnType<typeof avatarFaceOf>, string>> = {
    blank: 'bg-surface-muted',
    initials: 'bg-action font-semibold text-on-action',
    glyph: 'bg-surface-muted text-ink-muted',
};

/** The disc's box per form: a Tailwind size for the 32, and CSS px for the tab glyph, which no text size may grow. */
const SIZE: Readonly<Record<AvatarSize, { readonly className: string; readonly style?: CSSProperties }>> = {
    default: { className: 'size-8' },
    tab: { className: '', style: { width: AVATAR_DISC_PT.tab, height: AVATAR_DISC_PT.tab } },
};

/** The disc, decorative: the control it sits in carries the name. */
export const AvatarDisc: FC<AvatarDiscProps> = ({ status, initials, size = 'default', active = false }) => {
    const face = avatarFaceOf({ status, initials });
    const box = SIZE[size];

    return (
        <span
            aria-hidden="true"
            data-avatar-disc=""
            {...(box.style === undefined ? {} : { style: box.style })}
            className={`flex ${box.className} shrink-0 items-center justify-center rounded-full ${DISC_CLASS[face]} ${
                active ? 'ring-2 ring-ink' : ''
            }`}
        >
            {face === 'initials' ? (
                <span style={{ fontSize: initialsPxOf(AVATAR_DISC_PT[size]) }}>{initials}</span>
            ) : null}
            {face === 'glyph' ? <Icon name="user" size={20} /> : null}
        </span>
    );
};
