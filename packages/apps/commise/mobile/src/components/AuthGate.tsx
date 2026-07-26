import type { JSX, ReactNode } from 'react';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { LoginScreen } from '../screens/login';
import { SignUpScreen } from '../screens/signup';
import { WelcomeScreen } from '../screens/welcome';

interface AuthGateProps {
    children: ReactNode;
}

// U8: the signed-out flow opens on the branded WELCOME hero, which then leads into the sign-up ("Get
// started") or sign-in form; login/signup still toggle between each other.
type Screen = 'welcome' | 'login' | 'signup';

export function AuthGate({ children }: AuthGateProps): JSX.Element {
    const { state } = useAuth();
    const [screen, setScreen] = useState<Screen>('welcome');

    switch (state.status) {
        case 'loading':
            return (
                <View style={styles.center}>
                    <ActivityIndicator />
                </View>
            );
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
            return (
                <View style={styles.center}>
                    <Text style={styles.title}>Something went wrong</Text>
                    <Text style={styles.body}>{state.error.message}</Text>
                </View>
            );
        case 'authenticated':
            return <>{children}</>;
    }
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    title: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
    body: { fontSize: 14, textAlign: 'center', color: '#555' },
});
