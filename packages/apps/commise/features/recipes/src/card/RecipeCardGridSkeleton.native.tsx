/**
 * @module @commise/features-recipes — the native recipe-card loading skeleton, the twin of the web leaf.
 *
 * The localized label NAMES the region (RN has no live regions); the placeholders are hidden from assistive tech and
 * inert — no animation, so no reduced-motion gate. Each placeholder is the shape of the variant the loaded cards will use
 * (`docs/design/uiOverhaul/buildSpec.md` §4.1), its bars in the scheme's `surfaceMuted` role read at render.
 *
 * @pattern Null Object — the loading phase's stand-in for the cards
 */
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';

import type { CardVariant } from './cardVariant.js';
import { RECIPE_CARD_SKELETON_COUNT } from './model.js';

/** Which grid the skeleton sits in: the library's (grid or list by variant) or Home's. */
export type SkeletonLayout = 'library' | 'home';

export interface RecipeCardGridSkeletonProps {
    /** The localized "loading…" copy — names the placeholder region for assistive tech. */
    readonly label: string;
    /** How many placeholder cards to paint. Defaults to {@link RECIPE_CARD_SKELETON_COUNT}. */
    readonly count?: number;
    /** The variant the loaded cards will use. Defaults to `grid`. */
    readonly variant?: CardVariant;
    /** The grid the cards sit in. Defaults to `library`. */
    readonly layout?: SkeletonLayout;
}

/** A bar of the given width, as a share of its line. */
const Bar: FC<{ readonly width: DimensionValue; readonly tall?: boolean }> = ({ width, tall = false }) => {
    const { colors } = useTheme();

    return (
        <View
            {...{ dataSet: { skeletonBar: '' } }}
            style={[tall ? styles.barTall : styles.bar, { width, backgroundColor: colors.surfaceMuted }]}
        />
    );
};

/** The cover block. */
const Cover: FC<{ readonly thumbnail?: boolean }> = ({ thumbnail = false }) => {
    const { colors } = useTheme();

    return (
        <View
            {...{ dataSet: { skeletonBar: '' } }}
            style={[thumbnail ? styles.thumbnail : styles.cover, { backgroundColor: colors.surfaceMuted }]}
        />
    );
};

const SHAPE: Readonly<Record<CardVariant, FC>> = {
    grid: () => (
        <>
            <Cover />
            <View style={styles.body}>
                <Bar width="75%" tall />
                <Bar width="50%" tall />
                <Bar width="66%" tall />
                <Bar width="50%" />
                <Bar width="33%" />
            </View>
        </>
    ),
    row: () => (
        <View style={styles.row}>
            <Cover thumbnail />
            <View style={styles.rowText}>
                <Bar width="75%" tall />
                <Bar width="50%" />
            </View>
        </View>
    ),
    compact: () => (
        <>
            <Cover />
            <View style={styles.compactBody}>
                <Bar width="75%" tall />
            </View>
        </>
    ),
};

/**
 * The named region over inert placeholders of the variant the cards will use.
 *
 * @param props - The label, the count, the variant and the grid.
 * @returns The skeleton.
 */
export const RecipeCardGridSkeleton: FC<RecipeCardGridSkeletonProps> = ({
    label,
    count = RECIPE_CARD_SKELETON_COUNT,
    variant = 'grid',
    layout = 'library',
}) => {
    const { colors } = useTheme();
    const Shape = SHAPE[variant];
    const cellWidth: DimensionValue = variant === 'row' && layout === 'library' ? '100%' : '48%';

    return (
        <View accessible accessibilityLabel={label} style={styles.grid}>
            {Array.from({ length: count }, (_unused, index) => (
                // `aria-hidden` on each CARD, not on the container: the container carries the region's name.
                <View
                    key={index}
                    aria-hidden
                    {...{ dataSet: { skeletonVariant: variant } }}
                    style={[
                        styles.card,
                        { width: cellWidth, backgroundColor: colors.paper, borderColor: colors.lineDivider },
                    ]}
                >
                    <Shape />
                </View>
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[3] },
    card: { borderRadius: nativeTokens.radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
    cover: { width: '100%', aspectRatio: 4 / 3 },
    thumbnail: { width: 80, height: 80, borderRadius: nativeTokens.radius.md },
    body: { padding: nativeTokens.spacing[4], gap: nativeTokens.spacing[2] },
    compactBody: { padding: nativeTokens.spacing[3] },
    row: { flexDirection: 'row', gap: nativeTokens.spacing[3], padding: nativeTokens.spacing[3], minHeight: 96 },
    rowText: { flex: 1, gap: nativeTokens.spacing[2], paddingTop: nativeTokens.spacing[1] },
    bar: { height: 12, borderRadius: nativeTokens.radius.sm },
    barTall: { height: 16, borderRadius: nativeTokens.radius.sm },
});
