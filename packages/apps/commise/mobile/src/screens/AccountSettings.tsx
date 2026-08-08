/**
 * @module screens/AccountSettings — the mobile account hub (security + sign-out + danger zone), U2 rebuild.
 *
 * Reachable from the profile surface's "Account settings" action ({@link import('./AppRoot.js').AppRoot}
 * wires it as a top-level destination). It is the single home for account-level actions: the signed-in
 * identity, the IdP-hosted security note, SIGN OUT, and the shared {@link AccountDangerZone} — which presents
 * CLOSE (recoverable) and ERASE (irreversible) as two DISTINCT actions through the design-system
 * `ConfirmDialog` (CR-002 / U4b), never the earlier conflated single "delete" button.
 *
 * On the design system now: the sign-out/back controls are `@commise/ui` {@link Button}s, all copy comes
 * from `mobileMessages`, and the surface is wrapped in a `SafeAreaView`.
 *
 * SIGN OUT is the shared {@link SignOutButton}, which issues the app's one sign-out COMMAND and owns that
 * control's own busy/failed state. This screen used to inline `onPress={() => void signOut()}` —
 * fire-and-forget, nothing awaited, no failure path: a sign-out that failed left the viewer silently signed in,
 * told nothing, with no way to retry (ADR-0009 / B17).
 */
import { useUser } from '@clerk/expo';
import { Button } from '@commise/ui/button';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { useMessages } from '@commise/i18n/react';
import { Feather } from '@expo/vector-icons';
import type { JSX } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountDangerZone } from '../components/account/AccountDangerZone.js';
import { SignOutButton } from '../components/account/SignOutButton.js';
import { mobileMessages } from '../i18n/messages.js';

/** Props for {@link AccountSettingsScreen}. */
export interface AccountSettingsScreenProps {
    /** When provided, renders a back affordance returning to the profile surface. */
    readonly onBack?: () => void;
}

export function AccountSettingsScreen({ onBack }: AccountSettingsScreenProps = {}): JSX.Element {
    const { account: t } = useMessages(mobileMessages);
    const { user } = useUser();

    return (
        <SafeAreaView style={styles.safe}>
            <ScrollView contentContainerStyle={styles.container}>
                {onBack ? (
                    <View style={styles.backRow}>
                        <Button
                            variant="secondary"
                            icon={<Feather name="arrow-left" size={16} color={palette.charcoal} />}
                            onPress={onBack}
                        >
                            {t.backAction}
                        </Button>
                    </View>
                ) : null}

                <Text style={styles.heading}>{t.heading}</Text>
                <Text style={styles.body}>{user?.primaryEmailAddress?.emailAddress ?? t.signedInFallback}</Text>

                <View style={styles.section}>
                    <Text style={styles.sectionHeading}>{t.securityHeading}</Text>
                    <Text style={styles.body}>{t.securityBody}</Text>
                </View>

                <View style={styles.section}>
                    <SignOutButton />
                </View>

                <View style={styles.section}>
                    <AccountDangerZone />
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    // Transparent so the root `AppCanvas` beach-glow gradient shows through (issue #145). An opaque
    // fill here occludes the whole canvas and restores the flat page the wireframes never had.
    safe: { flex: 1, backgroundColor: 'transparent' },
    container: {
        flexGrow: 1,
        gap: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[5],
        paddingVertical: nativeTokens.spacing[6],
    },
    backRow: { alignItems: 'flex-start' },
    heading: {
        fontSize: nativeTokens.fontSize.displayMd,
        fontWeight: '700',
        color: palette.charcoal,
    },
    sectionHeading: {
        fontSize: nativeTokens.fontSize.headingMd,
        fontWeight: '600',
        color: palette.charcoal,
        marginBottom: nativeTokens.spacing[1],
    },
    body: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
    section: { marginTop: nativeTokens.spacing[4] },
});
