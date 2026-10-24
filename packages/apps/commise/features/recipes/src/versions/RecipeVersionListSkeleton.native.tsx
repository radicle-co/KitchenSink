/**
 * @module @commise/features-recipes — the native version history's LOADING state (D3; `buildSpec.md` §6.6: "Loading: 3
 * skeleton rows").
 *
 * The settled list's title, a caption spoken politely through `LiveRegion` (React Native has no live region of its own on
 * iOS), and three inert rows kept out of the accessibility tree. The way back is the SCREEN's pinned bar — it is there in
 * every state — and so is the failed state, which is already an alert with Try again, so only the loading
 * state lives here. Inert, not pulsing, as the native list skeletons are.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { useId, type FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { recipeVersionMessages } from './messages.js';

/** How many placeholder rows stand in for the history. */
const PLACEHOLDER_ROWS = [0, 1, 2] as const;

/** Props for {@link RecipeVersionListSkeleton}. */
export interface RecipeVersionListSkeletonProps {
    /** What is loading, localised ("Loading version history…"): the caption, which is also spoken. */
    readonly label: string;
}

/**
 * @param props - The caption.
 * @returns The title, the caption, and three placeholder rows.
 */
export const RecipeVersionListSkeleton: FC<RecipeVersionListSkeletonProps> = ({ label }) => {
    const { versionList } = useMessages(recipeVersionMessages);
    const { colors } = useTheme();
    const headingId = useId();
    const fill = { backgroundColor: colors.surfaceMuted };

    return (
        <View style={styles.container}>
            <LargeTitleHeader headingId={headingId} title={versionList.heading} />
            <LiveRegion politeness="polite" style={[styles.caption, { color: colors.inkMuted }]}>
                {label}
            </LiveRegion>
            <View aria-hidden>
                {PLACEHOLDER_ROWS.map((row) => (
                    <View key={row} style={[styles.row, { borderBottomColor: colors.lineDivider }]}>
                        <View style={[styles.title, fill]} />
                        <View style={[styles.meta, fill]} />
                    </View>
                ))}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: nativeTokens.spacing[4], paddingBottom: nativeTokens.spacing[6] },
    caption: { ...nativeTokens.type.caption, paddingHorizontal: nativeTokens.spacing[4] },
    row: {
        gap: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[3],
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    title: { height: 20, width: '66%', borderRadius: nativeTokens.radius.md },
    meta: { height: 16, width: '33%', borderRadius: nativeTokens.radius.md },
});
