'use client';

/**
 * @module home/chrome/ProfileAvatarEntry — the avatar at the end of a top-level page's header, opening Profile
 * (`docs/design/uiOverhaul/buildSpec.md` §3.3). Home's header shows it at every width, as the Home boards draw it; the
 * sidebar's profile row is the same entry beside it from `nav`.
 *
 * ORCHESTRATION: it reads the signed-in profile (`useUserProfile`, the same cached query `AppShell` reads) and the
 * router, and hands `@commise/ui/avatar` its state. Data enters the page chrome here, and only here.
 *
 * @pattern Adapter — the profile read and the router, as the design-system Avatar's props
 */
import { profileAvatarPropsOf } from '@commise/features-core/home';
import { homeMessages } from '@commise/features-core/home';
import { useLocale, useMessages } from '@commise/i18n/react';
import { Avatar, type AvatarSize } from '@commise/ui/avatar';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { JSX } from 'react';

import { useUserProfile } from '@/hooks/useUserProfile';

/** Props for {@link ProfileAvatarEntry}. */
export interface ProfileAvatarEntryProps {
    /** The disc's form; Home's header asks for `large`. Omitted, it is the 32 px disc. */
    readonly size?: AvatarSize;
}

/**
 * The page header's profile entry.
 *
 * @param props - The disc's form.
 * @returns The avatar link to Profile.
 */
export function ProfileAvatarEntry({ size }: ProfileAvatarEntryProps = {}): JSX.Element {
    const home = useMessages(homeMessages);
    const locale = useLocale();
    const router = useRouter();
    const profile = useUserProfile();
    const href = `/${locale}/profile`;

    return (
        <Avatar
            {...profileAvatarPropsOf(profile, home.chrome)}
            {...(size === undefined ? {} : { size })}
            href={href}
            onPress={() => router.push(href as Route)}
        />
    );
}
