/**
 * @module @commise/features-core/home — what the page header's avatar shows, from the profile read.
 */
// The props module, not the `avatar` export: that one re-exports the `.tsx` leaves (see `../profileEntry.ts`).
import type { AvatarProps } from '@commise/ui/avatar-props';

import { profileEntryOf, profileLabelOf, type ProfileEntryCopy, type ProfileRead } from '../profileEntry.js';
import { initialsFor } from '../utils/initials.js';

/**
 * The avatar's state, initials and accessible name for the signed-in profile read. The two apps' `ProfileAvatarEntry`
 * add what differs: where a press goes (a link and the router on web, a pushed route on native).
 *
 * @param read - The profile query's state.
 * @param copy - The app's two names for the entry ("Profile, {name}" and "Profile").
 * @returns The avatar's `status`, `initials` and `label`. Pure.
 */
export function profileAvatarPropsOf(
    read: ProfileRead,
    copy: ProfileEntryCopy,
): Pick<AvatarProps, 'status' | 'initials' | 'label'> {
    const entry = profileEntryOf(read);

    return { status: entry.status, initials: initialsFor(entry.name), label: profileLabelOf(copy, entry.name) };
}
