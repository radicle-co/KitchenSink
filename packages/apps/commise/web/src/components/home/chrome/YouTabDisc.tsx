/**
 * @module home/chrome/YouTabDisc — the You tab's glyph: the cook's avatar as a 24 px disc (`docs/design/uiOverhaul/buildSpec.md`
 * §3.2, owner ruling 2026-11-11, N3). Same content rules as the chrome `Avatar` (`avatarFaceOf`): a `pearl` disc while the
 * profile loads, the initials in a 10 px label on the `action` fill, the 20 px outline `user` glyph with no name or after
 * a failed read. Active, a 2 px `ink` ring stands in for the filled glyph the other tabs cannot have.
 *
 * Decorative: the tab's own label, "You", is its name (SC 2.5.3). The design system's `AvatarDisc` has a 32 px and a 36 px
 * form only, so this 24 px form is drawn here from the same face rule rather than added to its closed size union, which
 * the native disc must follow.
 *
 * Presentational: props → JSX.
 *
 * @pattern Visitor — an exhaustive switch over the disc's three faces
 */
import { YOU_TAB_INITIALS_SIZE, initialsFor, type ProfileEntry } from '@commise/features-core';
import { avatarFaceOf } from '@commise/ui/avatar-props';
import { Icon } from '@commise/ui/icon';
import type { JSX } from 'react';

/** The disc's fill and ink per face. */
const FACE_CLASS: Readonly<Record<ReturnType<typeof avatarFaceOf>, string>> = {
    blank: 'bg-surface-muted',
    initials: 'bg-action font-semibold leading-none text-on-action',
    glyph: 'bg-surface-muted text-ink-muted',
};

/** Props for {@link YouTabDisc}. */
export interface YouTabDiscProps {
    /** The profile read. */
    readonly profile: ProfileEntry;
    /** Whether the You tab is the current one: the disc takes its ink ring. */
    readonly active: boolean;
}

/**
 * The You tab's disc.
 *
 * @param props - The profile read and whether the tab is current.
 * @returns The 24 px decorative disc.
 */
export function YouTabDisc({ profile, active }: YouTabDiscProps): JSX.Element {
    const initials = initialsFor(profile.name);
    const face = avatarFaceOf({ status: profile.status, initials });

    return (
        <span
            aria-hidden="true"
            data-you-disc=""
            className={`flex size-6 shrink-0 items-center justify-center rounded-full ${FACE_CLASS[face]} ${
                active ? 'ring-2 ring-ink' : ''
            }`}
        >
            {face === 'initials' ? <span style={{ fontSize: YOU_TAB_INITIALS_SIZE }}>{initials}</span> : null}
            {face === 'glyph' ? <Icon name="user" size={20} /> : null}
        </span>
    );
}
