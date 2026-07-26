import { useMessages } from '@commise/i18n/react';
import type { JSX } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { useUserProfile, useUpdateProfile } from '../hooks/useUserProfile';
import { SuspensionBanner } from '../components/SuspensionBanner';
import { AccountDangerZone } from '../components/account/AccountDangerZone';
import { mobileMessages } from '../i18n/messages';

/** The loaded profile query data (non-undefined). */
type ProfileData = NonNullable<ReturnType<typeof useUserProfile>['data']>;

export function ProfileScreen(): JSX.Element {
    const { profile: t } = useMessages(mobileMessages);
    const { data, isLoading, error } = useUserProfile();

    if (isLoading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator />
            </View>
        );
    }

    if (error || !data) {
        return (
            <View style={styles.center}>
                <Text>{t.loadError}</Text>
            </View>
        );
    }

    // B1 — seed the edit form ONCE from the cache via the `useState` initializer (no clobber `useEffect`).
    // `key={data.user.id}` remounts the form only when the profile IDENTITY changes, so a background refetch
    // or a post-save invalidation of the SAME profile never overwrites unsaved edits.
    return <ProfileEditForm key={data.user.id} profile={data} />;
}

/** The controlled edit form, seeded once from the cached profile on mount. */
function ProfileEditForm({ profile }: { readonly profile: ProfileData }): JSX.Element {
    const { profile: t } = useMessages(mobileMessages);
    const updateProfile = useUpdateProfile();
    const [displayName, setDisplayName] = useState(profile.user.displayName ?? '');
    const [avatarUrl, setAvatarUrl] = useState(profile.user.avatarUrl ?? '');

    return (
        <View style={styles.container}>
            <SuspensionBanner status={profile.user.status} />
            <Text style={styles.label}>{t.displayName}</Text>
            <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} />
            <Text style={styles.label}>{t.avatarUrl}</Text>
            <TextInput style={styles.input} value={avatarUrl} onChangeText={setAvatarUrl} autoCapitalize="none" />
            <Button
                title={updateProfile.isPending ? t.saving : t.save}
                disabled={updateProfile.isPending}
                onPress={() => updateProfile.mutate({ displayName, avatarUrl })}
            />
            <AccountDangerZone />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, padding: 24 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    label: { fontSize: 14, fontWeight: '600', marginTop: 12, marginBottom: 4 },
    input: {
        borderWidth: 1,
        borderColor: '#ccc',
        borderRadius: 8,
        padding: 12,
    },
});
