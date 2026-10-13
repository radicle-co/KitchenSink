/**
 * @module components/auth/AuthCodeActions — the two ways out of the email-code step that are not "Verify": ask for a
 * fresh code, or abandon the attempt and start over. Sign-in and sign-up offer the same two, in the same words.
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useMessages } from '@commise/i18n/react';
import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { mobileMessages } from '../../i18n/messages.js';

/** Props for {@link AuthCodeActions}. */
export interface AuthCodeActionsProps {
    /** Locks both controls while a request is in flight. */
    readonly busy: boolean;
    /** Sends a fresh code. */
    readonly onResend: () => void;
    /** Abandons the attempt and returns to the first step. */
    readonly onStartOver: () => void;
}

/**
 * @param props - The busy state and the two handlers.
 * @returns A secondary "send a new code" button and a ghost "start over" button.
 */
export function AuthCodeActions({ busy, onResend, onStartOver }: AuthCodeActionsProps): JSX.Element {
    const { auth: t } = useMessages(mobileMessages);

    return (
        <View style={styles.actions}>
            <Button variant="secondary" icon="refreshCw" disabled={busy} onPress={onResend}>
                {t.resendCodeAction}
            </Button>
            <Button variant="ghost" icon="rotateCcw" disabled={busy} onPress={onStartOver}>
                {t.startOverAction}
            </Button>
        </View>
    );
}

const styles = StyleSheet.create({
    actions: { alignItems: 'flex-start', gap: nativeTokens.spacing[2] },
});
