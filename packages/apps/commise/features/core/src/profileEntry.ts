/**
 * @module @commise/features-core — what the profile entry (the header's avatar, the sidebar's profile row) shows, from
 * the profile read, once for both apps (`docs/design/uiOverhaul/buildSpec.md` §3.3, §3.8): a blank disc while it loads
 * (nothing else waits for it), the `user` glyph and no error when it failed (Profile reports it), and the cook's name,
 * if any, once it is ready — with its accessible name, "Profile, {name}" or "Profile".
 */
// The props module, not the `avatar` export: that one re-exports the `.tsx` leaves, which this JSX-free package cannot
// compile (`@commise/ui/icon-names` is the same split).
import type { AvatarStatus } from '@commise/ui/avatar-props';

/** The profile entry's state and the cook's display name. */
export interface ProfileEntry {
    readonly status: AvatarStatus;
    readonly name: string | undefined;
}

/** The slice of a profile query this reads. */
export interface ProfileRead {
    readonly isError: boolean;
    readonly data?: { readonly user: { readonly displayName: string } } | undefined;
}

/**
 * @param read - The profile query's state.
 * @returns The entry. A blank name is no name. Pure.
 */
export function profileEntryOf(read: ProfileRead): ProfileEntry {
    if (read.data !== undefined) {
        const name = read.data.user.displayName.trim();

        return { status: 'ready', name: name === '' ? undefined : name };
    }

    return { status: read.isError ? 'failed' : 'loading', name: undefined };
}

/** The two names an app's copy gives the entry. */
export interface ProfileEntryCopy {
    /** "Profile, {name}". */
    readonly profileButton: string;
    /** "Profile". */
    readonly profileButtonNoName: string;
}

/**
 * @param copy - The app's two names for the entry.
 * @param name - The cook's name, if any.
 * @returns The accessible name. Pure.
 */
export function profileLabelOf(copy: ProfileEntryCopy, name: string | undefined): string {
    return name === undefined ? copy.profileButtonNoName : copy.profileButton.replace('{name}', name);
}
