/**
 * @module @commise/features-recipes — the native first run of Home's "Recent recipes" block, the twin of the web leaf
 * (`docs/design/uiOverhaul/buildSpec.md` §4.2): one line, **Add your first recipe**, **Paste ingredients** and **Or find
 * one on Discover**. Pure: the host decides where each leads.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import type { RecipeWidgetEmptyStateProps } from './props.js';

export const RecipeWidgetEmptyState: FC<RecipeWidgetEmptyStateProps> = ({ firstRun }) => {
    const { home } = useMessages(recipeMessages);
    const { colors } = useTheme();

    return (
        <View style={styles.block}>
            <Text style={[styles.body, { color: colors.inkMuted }]}>{home.recentEmptyBody}</Text>
            {firstRun === undefined ? null : (
                <>
                    <Button icon="pencilLine" size="lg" width="fill" onPress={firstRun.onCreateRecipe}>
                        {home.firstRecipe}
                    </Button>
                    {firstRun.onPasteIngredients === undefined ? null : (
                        <Button
                            variant="secondary"
                            icon="clipboardPaste"
                            size="lg"
                            width="fill"
                            onPress={firstRun.onPasteIngredients}
                        >
                            {home.pasteIngredients}
                        </Button>
                    )}
                    <Pressable
                        accessibilityRole="link"
                        accessibilityLabel={home.findOnDiscover}
                        onPress={firstRun.onFindOnDiscover}
                        style={styles.link}
                    >
                        <Icon name="compass" size={20} tone="actionText" />
                        <Text style={[styles.linkLabel, { color: colors.actionText }]}>{home.findOnDiscover}</Text>
                    </Pressable>
                </>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    block: { gap: nativeTokens.spacing[3], alignItems: 'stretch' },
    body: { ...nativeTokens.type.body },
    link: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2], minHeight: 48 },
    linkLabel: { ...nativeTokens.type.label },
});
