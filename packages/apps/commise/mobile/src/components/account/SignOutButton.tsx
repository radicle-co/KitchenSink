/**
 * @module components/account/SignOutButton — the mobile sign-out control (the counterpart of the web
 * `LogoutButton`).
 *
 * The orchestration half of the sign-out surface: it owns only the control's own state (busy, failed) and
 * issues the app's one sign-out command,
 * {@link import('../../hooks/useSignOutAndVerify.js').useSignOutAndVerify} — which owns the mechanism
 * (Clerk's load-safe `signOut`), the ordering, and the post-condition that the session really ended. Read
 * that module, and ADR-0009, before changing anything here.
 *
 * B17 — a sign-out that fails, OR that resolves without actually ending the session, is surfaced and never
 * swallowed: the busy state is released and a localized alert appears, so the control is retryable instead of
 * leaving the viewer silently signed in with no feedback. The previous shape was `onPress={() => void
 * signOut()}` — nothing awaited, nothing reported.
 *
 * It exists as its own component because TWO surfaces need exactly this behaviour: the account hub's session
 * section, and the danger zone's recovery after an erasure that was ACCEPTED but whose sign-out failed.
 */
import { Button } from '@commise/ui/button';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { useMessages } from '@commise/i18n/react';
import { Feather } from '@expo/vector-icons';
import type { JSX } from 'react';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useSignOutAndVerify } from '../../hooks/useSignOutAndVerify.js';
import { mobileMessages } from '../../i18n/messages.js';

/** Trigger glyph size — the DS Button pairs every label with an icon. */
const ICON_SIZE = 16;

/** The mobile sign-out control: issues the sign-out command and surfaces its failure. */
export function SignOutButton(): JSX.Element {
    const { account: t } = useMessages(mobileMessages);
    const { signOutAndVerify } = useSignOutAndVerify();
    const [signingOut, setSigningOut] = useState(false);
    const [failed, setFailed] = useState(false);

    /**
     * Issue the sign-out command, surfacing a rejection instead of leaving the viewer silently signed in.
     *
     * @sideEffect Destroys the Clerk session (the auth gate then re-renders the unauthenticated tree).
     */
    const handleSignOut = async (): Promise<void> => {
        setSigningOut(true);
        setFailed(false);

        try {
            await signOutAndVerify();
        } catch {
            // Generic on purpose — never echoes the raw error to the viewer (B17).
            setFailed(true);
            setSigningOut(false);
        }
    };

    return (
        <View style={styles.container}>
            {/* The busy state is deliberately NOT released on success: the session is gone, so the auth gate
                replaces this tree — clearing it first would flash an idle control. */}
            <Button
                variant="secondary"
                icon={<Feather name="log-out" size={ICON_SIZE} color={palette.charcoal} />}
                busy={signingOut}
                onPress={() => void handleSignOut()}
            >
                {signingOut ? t.signingOut : t.signOutAction}
            </Button>
            {failed ? (
                <Text role="alert" style={styles.error}>
                    {t.signOutFailed}
                </Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { gap: nativeTokens.spacing[2] },
    error: { fontSize: nativeTokens.fontSize.bodySm, color: palette.error },
});
