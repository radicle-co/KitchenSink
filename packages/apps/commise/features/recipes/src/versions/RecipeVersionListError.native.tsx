/**
 * @module @commise/features-recipes — the native version history's FAILED state (D3, D13; `buildSpec.md` §6.6: "We
 * couldn't load the history." + Try again), the twin of the web leaf.
 *
 * The settled list's title, so nothing moves between loading, failed and loaded; then an alert and a secondary Try again.
 * The way back is the SCREEN's pinned bar, which is there in every state, so the header draws none and the props carry no
 * way back (`onBack` and `backHref` are the web leaf's, `RecipeVersionListErrorWebProps`), as the native skeleton does. The
 * copy arrives as props from the app's boundary dictionary.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { useId, type FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { recipeVersionMessages } from './messages.js';
import type { RecipeVersionListErrorProps } from './RecipeVersionListError.js';

/**
 * @param props - The words, the retry and, when given, the way back.
 * @returns The title, an alert, and a secondary Try again button.
 */
export const RecipeVersionListError: FC<RecipeVersionListErrorProps> = ({ title, retryLabel, onRetry }) => {
    const { versionList } = useMessages(recipeVersionMessages);
    const { colors } = useTheme();
    const headingId = useId();

    return (
        <View style={styles.container}>
            <LargeTitleHeader headingId={headingId} title={versionList.heading} />
            <View role="alert" collapsable={false} style={styles.alert}>
                <Text style={[nativeTokens.type.body, { color: colors.ink }]}>{title}</Text>
                <Button variant="secondary" icon="refreshCw" onPress={onRetry}>
                    {retryLabel}
                </Button>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: nativeTokens.spacing[4], paddingBottom: nativeTokens.spacing[6] },
    alert: { alignItems: 'flex-start', gap: nativeTokens.spacing[3], paddingHorizontal: nativeTokens.spacing[4] },
});
