/**
 * @module @commise/features-recipes — NATIVE recipe-source (provenance) line: "Adapted from" and where.
 *
 * The React Native leaf of `RecipeSourceLine`: same contract, same rules, same states. Renders for EVERY viewer,
 * because provenance belongs to the recipe, not to who is looking.
 *
 * React Native has no declarative link, so opening a URL is a platform call, injected as `onOpen` and defaulting to
 * `openExternalUrl`.
 *
 * SAFETY, sharper here than on web because this platform hands the string to the OS: `Linking.openURL` dispatches
 * `tel:`, `sms:` and `intent:` too, so a URL that `safeHttpUrl` refuses gets no tap target at all. The link text is the
 * VERIFIED HOST, never the untrusted `sourceAttribution`, which renders beside it as plain text.
 *
 * @pattern Adapter — `onOpen` wraps the platform's URL opener
 */
import { useMessages } from '@commise/i18n/react';
import { touchFloor } from '@commise/ui/layout';
import { PressScale } from '@commise/ui/press-scale';
import { Text } from '@commise/ui/text';
import { safeHttpUrl } from '@kitchensink/recipe-core/external-url';
import type { FC } from 'react';
import { styled, XStack, YStack } from 'tamagui';

import { recipeMessages } from '../messages.js';
import type { RecipeSourceLineNativeProps } from './model.js';
import { openExternalUrl } from './openExternalUrl.native.js';

const Row = styled(XStack, { name: 'SourceRow', flexWrap: 'wrap', alignItems: 'center', columnGap: '$2' });

// The host is often a short string, and a link that small is unhittable under the touch floor (RC-3).
const LinkTouch = styled(YStack, {
    name: 'SourceLinkTouch',
    flexShrink: 1,
    justifyContent: 'center',
    minHeight: touchFloor(),
});

// `actionText` is 6.20:1 on the light page and 9.61:1 on the dark one. Underlined so the affordance does not ride on
// colour alone (SC 1.4.1).
const LinkText = styled(Text, {
    name: 'SourceLinkText',
    typeRole: 'caption',
    color: '$actionText',
    textDecorationLine: 'underline',
});

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
        <Row>
            <Text typeRole="meta" color="$inkMuted">
                {detail.sourceHeading}
            </Text>
            {attribution !== undefined && (
                // `flexShrink`: unbounded user text would otherwise take its full width and push the link off screen.
                <Text typeRole="meta" flexShrink={1}>
                    {attribution}
                </Text>
            )}
            {safe !== null && (
                // `PressScale` owns the one press responder (G6), and states the link role.
                <PressScale accessibilityRole="link" onPress={() => onOpen(safe.href)}>
                    <LinkTouch>
                        <LinkText>{safe.host}</LinkText>
                    </LinkTouch>
                </PressScale>
            )}
        </Row>
    );
};
