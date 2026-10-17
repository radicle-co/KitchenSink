/**
 * @module @commise/ui/avatar — the shared contract of the design-system `Avatar`: the profile entry at the end of a
 * top-level screen's header and in the sidebar's profile row (`docs/design/uiOverhaul/buildSpec.md` §3.3, §3.8).
 *
 * A 32 px disc in a 44 × 44 target. While the profile loads it is a plain `surfaceMuted` disc and nothing else waits
 * for it. With initials it shows them on the `action` fill. With no name — or when the profile failed to load — it shows
 * a `user` glyph; the chrome never shows an error (Profile reports it). The caller passes the localized name, "Profile,
 * {name}" or "Profile", and the initials (`initialsFor` in `@commise/features-core`), so the design system holds no copy
 * and no name rule.
 */

/** Where the profile read is. */
export type AvatarStatus = 'loading' | 'ready' | 'failed';

/** The cross-platform `Avatar` contract. */
export interface AvatarProps {
    /** The profile read's state. */
    readonly status: AvatarStatus;
    /** The cook's initials, or empty when there is no name. Read only when `status` is `ready`. */
    readonly initials: string;
    /** The accessible name: "Profile, {name}", or "Profile" without one. */
    readonly label: string;
    /** Open Profile. On web a plain click comes here and the link's own navigation is cancelled. */
    readonly onPress: () => void;
    /** The web URL of Profile, so a modified click (a new tab) still works. Native ignores it. */
    readonly href?: string;
}

/** The disc alone, for a row that is itself the link (the sidebar's profile row): decorative, no name of its own. */
export type AvatarDiscProps = Pick<AvatarProps, 'status' | 'initials'>;

/** What the disc shows. Pure. */
export function avatarFaceOf({
    status,
    initials,
}: Pick<AvatarProps, 'status' | 'initials'>): 'blank' | 'initials' | 'glyph' {
    if (status === 'loading') {
        return 'blank';
    }

    return status === 'ready' && initials !== '' ? 'initials' : 'glyph';
}
