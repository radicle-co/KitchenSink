/**
 * @module screens/profile — the mobile profile-editing surface (U2 rebuild).
 *
 * The profile half of the account/profile surface: edit the display name and the avatar. On the design
 * system now — a tokenized {@link Input} (label associated) for the name, the {@link AvatarField} device
 * image-picker (replacing the old paste-a-URL text box), and a `@commise/ui` {@link Button} with a real
 * `busy` state for Save — all copy from `mobileMessages`, wrapped in a `SafeAreaView` + `KeyboardAvoidingView`
 * so the keyboard never occludes the field. The account-level controls (security, sign out, close/erase)
 * live in the reachable `AccountSettingsScreen` hub, entered via the
 * "Account settings" action here (`onOpenAccountSettings`), so destructive actions have a single home.
 */
import { Button } from '@commise/ui/button';
import { Input } from '@commise/ui/input';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { useMessages } from '@commise/i18n/react';
import { Feather } from '@expo/vector-icons';
import type { FC, JSX } from 'react';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QueryBoundary } from '@commise/query/boundary';

import { AvatarField } from '../components/account/AvatarField.js';
import { LoadingState } from '../components/LoadingState.js';
import { SuspensionBanner } from '../components/SuspensionBanner.js';
import { useUpdateProfile } from '../hooks/useUpdateProfile.js';
import { useSuspenseUserProfile } from '../hooks/useSuspenseUserProfile.js';
import { mobileMessages } from '../i18n/messages.js';

/**
 * The loaded profile.
 *
 * ⚠️ Derived from the SUSPENSE hook, whose `data` is already non-undefined by construction — so there is no
 * `NonNullable` here, and its absence is the point: the old alias wrapped `useUserProfile`'s optional data,
 * which is exactly the "might not be there" the boundary now removes.
 */
type ProfileData = ReturnType<typeof useSuspenseUserProfile>['data'];

/** Props for {@link ProfileScreen}. */
export interface ProfileScreenProps {
    /** When provided, renders the entry into the account hub (security + sign-out + danger zone). */
    readonly onOpenAccountSettings?: () => void;
}

/**
 * The settled profile leaf — a suspense read and nothing else.
 *
 * Per §11.0 it takes no `status` and no `onRetry`: Suspense owns pending and the boundary owns failed, so by
 * the time this renders there is a profile. Split out of {@link ProfileScreen} so the boundary has a child to
 * suspend; the two cannot be one component, because a component cannot suspend inside its own boundary.
 */
const SettledProfile: FC<ProfileScreenProps> = ({ onOpenAccountSettings }) => {
    const { data } = useSuspenseUserProfile();

    // B1 — seed the edit form ONCE from the cache via the `useState` initializer (no clobber `useEffect`).
    // `key={data.user.id}` remounts the form only when the profile IDENTITY changes, so a background refetch
    // or a post-save invalidation of the SAME profile never overwrites unsaved edits.
    return <ProfileEditForm key={data.user.id} profile={data} onOpenAccountSettings={onOpenAccountSettings} />;
};

