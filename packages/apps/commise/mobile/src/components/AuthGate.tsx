/**
 * @module components/AuthGate — the app-wide authentication gate (the root's render map).
 *
 * Selects the surface for the CURRENT {@link AuthState} derived by `@commise/features-account` (the same
 * derivation web uses, so the two platforms cannot disagree on which sessions are blocked): a named loading
 * affordance while the session resolves, the branded welcome → sign-up/sign-in flow when signed out, a
 * localized notice for a blocked or failed session, and the app itself once authenticated.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { JSX, ReactNode } from 'react';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../hooks/useAuth';
import { mobileMessages } from '../i18n/messages';
import { LoginScreen } from '../screens/login';
import { SignUpScreen } from '../screens/signup';
import { WelcomeScreen } from '../screens/welcome';
import { LoadingState } from './LoadingState';

/** Props for {@link AuthGate}. */
interface AuthGateProps {
    /** The authenticated app, rendered only once the session resolves to an unblocked signed-in user. */
    readonly children: ReactNode;
}

// U8: the signed-out flow opens on the branded WELCOME hero, which then leads into the sign-up ("Get
// started") or sign-in form; login/signup still toggle between each other.
type Screen = 'welcome' | 'login' | 'signup';

/**
 * The authentication gate.
 *
 * @param props - The authenticated app to render behind the gate.
 * @returns The surface matching the current auth state.
 */
export function AuthGate({ children }: AuthGateProps): JSX.Element {
    const { auth, common } = useMessages(mobileMessages);
    const { state } = useAuth();
    const [screen, setScreen] = useState<Screen>('welcome');

    switch (state.status) {
        case 'loading':
            // The app's very first paint: a nameless spinner here reads as "frozen". `LoadingState` names it
            // ("Checking your session…") for assistive tech AND sighted viewers.
            return <LoadingState label={auth.sessionLoading} />;
        case 'unauthenticated':
            if (screen === 'signup') {
                return <SignUpScreen onBack={() => setScreen('login')} />;
            }

            if (screen === 'login') {
                return <LoginScreen onSignUp={() => setScreen('signup')} />;
            }

            return <WelcomeScreen onGetStarted={() => setScreen('signup')} onSignIn={() => setScreen('login')} />;
        case 'blocked':
            return (
                <View style={styles.center}>
                    <Text style={styles.title}>{state.reason.title}</Text>
                    <Text style={styles.body}>{state.reason.body}</Text>
                </View>
            );
        case 'error':
            // The heading is app copy and MUST come from the dictionary; `state.error.message` is the
            // provider's own diagnostic and is passed through as-is.
            return (
                <View style={styles.center}>
                    <Text style={styles.title}>{common.somethingWentWrong}</Text>
                    <Text style={styles.body}>{state.error.message}</Text>
                </View>
            );
        case 'authenticated':
            return <>{children}</>;
    }
}

const styles = StyleSheet.create({
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: nativeTokens.spacing[5],
        gap: nativeTokens.spacing[2],
    },
    title: { fontSize: nativeTokens.fontSize.headingMd, fontWeight: '600', color: palette.charcoal },
    body: { fontSize: nativeTokens.fontSize.bodySm, textAlign: 'center', color: palette.slate },
});
