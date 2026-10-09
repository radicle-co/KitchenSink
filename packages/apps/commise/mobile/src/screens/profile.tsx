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
 * THE PHOTO. The spec's 72 pt avatar is "initials, or the native `AvatarField` photo". `ProfileHeader` is shared with
 * web and draws initials only, so the native-only photo control sits as the first row of the Account group instead.
 * A picked photo is an explicit act and is written ALONE (`{ avatarUrl }`) through its own mutation; the display name is
 * written only from the sheet's Save, so the two never share a pending or failed state.
 *
 * @pattern Composition root over the Profile render leaves — the read, the editor and the navigator's back meet here and
 *     nowhere below
 */
import { initialsFor } from '@commise/features-core';
import { DataSourcesScreen } from '@commise/features-recipes/data-sources/mobile';
import {
    DisplayNameSheet,
    ProfileGroup,
    ProfileHeader,
    ProfileRow,
    ProfileValueRow,
    profileMessages,
    profileReadOf,
} from '@commise/features-account/profile';
import { useMessages } from '@commise/i18n/react';
import { CondensedTitleBar, LargeTitleHeader } from '@commise/ui/large-title-header';
import { nativeTokens } from '@commise/ui/native';
import { ScrollHost, useScrollHost, type ScrollBind } from '@commise/ui/scroll-host';
import { useTheme } from '@commise/ui/theme';
import { useId, useState, type JSX } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AccountDangerZone } from '../components/account/AccountDangerZone.js';
import { AvatarField } from '../components/account/AvatarField.js';
import { SignOutButton } from '../components/account/SignOutButton.js';
import { SuspensionBanner } from '../components/SuspensionBanner.js';
import { useDisplayNameEditor } from '../hooks/useDisplayNameEditor.js';
import { useUpdateProfile } from '../hooks/useUpdateProfile.js';
import { useUserProfile } from '../hooks/useUserProfile.js';
import { mobileMessages } from '../i18n/messages.js';

/** Props for {@link ProfileScreen}. */
export interface ProfileScreenProps {
    /** Leave Profile: pop to the screen it was pushed from. */
    readonly onBack: () => void;
}

/** Props for the page inside its scroll host. */
interface ProfileSurfaceProps extends ProfileScreenProps {
    /** The bind for the page's one vertical scroller. */
    readonly scrollBind: ScrollBind;
}

/**
 * The Profile page, inside its own scroll host (it is a pushed screen, not a tab root).
 *
 * @param props - The way back.
 * @returns The page.
 */
export function ProfileScreen({ onBack }: ProfileScreenProps): JSX.Element {
    return <ScrollHost>{(bind) => <ProfileSurface scrollBind={bind} onBack={onBack} />}</ScrollHost>;
}

/** The page. */
function ProfileSurface({ scrollBind, onBack }: ProfileSurfaceProps): JSX.Element {
    const t = useMessages(profileMessages);
    const { profile: photo } = useMessages(mobileMessages);
    const { colors } = useTheme();
    const { condensed } = useScrollHost();
    const headingId = useId();
    const query = useUserProfile();
    const read = profileReadOf(query);
    const saved = read.status === 'ready' ? read.displayName : '';
    const editor = useDisplayNameEditor(saved);
    const photoUpdate = useUpdateProfile();
    const [sourcesOpen, setSourcesOpen] = useState(false);
    // Each close of the sheet advances this, which takes the reading cursor back to the row that opened it (§10).
    const [sourcesClosed, setSourcesClosed] = useState(0);
    const user = query.data?.user;
    const back = { label: t.back, parent: t.homeParent, onPress: onBack };
    // While a new photo is being saved the preview shows it, so the pick does not appear to be lost.
    const photoUrl = photoUpdate.isPending ? (photoUpdate.variables.avatarUrl ?? '') : (user?.avatarUrl ?? '');

    return (
        <View style={styles.screen}>
            <ScrollView
                {...scrollBind}
                style={styles.region}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
            >
                <LargeTitleHeader headingId={headingId} title={t.title} back={back} />
                {user === undefined ? null : <SuspensionBanner status={user.status} />}
                <ProfileHeader
                    read={read}
                    initials={read.status === 'ready' ? initialsFor(read.displayName) : ''}
                    onRetry={() => void query.refetch()}
                />
                {read.status === 'ready' ? (
                    <ProfileGroup label={t.account}>
                        <View>
                            <AvatarField
                                value={photoUrl}
                                onChange={(avatarUrl) => photoUpdate.mutate({ avatarUrl })}
                                messages={{
                                    label: photo.avatarLabel,
                                    imageLabel: photo.avatarImageLabel,
                                    changeAction: photo.avatarChangeAction,
                                    uploadError: photo.avatarUploadError,
                                    tooLargeError: photo.avatarTooLargeError,
                                    unsupportedTypeError: photo.avatarUnsupportedTypeError,
                                }}
                            />
                            {photoUpdate.isError ? (
                                <Text role="alert" style={[styles.photoError, { color: colors.dangerText }]}>
                                    {photo.avatarUploadError}
                                </Text>
                            ) : null}
                        </View>
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
                        focusSignal={sourcesClosed}
                        onPress={() => setSourcesOpen(true)}
                    />
                </ProfileGroup>
                <ProfileGroup label={t.signOut}>
                    <SignOutButton />
                </ProfileGroup>
                <AccountDangerZone />
            </ScrollView>
            <CondensedTitleBar title={t.title} back={back} visible={condensed} />
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
            {sourcesOpen ? (
                <DataSourcesScreen
                    onRequestClose={() => {
                        setSourcesOpen(false);
                        setSourcesClosed((count) => count + 1);
                    }}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    // Transparent so the root `AppCanvas` wash shows through (issue #145).
    screen: { flex: 1, backgroundColor: 'transparent' },
    region: { flex: 1 },
    content: {
        paddingHorizontal: nativeTokens.spacing[4],
        paddingTop: nativeTokens.spacing[2],
        paddingBottom: nativeTokens.spacing[6],
        gap: nativeTokens.spacing[5],
    },
    photoError: {
        ...nativeTokens.type.caption,
        paddingHorizontal: nativeTokens.spacing[4],
        paddingBottom: nativeTokens.spacing[3],
    },
});
