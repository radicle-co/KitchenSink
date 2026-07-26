/**
 * @module screens/welcome — the branded auth-entry / welcome screen (U8, mobile).
 *
 * The hero the app opens on when signed out (before the sign-in / sign-up forms): a beach-glow gradient
 * hero with the brand logo mark, Playfair wordmark, tagline, three feature pills, a gradient "Get started"
 * CTA into sign-up, and a "Sign in" control for returning users. Built on the design system — the
 * {@link GradientSurface} hero + brand-gradient logo mark, the {@link Button} primary (which paints the
 * SAME brand gradient the web CTA uses), and copy from `mobileMessages` (no hard-coded English).
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { GradientSurface } from '@commise/ui/surface';
import { Feather } from '@expo/vector-icons';
import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { mobileMessages } from '../i18n/messages.js';

export interface WelcomeScreenProps {
    /** Enter the sign-up flow (the primary "Get started" CTA). */
    readonly onGetStarted: () => void;
    /** Enter the sign-in flow (returning users). */
    readonly onSignIn: () => void;
}

/** One brand feature pill — a solid rounded chip. */
function Pill({ tone, color, children }: { tone: string; color: string; children: string }): JSX.Element {
    return (
        <View style={[styles.pill, { backgroundColor: tone }]}>
            <Text style={[styles.pillText, { color }]}>{children}</Text>
        </View>
    );
}

export function WelcomeScreen({ onGetStarted, onSignIn }: WelcomeScreenProps): JSX.Element {
    const { welcome: t } = useMessages(mobileMessages);

    return (
        <GradientSurface gradient="hero" accessibilityLabel={t.regionLabel} style={styles.surface}>
            <SafeAreaView style={styles.safe}>
                <View style={styles.hero}>
                    <GradientSurface gradient="brand" accessibilityLabel={t.logoAlt} style={styles.logo}>
                        <Text style={styles.logoText}>C</Text>
                    </GradientSurface>
                    <Text style={styles.title}>{t.title}</Text>
                    <Text style={styles.tagline}>{t.tagline}</Text>
                    <View style={styles.pills}>
                        <Pill tone={palette.seafoam} color={palette.white}>
                            {t.features.saveRecipes}
                        </Pill>
                        <Pill tone={palette.coral} color={palette.white}>
                            {t.features.planMeals}
                        </Pill>
                        <Pill tone={palette.sky} color={palette.charcoal}>
                            {t.features.shopSmarter}
                        </Pill>
                    </View>
                </View>

                <View style={styles.actions}>
                    <Button
                        icon={<Feather name="arrow-right" size={16} color={palette.white} />}
                        onPress={onGetStarted}
                    >
                        {t.getStarted}
                    </Button>
                    <Pressable accessibilityRole="button" onPress={onSignIn} style={styles.signIn}>
                        <Text style={styles.signInText}>{t.signIn}</Text>
                    </Pressable>
                </View>
            </SafeAreaView>
        </GradientSurface>
    );
}

const styles = StyleSheet.create({
    surface: { flex: 1 },
    safe: {
        flex: 1,
        justifyContent: 'space-between',
        paddingHorizontal: nativeTokens.spacing[5],
        paddingVertical: nativeTokens.spacing[7],
    },
    hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: nativeTokens.spacing[4] },
    logo: {
        width: 64,
        height: 64,
        borderRadius: nativeTokens.radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
    },
    logoText: { fontSize: nativeTokens.fontSize.displayMd, fontWeight: '700', color: palette.white },
    title: {
        fontFamily: nativeTokens.fontFamily.display,
        fontSize: nativeTokens.fontSize.displayXl,
        fontWeight: '700',
        color: palette.charcoal,
        textAlign: 'center',
    },
    tagline: {
        fontSize: nativeTokens.fontSize.bodyLg,
        color: palette.slate,
        textAlign: 'center',
        marginBottom: nativeTokens.spacing[3],
    },
    pills: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: nativeTokens.spacing[2] },
    pill: {
        borderRadius: nativeTokens.radius.full,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[1],
    },
    pillText: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600' },
    actions: { alignItems: 'center', gap: nativeTokens.spacing[3] },
    signIn: { paddingVertical: nativeTokens.spacing[2] },
    signInText: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500', color: palette.slate },
});