export function ProfileScreen({ onOpenAccountSettings }: ProfileScreenProps = {}): JSX.Element {
    const { profile: t } = useMessages(mobileMessages);

    // ⛔ A SUSPENSE READ UNDER `QueryBoundary` (§11.0), converted from the last `toDetailQueryView` consumer in
    // the tree. The hand-rolled `status` ladder this replaces was the only remaining place where a read's
    // pending and failed states were owned by the surface rather than by the boundary — so this screen was the
    // reason the repo still had two read patterns, and `queryStatus.ts` died with it.
    //
    // ⚠️ SAFE ONLY BECAUSE THE SIGNED-IN GATE IS STRUCTURAL. A suspense read cannot be disabled, and the
    // `useQuery` this replaces carried `enabled: Boolean(isSignedIn)`. `AuthGate` returns its children ONLY in
    // the `authenticated` case (`components/AuthGate.tsx`) and `AppRoot` — which renders this screen — is
    // inside it, so the gate that mattered was never the `enabled` flag. Were that to change, this read would
    // suspend forever on a signed-out viewer rather than sitting idle.
    //
    // A failed background refetch stays silent, as before: the form is seeded once, so a retry would change
    // nothing on screen. Only a profile that NEVER loaded reaches `renderError`.
    // ⚠️ THE SAFE AREA WRAPS THE TWO FALLBACK NODES, NOT THE BOUNDARY. `ProfileEditForm` brings its own
    // `SafeAreaView`, so wrapping the boundary nests two of them around the settled case — which a test
    // caught as "found multiple elements with the text of: safe-area-root". The pre-conversion code had the
    // same shape for the same reason; this preserves it rather than rediscovering it.
    return (
        <QueryBoundary
            loading={
                <SafeAreaView style={styles.safe}>
                    <LoadingState label={t.loading} />
                </SafeAreaView>
            }
            renderError={() => (
                <SafeAreaView style={styles.safe}>
                    <View style={styles.center}>
                        <Text style={styles.errorText}>{t.loadError}</Text>
                    </View>
                </SafeAreaView>
            )}
        >
            <SettledProfile {...(onOpenAccountSettings === undefined ? {} : { onOpenAccountSettings })} />
        </QueryBoundary>
    );
}

/** The controlled edit form, seeded once from the cached profile on mount. */
function ProfileEditForm({
    profile,
    onOpenAccountSettings,
}: {
    readonly profile: ProfileData;
    readonly onOpenAccountSettings?: () => void;
}): JSX.Element {
    const { profile: t, account } = useMessages(mobileMessages);
    const updateProfile = useUpdateProfile();
    const [displayName, setDisplayName] = useState(profile.user.displayName ?? '');
    const [avatarUrl, setAvatarUrl] = useState(profile.user.avatarUrl ?? '');

    return (
        <SafeAreaView style={styles.safe}>
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
                    <SuspensionBanner status={profile.user.status} />

                    <Input
                        label={t.displayName}
                        placeholder={t.displayNamePlaceholder}
                        value={displayName}
                        onChangeText={setDisplayName}
                        autoCapitalize="words"
                        autoComplete="name"
                        textContentType="name"
                        returnKeyType="done"
                    />

                    <AvatarField
                        value={avatarUrl}
                        onChange={setAvatarUrl}
                        messages={{
                            label: t.avatarLabel,
                            imageLabel: t.avatarImageLabel,
                            changeAction: t.avatarChangeAction,
                            uploadError: t.avatarUploadError,
                            tooLargeError: t.avatarTooLargeError,
                            unsupportedTypeError: t.avatarUnsupportedTypeError,
                        }}
                    />

                    <Button
                        icon={<Feather name="check" size={16} color={palette.white} />}
                        busy={updateProfile.isPending}
                        // Pin the accessible name so it stays stable while the visible label reads "Saving…"
                        // (busy is announced via `aria-busy`); keeps name-based selection stable.
                        accessibilityLabel={t.save}
                        onPress={() => updateProfile.mutate({ displayName, avatarUrl })}
                    >
                        {updateProfile.isPending ? t.saving : t.save}
                    </Button>

                    {onOpenAccountSettings ? (
                        <Button
                            variant="secondary"
                            icon={<Feather name="settings" size={16} color={palette.charcoal} />}
                            onPress={onOpenAccountSettings}
                        >
                            {account.settingsAction}
                        </Button>
                    ) : null}
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    // Transparent so the root `AppCanvas` beach-glow gradient shows through (issue #145). An opaque
    // fill here occludes the whole canvas and restores the flat page the wireframes never had.
    safe: { flex: 1, backgroundColor: 'transparent' },
    flex: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    container: {
        flexGrow: 1,
        gap: nativeTokens.spacing[4],
        paddingHorizontal: nativeTokens.spacing[5],
        paddingVertical: nativeTokens.spacing[6],
    },
    errorText: { fontSize: nativeTokens.fontSize.bodyMd, color: palette.slate },
});
