/**
 * @module @commise/features-recipes — NATIVE recipe-source (provenance) line.
 *
 * The React Native leaf of `RecipeSourceLine`: same contract, same rules, same states. Renders for EVERY
 * viewer — provenance belongs to the recipe, not to who is looking.
 *
 * Pattern: **pure presentational (render) component** + an injected **Adapter** for the one thing a render
 * cannot do. React Native has no declarative link, so opening a URL is a platform call; it is injected as
 * `onOpen`, defaulting to `openExternalUrl` (`./openExternalUrl.native.ts`). The component itself stays
 * `props → JSX` with a delegating `onPress`.
 *
 * SAFETY — sharper here than on web, because this platform hands the string to the OS. `Linking.openURL`
 * will happily dispatch `tel:`, `sms:`, a rival app's deep link, or an Android `intent:`, so a URL that
 * `safeHttpUrl` refuses gets no tap target at all. The visible link text is the VERIFIED HOST, never the
 * untrusted `sourceAttribution` (which renders beside it, as text): a recipe must not be able to label the
 * thing you tap with a site it does not actually point at.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { safeHttpUrl } from '@kitchensink/recipe-core/external-url';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import type { RecipeSourceLineNativeProps } from './model.js';
import { openExternalUrl } from './openExternalUrl.native.js';

export const RecipeSourceLine: FC<RecipeSourceLineNativeProps> = ({
    sourceUrl,
    sourceAttribution,
    onOpen = openExternalUrl,
}) => {
    const { detail } = useMessages(recipeMessages);
    const safe = sourceUrl === undefined ? null : safeHttpUrl(sourceUrl);
    const attribution = sourceAttribution !== undefined && sourceAttribution.length > 0 ? sourceAttribution : undefined;

    if (safe === null && attribution === undefined) {
        return null;
    }

    return (
        <View accessibilityLabel={detail.sourceHeading} style={styles.row}>
            <Text style={styles.label}>{detail.sourceHeading}</Text>
            {attribution !== undefined && <Text style={styles.attribution}>{attribution}</Text>}
            {safe !== null && (
                <Pressable
                    accessibilityRole="link"
                    // 44pt touch floor (RC-3): the host is often a short string, and a link that small is
                    // unhittable without it.
                    style={styles.linkTouch}
                    onPress={() => onOpen(safe.href)}
                >
                    <Text style={styles.link}>{safe.host}</Text>
                </Pressable>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[1],
    },
    label: {
        fontSize: nativeTokens.fontSize.overline,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: palette.slate,
    },
    // RN defaults `flexShrink` to 0, so unbounded user text (`sourceAttribution` has a `min`, no `max`)
    // would take its full intrinsic width and push the link past the screen edge — the same failure the
    // detail's ingredient row already documents.
    attribution: { flexShrink: 1, fontSize: nativeTokens.fontSize.bodySm, color: palette.charcoal },
    linkTouch: { flexShrink: 1, minHeight: 44, justifyContent: 'center' },
    // Contrast (WCAG AA): `ocean-dark` is 6.20:1 on the page surface. Underlined so the affordance does not
    // ride on colour alone (SC 1.4.1).
    link: {
        flexShrink: 1,
        fontSize: nativeTokens.fontSize.bodySm,
        fontWeight: '500',
        color: palette['ocean-dark'],
        textDecorationLine: 'underline',
    },
});
