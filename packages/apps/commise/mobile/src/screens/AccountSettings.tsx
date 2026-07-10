import { useAuth, useUser } from '@clerk/expo';
import type { JSX } from 'react';
import { Alert, Button, StyleSheet, Text, View } from 'react-native';
import { useDeleteAccount } from '../hooks/useUserProfile';

export function AccountSettingsScreen(): JSX.Element {
    const { signOut } = useAuth();
    const { user } = useUser();
    const deleteAccount = useDeleteAccount();

    function confirmDelete() {
        Alert.alert('Delete account', 'This permanently deletes your account and data.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: () => deleteAccount.mutate(),
            },
        ]);
    }

    return (
        <View style={styles.container}>
            <Text style={styles.heading}>Account</Text>
            <Text style={styles.body}>{user?.primaryEmailAddress?.emailAddress ?? 'Signed in'}</Text>

            <View style={styles.section}>
                <Text style={styles.heading}>Security</Text>
                <Text style={styles.body}>
                    Manage your password, MFA, and linked social accounts from the IdP-hosted user profile.
                </Text>
            </View>

            <View style={styles.section}>
                <Button title="Sign out" onPress={() => signOut()} />
            </View>
            <View style={styles.section}>
                <Button
                    title={deleteAccount.isPending ? 'Deleting…' : 'Delete account'}
                    color="#c00"
                    disabled={deleteAccount.isPending}
                    onPress={confirmDelete}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, padding: 24 },
    heading: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
    body: { fontSize: 14, color: '#555', marginBottom: 8 },
    section: { marginTop: 24 },
});
