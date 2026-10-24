/**
 * @module @commise/features-recipes — the native recipe page's LOADING state (D3; `buildSpec.md` §6.7).
 *
 * The React Native twin of `RecipeDetailSkeleton.tsx`: the caption, shown and spoken politely through `LiveRegion` (React
 * Native has no live region of its own on iOS), over inert placeholder blocks kept out of the accessibility tree. The
 * hero is 4:3, the carousel's ratio, so the page does not move when the photo lands. Inert, not pulsing, as the native
 * list skeletons are, so no reduced-motion gate is needed.
 *
 * Presentational: props → JSX.
 */
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

/** Props for {@link RecipeDetailSkeleton}. */
export interface RecipeDetailSkeletonProps {
    /** What is loading, localised ("Loading recipe…"): the caption, which is also spoken. */
    readonly label: string;
}

/**
 * @param props - The localised name.
 * @returns The caption over the page's shape: hero, title, stat strip and the sections' rows.
 */
export const RecipeDetailSkeleton: FC<RecipeDetailSkeletonProps> = ({ label }) => {
    const { colors } = useTheme();
    const fill = { backgroundColor: colors.surfaceMuted };

    return (
        <View style={styles.page}>
            <LiveRegion politeness="polite" style={[styles.caption, { color: colors.inkMuted }]}>
                {label}
            </LiveRegion>
            <View aria-hidden style={styles.page}>
                <View style={[styles.hero, fill]} />
                <View style={styles.block}>
                    <View style={[styles.line, styles.short, fill]} />
                    <View style={[styles.title, fill]} />
                    <View style={[styles.title, styles.medium, fill]} />
                    <View style={[styles.strip, fill]} />
                    <View style={[styles.button, fill]} />
                </View>
                <View style={styles.block}>
                    <View style={[styles.heading, fill]} />
                    <View style={[styles.line, fill]} />
                    <View style={[styles.line, fill]} />
                    <View style={[styles.line, fill]} />
                    <View style={[styles.line, styles.medium, fill]} />
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    page: { gap: nativeTokens.spacing[6] },
    caption: { ...nativeTokens.type.caption, paddingHorizontal: nativeTokens.spacing[4] },
    hero: { width: '100%', aspectRatio: 4 / 3, borderRadius: nativeTokens.radius.lg },
    block: { gap: nativeTokens.spacing[3], paddingHorizontal: nativeTokens.spacing[4] },
    line: { height: 20, borderRadius: nativeTokens.radius.md },
    title: { height: 36, borderRadius: nativeTokens.radius.md },
    heading: { height: 24, width: '35%', borderRadius: nativeTokens.radius.md },
    strip: { height: 80, borderRadius: nativeTokens.radius.lg },
    button: { height: 44, width: '50%', borderRadius: nativeTokens.radius.lg },
    short: { width: '33%' },
    medium: { width: '66%' },
});
