/**
 * @module @commise/features-recipes — the native load error of Home's "Recent recipes" block, the twin of the web leaf:
 * under the heading, "We couldn't load your recent recipes." and **Try again** when the host can retry.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import type { RecipeWidgetLoadErrorProps } from './props.js';
import { RecipeWidgetCard } from './RecipeWidgetCard.native.js';

export const RecipeWidgetLoadError: FC<RecipeWidgetLoadErrorProps> = ({ onRetry, seeAll }) => {
    const { widgetTitle, home } = useMessages(recipeMessages);
    const { colors } = useTheme();

    return (
        <RecipeWidgetCard title={widgetTitle} {...(seeAll === undefined ? {} : { seeAll })}>
            <View collapsable={false} role="status" accessibilityLiveRegion="polite" style={styles.body}>
                <Text style={[styles.text, { color: colors.inkMuted }]}>{home.loadError}</Text>
                {onRetry === undefined ? null : (
                    <Button variant="secondary" icon="rotateCcw" onPress={onRetry}>
                        {home.retry}
                    </Button>
                )}
            </View>
        </RecipeWidgetCard>
    );
};

const styles = StyleSheet.create({
    body: { gap: nativeTokens.spacing[3], alignItems: 'flex-start' },
    text: { ...nativeTokens.type.body },
});
