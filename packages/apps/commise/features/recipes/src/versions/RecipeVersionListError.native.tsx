/**
 * @module @commise/features-recipes — the native version history's FAILED state (D3, D13; `buildSpec.md` §6.6: "We
 * couldn't load the history." + Try again), the twin of the web leaf.
 *
 * The settled list's title, so nothing moves between loading, failed and loaded; then an alert and a secondary Try again.
 * The way back is the SCREEN's — it sits above the read boundary in every state — so the header draws a Back only when it
 * is given one, as the native skeleton does. The copy arrives as props from the app's boundary dictionary.
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

/** Props for {@link RecipeVersionListError}. */
export interface RecipeVersionListErrorProps {
    /** Why there is no history: "We couldn’t load the history." */
    readonly title: string;
    /** The retry control's label: "Try again". */
    readonly retryLabel: string;
    /** Read the history again. */
    readonly onRetry: () => void;
    /** Back to the recipe; absent draws no Back (the screen keeps its own above the read boundary). */
    readonly onBack?: () => void;
    /** Web only: the recipe's address. Native has none. */
    readonly backHref?: string;
}

/**
 * @param props - The words, the retry and, when given, the way back.
 * @returns The title, an alert, and a secondary Try again button.
 */
export const RecipeVersionListError: FC<RecipeVersionListErrorProps> = ({ title, retryLabel, onRetry, onBack }) => {
    const { versionList } = useMessages(recipeVersionMessages);
    const { colors } = useTheme();
    const headingId = useId();

    return (
        <View style={styles.container}>
            <LargeTitleHeader
                headingId={headingId}
                title={versionList.heading}
                {...(onBack === undefined
                    ? {}
                    : {
                          back: {
                              label: versionList.backToRecipe,
                              parent: versionList.backToRecipe,
                              onPress: onBack,
                          },
                      })}
            />
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
