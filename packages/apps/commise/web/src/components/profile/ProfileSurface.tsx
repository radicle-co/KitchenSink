'use client';

/**
 * @module components/profile/ProfileSurface — the one Profile page (web; `docs/design/uiOverhaul/buildSpec.md` §9.1).
 * Profile, Settings and Account used to be three routes; this is all of it: who the cook is, the one thing they can
 * change (the display name), preferences, sign out, and the danger zone.
 *
 * ORCHESTRATION. It owns the profile read (`useUserProfile`, the shell's own cached query), the router and the
 * display-name editor, and hands the render leaves from `@commise/features-account/profile` their state. The read
 * decides one of three states — loading, failed, ready — and ONLY the account group depends on it: sign out and the
 * danger zone need no profile, so a failed read never takes them away (E15).
 *
 * Sign out is `LogoutButton`, which issues the one verified sign-out command (ADR-0009); close and erase keep their own
 * dialogs and flows. Nothing here calls Clerk's `signOut`.
 *
 * @pattern Composition root over the Profile render leaves — the read, the editor and the router meet here and nowhere
 *     below
 */
import { initialsFor } from '@commise/features-core';
import {
    DisplayNameSheet,
    ProfileGroup,
    ProfileHeader,
    ProfileRow,
    ProfileValueRow,
    profileMessages,
    profileReadOf,
} from '@commise/features-account/profile';
import { useLocale, useMessages } from '@commise/i18n/react';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useId, type FC } from 'react';

import { AccountCloseForm } from '@/components/auth/AccountCloseForm';
import { AccountEraseForm } from '@/components/auth/AccountEraseForm';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { ShortcutSwitchRow } from '@/components/profile/ShortcutSwitchRow';
import { useDisplayNameEditor } from '@/components/profile/useDisplayNameEditor';
import { useUserProfile } from '@/hooks/useUserProfile';
import { withBasePath } from '@/lib/basePath';

/** The Profile page. */
export const ProfileSurface: FC = () => {
    const t = useMessages(profileMessages);
    const locale = useLocale();
    const router = useRouter();
    const headingId = useId();
    const query = useUserProfile();
    const read = profileReadOf(query);
    const saved = read.status === 'ready' ? read.displayName : '';
    const editor = useDisplayNameEditor(saved);
    const sourcesPath = `/${locale}/legal/sources`;
    const homePath = `/${locale}`;

    return (
        <div className="mx-auto flex w-full max-w-reading flex-col gap-6 pb-10">
            <LargeTitleHeader
                headingId={headingId}
                title={t.title}
                back={{
                    label: t.backToHome,
                    parent: t.homeParent,
                    onPress: () => router.push(homePath as Route),
                    href: withBasePath(homePath),
                }}
            />
            <ProfileHeader
                read={read}
                initials={read.status === 'ready' ? initialsFor(read.displayName) : ''}
                onRetry={() => void query.refetch()}
            />
            {read.status === 'ready' ? (
                <ProfileGroup label={t.account}>
                    <ProfileRow
                        label={t.displayName}
                        value={read.displayName === '' ? t.displayNameUnset : read.displayName}
                        tone="ink"
                        chevron
                        onPress={editor.openSheet}
                    />
                    <ProfileValueRow label={t.email} value={read.email} />
                </ProfileGroup>
            ) : null}
            <ProfileGroup heading={t.preferences}>
                <ProfileRow
                    label={t.dataSources}
                    tone="ink"
                    chevron
                    href={withBasePath(sourcesPath)}
                    onPress={() => router.push(sourcesPath as Route)}
                />
                <ShortcutSwitchRow />
            </ProfileGroup>
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
    );
};
