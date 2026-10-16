/**
 * @module navigation/ProfileAvatarEntry — the avatar at the end of a tab root's large title, which pushes Profile onto
 * the CURRENT tab's stack (`docs/design/uiOverhaul/buildSpec.md` §3.1, §3.3). Native's `'·'` for a name-less cook is
 * gone: the design system draws the `user` glyph (M8).
 *
 * ORCHESTRATION: it reads the signed-in profile (`useUserProfile`) and hands `@commise/ui/avatar` its state; the route
 * says where a press goes. Data enters the chrome here.
 *
 * @pattern Adapter — the profile read, as the design-system Avatar's props
 */
import { profileAvatarPropsOf } from '@commise/features-core/home';
import { homeMessages } from '@commise/features-core/home';
import { useMessages } from '@commise/i18n/react';
import { Avatar } from '@commise/ui/avatar';
import type { JSX } from 'react';

import { useUserProfile } from '../hooks/useUserProfile.js';

/** Props for {@link ProfileAvatarEntry}. */
export interface ProfileAvatarEntryProps {
    /** Push Profile onto the current tab's stack. */
    readonly onPress: () => void;
}

/**
 * @param props - What a press does.
 * @returns The tab root's profile entry.
 */
export function ProfileAvatarEntry({ onPress }: ProfileAvatarEntryProps): JSX.Element {
    const home = useMessages(homeMessages);
    const profile = useUserProfile();

    return <Avatar {...profileAvatarPropsOf(profile, home.chrome)} onPress={onPress} />;
}
