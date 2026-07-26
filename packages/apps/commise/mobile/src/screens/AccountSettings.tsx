/**
 * @module screens/AccountSettings — the mobile account-settings surface (security + danger zone).
 *
 * The destructive controls come from the shared {@link AccountDangerZone}, which presents CLOSE (recoverable)
 * and ERASE (irreversible) as two DISTINCT actions — replacing this screen's earlier single "Delete account"
 * button whose copy wrongly claimed the recoverable closure "permanently deletes your account and data" (the
 * exact conflation CR-002 / U4b fixes).
 */
import { useAuth, useUser } from '@clerk/expo';
import type { JSX } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

import { AccountDangerZone } from '../components/account/AccountDangerZone';

export function AccountSettingsScreen(): JSX.Element {
    const { signOut } = useAuth();
    const { user } = useUser();

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
                <AccountDangerZone />
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
