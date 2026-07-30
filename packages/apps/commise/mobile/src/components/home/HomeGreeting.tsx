/**
 * @module home/HomeGreeting — the time-of-day Home greeting + date subtitle (mobile; US-000 / FR-046).
 *
 * The native mirror of the web greeting: "Good afternoon, Chef!" over the local calendar date. Both derive
 * from the viewer's local clock via the SHARED formatters in `@commise/features-core`
 * ({@link greetingBucketForHour} + {@link formatHomeDate}), so web and mobile greet identically (FR-044).
 * The greeting uses the loaded Playfair display face; the whole surface is client-rendered on device, so
 * (unlike web) there is no hydration concern — reading the clock in render is fine.
 */
import { formatHomeDate, greetingBucketForHour } from '@commise/features-core';
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../../i18n/messages.js';
import { DISPLAY_FONT_BOLD } from '../../theme/fonts.js';

/**
 * The Home greeting header (mobile).
 *
 * @returns The time-of-day greeting and the localized full-date subtitle.
 */
export function HomeGreeting(): JSX.Element {
    const { home } = useMessages(mobileMessages);
    const locale = useLocale();

    const now = new Date();
    const greeting = home.greetings[greetingBucketForHour(now.getHours())];
    const date = formatHomeDate(now, locale);

    return (
        <View style={styles.container}>
            <Text accessibilityRole="header" style={styles.greeting}>
                {greeting}
            </Text>
            <Text style={styles.date}>{date}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { paddingHorizontal: 16, paddingTop: 8, gap: 4 },
    greeting: { fontFamily: DISPLAY_FONT_BOLD, fontSize: 28, fontWeight: '700', color: palette.charcoal },
    date: { fontSize: 14, color: palette.slate },
});
