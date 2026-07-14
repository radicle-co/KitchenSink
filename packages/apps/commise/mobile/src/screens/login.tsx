import { useClerk, useSignIn } from '@clerk/expo';
import type { JSX } from 'react';
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { Button, Input, SizableText, YStack } from 'tamagui';

export interface LoginScreenProps {
    onSignUp: () => void;
}

export function LoginScreen({ onSignUp }: LoginScreenProps): JSX.Element {
    const { setActive } = useClerk();
    const { signIn } = useSignIn();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    // 'credentials' → email+password; 'code' → the instance requires an email-code factor to finish.
    const [step, setStep] = useState<'credentials' | 'code'>('credentials');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // Complete the sign-in when Clerk reports it is done, or advance to the email-code step when the
    // instance requires new-device verification (mirrors the web <SignIn> flow, which the custom mobile
    // form must otherwise handle itself). Returns true when the sign-in is fully complete.
    async function resolveStatus(): Promise<boolean> {
        if (!signIn) {
            return false;
        }

        if (signIn.status === 'complete' && signIn.createdSessionId) {
            await setActive({ session: signIn.createdSessionId });

            return true;
        }

        if (signIn.status === 'needs_first_factor') {
            const sendResult = await signIn.emailCode.sendCode({ emailAddress: email });

            if (sendResult.error) {
                setError(sendResult.error.message ?? 'Could not send a verification code');

                return false;
            }

            setStep('code');
            setError(null);

            return false;
        }

        setError('Additional verification required');

        return false;
    }

    async function handleSignIn() {
        if (!signIn) {
            return;
        }

        setBusy(true);
        setError(null);

        try {
            const createResult = await signIn.create({ identifier: email });

            if (createResult.error) {
                setError(
                    typeof createResult.error === 'string'
                        ? createResult.error
                        : (createResult.error.message ?? 'Sign-in failed'),
                );

                return;
            }

            // If the first factor is already email_code (passwordless / new device), the create above
            // may land directly on needs_first_factor without a password attempt.
            if (signIn.status !== 'needs_first_factor') {
                const pwResult = await signIn.password({ password });

                if (pwResult.error) {
                    setError(
                        typeof pwResult.error === 'string'
                            ? pwResult.error
                            : (pwResult.error.message ?? 'Sign-in failed'),
                    );

                    return;
                }
            }

            await resolveStatus();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Sign-in failed');
        } finally {
            setBusy(false);
        }
    }

    async function handleVerifyCode() {
        if (!signIn) {
            return;
        }

        setBusy(true);
        setError(null);

        try {
            const result = await signIn.emailCode.verifyCode({ code });

            if (result.error) {
                setError(result.error.message ?? 'Verification failed');

                return;
            }

            await resolveStatus();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Verification failed');
        } finally {
            setBusy(false);
        }
    }

    return (
        <YStack flex={1} justifyContent="center" backgroundColor="$background" padding="$5" gap="$4">
            <SizableText
                fontFamily="$heading"
                fontSize={36}
                fontWeight="700"
                color="$color"
                textAlign="center"
                marginBottom="$3"
            >
                Commise
            </SizableText>

            {step === 'credentials' ? (
                <YStack gap="$3">
                    <Input
                        placeholder="Email"
                        autoCapitalize="none"
                        keyboardType="email-address"
                        value={email}
                        onChangeText={setEmail}
                        borderColor="$borderColor"
                        borderWidth={1}
                        borderRadius="$2"
                        padding="$3"
                        fontSize={16}
                        backgroundColor="white"
                        color="$color"
                    />
                    <Input
                        placeholder="Password"
                        secureTextEntry
                        value={password}
                        onChangeText={setPassword}
                        borderColor="$borderColor"
                        borderWidth={1}
                        borderRadius="$2"
                        padding="$3"
                        fontSize={16}
                        backgroundColor="white"
                        color="$color"
                    />
                </YStack>
            ) : (
                <YStack gap="$3">
                    <SizableText color="$color" fontSize={14} textAlign="center">
                        Enter the verification code sent to your email.
                    </SizableText>
                    <Input
                        placeholder="Verification code"
                        keyboardType="number-pad"
                        value={code}
                        onChangeText={setCode}
                        borderColor="$borderColor"
                        borderWidth={1}
                        borderRadius="$2"
                        padding="$3"
                        fontSize={16}
                        backgroundColor="white"
                        color="$color"
                    />
                </YStack>
            )}

            {error ? (
                <SizableText color="$destructive" fontSize={14} textAlign="center">
                    {error}
                </SizableText>
            ) : null}

            {busy ? (
                <ActivityIndicator color="#5BA8A0" />
            ) : (
                <Button
                    onPress={step === 'credentials' ? handleSignIn : handleVerifyCode}
                    disabled={!signIn || busy}
                    backgroundColor="$primary"
                    color="white"
                    borderRadius="$5"
                    padding="$3"
                    fontSize={16}
                    fontWeight="600"
                    pressStyle={{ backgroundColor: '#3D8B85' }}
                >
                    {step === 'credentials' ? 'Sign in' : 'Verify'}
                </Button>
            )}

            <Button
                onPress={onSignUp}
                backgroundColor="transparent"
                color="rgba(0,0,0,0.5)"
                fontSize={14}
                pressStyle={{ opacity: 0.8 }}
            >
                Don't have an account?{' '}
                <SizableText color="rgba(0,0,0,0.7)" fontSize={14} fontWeight="600">
                    Sign up
                </SizableText>
            </Button>
        </YStack>
    );
}
