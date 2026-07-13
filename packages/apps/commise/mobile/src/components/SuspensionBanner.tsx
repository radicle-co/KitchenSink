import { useMessages } from '@commise/i18n/react';
import { View, Text, StyleSheet } from 'react-native';
import type { UserStatus } from '@kitchensink/identity-service';

import { mobileMessages } from '../i18n/messages';

interface SuspensionBannerProps {
    status: UserStatus;
}

export function SuspensionBanner({ status }: SuspensionBannerProps) {
    const { suspension } = useMessages(mobileMessages);

    if (status !== 'suspended') {
        return null;
    }

    return (
        <View style={styles.container} accessibilityRole="alert">
            <Text style={styles.title}>{suspension.title}</Text>
            <Text style={styles.message}>{suspension.message}</Text>
        </View>
    );
}

interface ImpersonationWarningProps {
    sessionId?: string;
}

export function ImpersonationWarning({ sessionId }: ImpersonationWarningProps) {
    return (
        <View style={styles.warningContainer} accessibilityRole="alert">
            <Text style={styles.warningTitle}>Impersonation blocked on mobile</Text>
            <Text style={styles.warningMessage}>
                For account safety, administrator impersonation is not available in the mobile app.
                {sessionId ? ` Session: ${sessionId}` : ''}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#ffebee',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#ffcdd2',
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        color: '#c62828',
        marginBottom: 8,
    },
    message: {
        fontSize: 14,
        color: '#c62828',
        lineHeight: 20,
    },
    warningContainer: {
        backgroundColor: '#fff3e0',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#ffe0b2',
    },
    warningTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#e65100',
        marginBottom: 8,
    },
    warningMessage: {
        fontSize: 14,
        color: '#e65100',
        lineHeight: 20,
    },
});
