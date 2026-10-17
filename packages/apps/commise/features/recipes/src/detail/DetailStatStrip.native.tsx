'use client';

/**
 * @module @commise/features-recipes — the native recipe page's stat strip: one cell per figure, two to a row below a
 * 360 pt strip (counted in text, so a large font gets it sooner). Draws nothing when the recipe has no figure to show.
 * With two to a row and an odd count, the last cell spans the row rather than leaving a hole beside it (D8).
 *
 * Presentational: props → JSX.
 */
import { DifficultyBadge } from '@commise/ui/difficulty-badge';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Text, View } from 'react-native';

import type { DetailStatCell } from './detailFacts.js';
import { detailStyles as styles } from './detailStyles.native.js';
import type { DetailNativeLayout } from './model.js';

/** Props for {@link DetailStatStrip}. */
export interface DetailStatStripProps {
    /** The cells `detailStatCells` derived, in display order. */
    readonly stats: readonly DetailStatCell[];
    /** How many cells fit a row at this width. */
    readonly statsPerRow: DetailNativeLayout['statsPerRow'];
}

/**
 * How much of the row one cell takes. Four to a row share it equally (one row of up to four); two to a row take half
 * each, except the last of an odd count, which takes the row. Pure.
 */
const basisOf = (index: number, count: number, statsPerRow: DetailNativeLayout['statsPerRow']): `${number}%` => {
    if (statsPerRow === 4) {
        return `${100 / count}%`;
    }

    return count % 2 === 1 && index === count - 1 ? '100%' : '50%';
};

/** The native stat strip. */
export const DetailStatStrip: FC<DetailStatStripProps> = ({ stats, statsPerRow }) => {
    const { colors } = useTheme();

    if (stats.length === 0) {
        return null;
    }

    return (
        <View style={[styles.statStrip, { backgroundColor: colors.paper, borderColor: colors.lineDivider }]}>
            {stats.map((cell, index) => (
                <View key={cell.id} style={[styles.statCell, { flexBasis: basisOf(index, stats.length, statsPerRow) }]}>
                    {cell.id === 'difficulty' ? (
                        <DifficultyBadge level={cell.level}>{cell.value}</DifficultyBadge>
                    ) : (
                        <Text style={[styles.statValue, { color: colors.ink }]}>{cell.value}</Text>
                    )}
                    <Text style={[styles.caption, { color: colors.inkMuted }]}>{cell.label}</Text>
                </View>
            ))}
        </View>
    );
};
