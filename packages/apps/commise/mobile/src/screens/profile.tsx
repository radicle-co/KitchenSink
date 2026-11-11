/**
 * @module screens/profile — the one Profile page (native; `docs/design/uiOverhaul/buildSpec.md` §9.1), the root of the
 * You tab's own `profile` stack (owner ruling 2026-11-11, N3), so it has no back control. It replaces the old profile form AND the `AccountSettings` hub: who the cook is, the one thing they can
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
 * @pattern Composition root over the Profile render leaves — the read and the editor meet here and nowhere below
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
import { foodPageMessages } from '@commise/features-recipes/food-page';
import { YourFoodsRow } from '@commise/features-recipes/food-page/mobile';
import { useMessages } from '@commise/i18n/react';
import { useOwnFoods } from '@kitchensink/food-service-client/hooks';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { nativeTokens } from '@commise/ui/native';
import type { ScrollBind } from '@commise/ui/scroll-host';
import { Text } from '@commise/ui/text';
import { useId, useState, type JSX } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AccountDangerZone } from '../components/account/AccountDangerZone.js';
import { AvatarField } from '../components/account/AvatarField.js';
import { SignOutButton } from '../components/account/SignOutButton.js';
import { SuspensionBanner } from '../components/SuspensionBanner.js';
import { useUpdateProfile } from '../hooks/useUpdateProfile.js';
import { useUserProfile } from '../hooks/useUserProfile.js';
import { useScreenTrace } from '../screenTrace/useScreenTrace.js';

/** Props for {@link ProfileScreen}. */
export interface ProfileScreenProps {
    /** The bind for the page's one vertical scroller, from the tab root's `ScrollHost`. */
    readonly scrollBind: ScrollBind;
    /** Open Food data sources: the navigator pushes it as a page, so this screen mounts nothing for it (A-026). */
    readonly onOpenDataSources: () => void;
    readonly onOpenYourFoods: () => void;
}

/**
 * The Profile page, the You tab's root: it draws inside the tab root's own scroll host (so a second tap on You scrolls it
 * to the top) and has no Back.
 *
 * @param props - The scroller's bind and the ways to Data sources and Your foods.
 * @returns The page.
 */
export function ProfileScreen({ scrollBind, onOpenDataSources, onOpenYourFoods }: ProfileScreenProps): JSX.Element {
    useScreenTrace('profile');
    const t = useMessages(profileMessages);
    const headingId = useId();
    const foodsT = useMessages(foodPageMessages);
    const ownFoods = useOwnFoods();
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
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
            >
                <LargeTitleHeader headingId={headingId} title={t.title} />
                <View style={styles.body}>
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
                        <Text role="alert" typeRole="caption" color="$dangerText">
                            {photoError}
                        </Text>
                    )}
                    {read.status === 'ready' ? (
                        <ProfileAccountGroup
                            displayName={read.displayName}
                            username={read.username}
                            email={read.email}
                            onEditDisplayName={editor.openSheet}
                        />
                    ) : null}
                    <ProfileGroup heading={t.preferences}>
                        <ProfileRow label={t.dataSources} tone="ink" chevron onPress={onOpenDataSources} />
                    </ProfileGroup>
                    <ProfileGroup label={foodsT.yourFoods.title}>
                        <YourFoodsRow
                            unseenDecisions={ownFoods.data?.pages[0]?.unseenDecisions ?? 0}
                            onPress={onOpenYourFoods}
                        />
                    </ProfileGroup>
                    <ProfileGroup label={t.signOut}>
                        <SignOutButton />
                    </ProfileGroup>
                    <AccountDangerZone />
                </View>
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
        paddingBottom: nativeTokens.spacing[6],
        gap: nativeTokens.spacing[5],
    },
    // Everything under the title: the title insets its own sides, so the rest pads itself.
    body: { paddingHorizontal: nativeTokens.spacing[4], gap: nativeTokens.spacing[5] },
});
