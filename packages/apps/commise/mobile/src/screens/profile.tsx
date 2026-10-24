/**
 * @module screens/profile — the one Profile page (native; `docs/design/uiOverhaul/buildSpec.md` §9.1), pushed from the
 * avatar. It replaces the old profile form AND the `AccountSettings` hub: who the cook is, the one thing they can
 * change (the display name), preferences, sign out, and the danger zone.
 *
 * ORCHESTRATION. It owns the profile read (`useUserProfile`, the shell's own cached query), the display-name editor and
 * the photo write, and hands the render leaves from `@commise/features-account/profile` their state. The read decides
 * one of three states — loading, failed, ready — and ONLY the Account group depends on it: sign out and the danger zone
 * need no profile, so a failed read never takes them away (E15). That is why this is a plain query and not a suspense
 * read under a boundary: a boundary would replace the whole page with its error.
 *
 * Sign out is `SignOutButton`, which issues the one verified sign-out command (ADR-0009); close and erase are
 * `AccountDangerZone`, which keeps its own dialogs and flows. Nothing here calls Clerk's `signOut`.
 *
 * THE PHOTO. The spec's 72 pt avatar is "initials, or the native `AvatarField` photo". The native `ProfileHeader` takes
 * the photo control as its `avatar` slot, so the page has ONE avatar (the initials are the control's own fallback).
 * A picked photo is an explicit act and is written ALONE (`{ avatarKey }`) through its own mutation; the display name is
 * written only from the sheet's Save, so the two never share a pending or failed state. A failed pick or a failed save
 * of the photo shows one alert under the header.
 *
 * @pattern Composition root over the Profile render leaves — the read, the editor and the navigator's back meet here and
 *     nowhere below
 */
import { useUser } from '@clerk/expo';
import { initialsFor } from '@commise/features-core';
import {
    DisplayNameSheet,
    ProfileAccountGroup,
    ProfileGroup,
    ProfileHeader,
    ProfileRow,
    avatarCopyOf,
    profileMessages,
    useProfileScreen,
} from '@commise/features-account/profile';
import { useMessages } from '@commise/i18n/react';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { nativeTokens } from '@commise/ui/native';
import { PushedPageFrame, type PushedPageInset } from '@commise/ui/pushed-page';
import type { ScrollBind } from '@commise/ui/scroll-host';
import { useTheme } from '@commise/ui/theme';
import { useId, useState, type JSX } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AccountDangerZone } from '../components/account/AccountDangerZone.js';
import { AvatarField } from '../components/account/AvatarField.js';
import { SignOutButton } from '../components/account/SignOutButton.js';
import { SuspensionBanner } from '../components/SuspensionBanner.js';
import { useUpdateProfile } from '../hooks/useUpdateProfile.js';
import { useUserProfile } from '../hooks/useUserProfile.js';

/** Props for {@link ProfileScreen}. */
export interface ProfileScreenProps {
    /** Leave Profile: pop to the screen it was pushed from. */
    readonly onBack: () => void;
    /** Open Food data sources: the navigator pushes it as a page, so this screen mounts nothing for it (A-026). */
    readonly onOpenDataSources: () => void;
}

/** Props for the page inside the frame. */
interface ProfileSurfaceProps {
    /** The bind for the page's one vertical scroller. */
    readonly scrollBind: ScrollBind;
    /** The room the frame leaves under the pinned bar. */
    readonly inset: PushedPageInset;
    /** The H1's id, which the frame's bar watches. */
    readonly headingId: string;
    /** Open Food data sources. */
    readonly onOpenDataSources: () => void;
}

/**
 * The Profile page, inside the shared pushed-page frame (it is a pushed screen, not a tab root): the frame owns the one
 * scroll host and pins Back in the bar, so Back is reachable at every scroll position.
 *
 * @param props - The way back, and the way to Data sources.
 * @returns The page.
 */
export function ProfileScreen({ onBack, onOpenDataSources }: ProfileScreenProps): JSX.Element {
    const t = useMessages(profileMessages);
    const headingId = useId();
    const back = { label: t.back, parent: t.homeParent, onPress: onBack };

    return (
        <PushedPageFrame back={back} headingId={headingId} title={t.title}>
            {(bind, inset) => (
                <ProfileSurface
                    scrollBind={bind}
                    inset={inset}
                    headingId={headingId}
                    onOpenDataSources={onOpenDataSources}
                />
            )}
        </PushedPageFrame>
    );
}

/** The page. */
function ProfileSurface({ scrollBind, inset, headingId, onOpenDataSources }: ProfileSurfaceProps): JSX.Element {
    const t = useMessages(profileMessages);
    const { colors } = useTheme();
    const query = useUserProfile();
    const { user: clerkUser } = useUser();
    // The name and the photo are two mutations, so a photo upload never reads as the name saving, and back.
    const nameUpdate = useUpdateProfile();
    const { read, editor } = useProfileScreen({ query, user: clerkUser, update: nameUpdate });
    const photoUpdate = useUpdateProfile();
    // A pick that failed on the device (type, size, upload) is reported by the control; a failed save by the mutation.
    const [pickError, setPickError] = useState<string | undefined>(undefined);
    // The LOCAL file just picked: the server composes the avatar URL from the saved key, so this is what can be shown
    // while the write is in flight.
    const [pickedPreview, setPickedPreview] = useState('');
    const user = query.data?.user;
    // While a new photo is being saved the preview shows it, so the pick does not appear to be lost.
    const photoUrl = photoUpdate.isPending ? pickedPreview : (user?.avatarUrl ?? '');
    const photoError = pickError ?? (photoUpdate.isError ? t.avatarUploadError : undefined);
    const initials = read.status === 'ready' ? initialsFor(read.displayName) : '';

    return (
        <View style={styles.screen}>
            <ScrollView
                {...scrollBind}
                style={styles.region}
                contentContainerStyle={[styles.content, inset]}
                keyboardShouldPersistTaps="handled"
            >
                <LargeTitleHeader headingId={headingId} title={t.title} />
                {user === undefined ? null : <SuspensionBanner status={user.status} />}
                <ProfileHeader
                    read={read}
                    initials={initials}
                    onRetry={() => void query.refetch()}
                    avatar={
                        <AvatarField
                            value={photoUrl}
                            initials={initials}
                            onChange={({ key, previewUri }) => {
                                setPickedPreview(previewUri);
                                photoUpdate.mutate({ avatarKey: key });
                            }}
                            onError={setPickError}
                            messages={avatarCopyOf(t)}
                        />
                    }
                />
                {photoError === undefined ? null : (
                    <Text role="alert" style={[styles.photoError, { color: colors.dangerText }]}>
                        {photoError}
                    </Text>
                )}
                {read.status === 'ready' ? (
                    <ProfileAccountGroup displayName={read.displayName} onEditDisplayName={editor.openSheet} />
                ) : null}
                <ProfileGroup heading={t.preferences}>
                    <ProfileRow label={t.dataSources} tone="ink" chevron onPress={onOpenDataSources} />
                </ProfileGroup>
                <ProfileGroup label={t.signOut}>
                    <SignOutButton />
                </ProfileGroup>
                <AccountDangerZone />
            </ScrollView>
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
        </View>
    );
}

const styles = StyleSheet.create({
    // Transparent so the root `AppCanvas` wash shows through (issue #145).
    screen: { flex: 1, backgroundColor: 'transparent' },
    region: { flex: 1 },
    content: {
        paddingHorizontal: nativeTokens.spacing[4],
        paddingBottom: nativeTokens.spacing[6],
        gap: nativeTokens.spacing[5],
    },
    photoError: { ...nativeTokens.type.caption },
});
