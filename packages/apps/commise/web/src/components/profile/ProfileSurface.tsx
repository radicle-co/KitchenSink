'use client';

/**
 * @module components/profile/ProfileSurface — the one Profile page (web; `docs/design/uiOverhaul/buildSpec.md` §9.1).
 * Profile, Settings and Account used to be three routes; this is all of it: who the cook is, the one thing they can
 * change (the display name), preferences, sign out, and the danger zone.
 *
 * ORCHESTRATION. It owns the profile read (`useUserProfile`, the shell's own cached query), the settings read and write
 * (a preference is a setting on the server, D19 / ADR-0059, saved optimistically and put back with a message when the
 * save fails), the router and the display-name editor, and hands the render leaves from `@commise/features-account/profile` their state. The read
 * decides one of three states — loading, failed, ready — and ONLY the account group depends on it: sign out and the
 * danger zone need no profile, so a failed read never takes them away (E15).
 *
 * The page sits in the design system's `PushedPageFrame`: below 840 Back is pinned in a bar that follows the scroll, and
 * from 840 the header's own eyebrow carries it (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §6). Both are given
 * the one `back` value, so the two links cannot disagree.
 *
 * Sign out is `LogoutButton`, which issues the one verified sign-out command (ADR-0009); close and erase keep their own
 * dialogs and flows. Nothing here calls Clerk's `signOut`.
 *
 * @pattern Composition root over the Profile render leaves — the read, the editor and the router meet here and nowhere
 *     below
 */
import { useUser } from '@clerk/nextjs';
import { profileMutations } from '@commise/features-account';
import { initialsFor } from '@commise/features-core';
import {
    DisplayNameSheet,
    ProfileAccountGroup,
    ProfileGroup,
    ProfileHeader,
    ProfileRow,
    profileMessages,
    useProfileScreen,
} from '@commise/features-account/profile';
import { useLocale, useMessages } from '@commise/i18n/react';
import { LargeTitleHeader, type HeaderBack } from '@commise/ui/large-title-header';
import { PushedPageFrame } from '@commise/ui/pushed-page';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { SETTINGS_DEFAULTS } from '@kitchensink/schema-identity';
import { useId, type FC } from 'react';

import { AccountCloseForm } from '@/components/auth/AccountCloseForm';
import { AccountEraseForm } from '@/components/auth/AccountEraseForm';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { ShortcutSwitchRow } from '@/components/profile/ShortcutSwitchRow';
import { useProfileServiceClient } from '@/hooks/useProfileServiceClient';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useUserSettings } from '@/hooks/useUserSettings';
import { withBasePath } from '@/lib/basePath';

/** The Profile page. */
export const ProfileSurface: FC = () => {
    const t = useMessages(profileMessages);
    const locale = useLocale();
    const router = useRouter();
    const headingId = useId();
    const query = useUserProfile();
    const { user } = useUser();
    // The client mints its token per call (see `useProfileServiceClient`): a session token lives about a minute, so one
    // captured at render would be stale for a cook who typed slowly.
    const client = useProfileServiceClient();
    const update = useMutation(profileMutations(client).update());
    const { read, editor } = useProfileScreen({ query, user, update });
    const settings = useUserSettings();
    const patchSettings = useMutation(profileMutations(client).patchSettings());
    const sourcesPath = `/${locale}/legal/sources`;
    const homePath = `/${locale}`;
    const back: HeaderBack = {
        label: t.backToHome,
        parent: t.homeParent,
        onPress: () => router.push(homePath as Route),
        href: withBasePath(homePath),
    };

    return (
        <PushedPageFrame back={back} headingId={headingId} title={t.title}>
            {() => (
                <div className="mx-auto flex w-full max-w-reading flex-col gap-6 pb-10">
                    <LargeTitleHeader headingId={headingId} title={t.title} back={back} />
                    <ProfileHeader
                        read={read}
                        initials={read.status === 'ready' ? initialsFor(read.displayName) : ''}
                        onRetry={() => void query.refetch()}
                    />
                    {read.status === 'ready' ? (
                        <ProfileAccountGroup displayName={read.displayName} onEditDisplayName={editor.openSheet} />
                    ) : null}
                    <ProfileGroup heading={t.preferences}>
                        <ProfileRow
                            label={t.dataSources}
                            tone="ink"
                            chevron
                            href={withBasePath(sourcesPath)}
                            onPress={() => router.push(sourcesPath as Route)}
                        />
                        <ShortcutSwitchRow
                            checked={settings.data?.searchShortcut ?? SETTINGS_DEFAULTS.searchShortcut}
                            // Not awaited: the cache is already updated and a paused (offline) save resumes by itself.
                            onChange={(searchShortcut) => patchSettings.mutate({ searchShortcut })}
                        />
                    </ProfileGroup>
                    {patchSettings.isError ? (
                        <p role="alert" className="text-meta text-danger-text">
                            {t.settingSaveFailed}
                        </p>
                    ) : null}
                    <ProfileGroup label={t.signOut}>
                        <LogoutButton />
                    </ProfileGroup>
                    <ProfileGroup heading={t.dangerZone}>
                        <AccountCloseForm />
                        <AccountEraseForm />
                    </ProfileGroup>
                    <DisplayNameSheet
                        open={editor.open}
                        onOpenChange={editor.setOpen}
                        draft={editor.draft}
                        onDraftChange={editor.setDraft}
                        canSave={editor.canSave}
                        saving={editor.saving}
                        failed={editor.failed}
                        onSave={editor.save}
                    />
                </div>
            )}
        </PushedPageFrame>
    );
};
