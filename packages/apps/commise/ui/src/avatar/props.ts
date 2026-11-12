/**
 * @module @commise/ui/avatar — the shared contract of the design-system `AvatarDisc`: the cook's avatar as a disc, in the
 * sidebar's profile row (32 px) and as the You tab's glyph (24 px) (`docs/design/uiOverhaul/buildSpec.md` §3.2, §3.3,
 * §3.8).
 *
 * While the profile loads it is a plain `surfaceMuted` disc and nothing else waits for it. With initials it shows them on
 * the `action` fill. With no name — or when the profile failed to load — it shows a `user` glyph; the chrome never shows an
 * error (Profile reports it). The caller passes the initials (`initialsFor` in `@commise/features-core`), so the design
 * system holds no name rule. The disc is decorative: the control it sits in carries the name.
 */

/** Where the profile read is. */
export type AvatarStatus = 'loading' | 'ready' | 'failed';

/** The disc's form: `default` is the 32 disc of the sidebar's row; `tab` is the 24 glyph of the You tab, the icons' own box. */
export type AvatarSize = 'default' | 'tab';

/** The disc's diameter per form, in pt (native; the web draws the same two sizes in px). */
export const AVATAR_DISC_PT: Readonly<Record<AvatarSize, number>> = { default: 32, tab: 24 };

/** The width of the ring an `active` disc is drawn with, in px or pt. */
export const AVATAR_RING_PX = 2;

/** The disc's props. */
export interface AvatarDiscProps {
    /** The disc's form. Defaults to `default`. */
    readonly size?: AvatarSize;
    /** The profile read's state. */
    readonly status: AvatarStatus;
    /** The cook's initials, or empty when there is no name. Read only when `status` is `ready`. */
    readonly initials: string;
    /**
     * Whether the disc is drawn with a 2 `ink` ring, which stands in for a filled glyph on the current tab. The ring is laid
     * outside the disc's box (a box-shadow on web, an outline on native), so it adds no layout size and nothing moves.
     */
    readonly active?: boolean;
}

/** What the disc shows. Pure. */
export function avatarFaceOf({
    status,
    initials,
}: Pick<AvatarDiscProps, 'status' | 'initials'>): 'blank' | 'initials' | 'glyph' {
    if (status === 'loading') {
        return 'blank';
    }

    return status === 'ready' && initials !== '' ? 'initials' : 'glyph';
}
