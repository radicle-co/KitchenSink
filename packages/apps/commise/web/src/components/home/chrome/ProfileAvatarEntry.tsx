'use client';

/**
 * @module home/chrome/ProfileAvatarEntry — the avatar at the end of a top-level page's header below `nav`, opening
 * Profile (`docs/design/uiOverhaul/buildSpec.md` §3.3). From `nav` the header drops it; the sidebar's profile row is the
 * same entry there.
 *
 * ORCHESTRATION: it reads the signed-in profile (`useUserProfile`, the same cached query `AppShell` reads) and the
 * router, and hands `@commise/ui/avatar` its state. Data enters the page chrome here, and only here.
 *
 * @pattern Adapter — the profile read and the router, as the design-system Avatar's props
 */
import { profileAvatarPropsOf } from '@commise/features-core/home';
import { homeMessages } from '@commise/features-core/home';
import { useLocale, useMessages } from '@commise/i18n/react';
import { Avatar } from '@commise/ui/avatar';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { JSX } from 'react';

import { useUserProfile } from '@/hooks/useUserProfile';

/** The page header's profile entry. */
export function ProfileAvatarEntry(): JSX.Element {
    const home = useMessages(homeMessages);
    const locale = useLocale();
    const router = useRouter();
    const profile = useUserProfile();
    const href = `/${locale}/profile`;

    return (
        <Avatar
            {...profileAvatarPropsOf(profile, home.chrome)}
            href={href}
            onPress={() => router.push(href as Route)}
        />
    );
}
