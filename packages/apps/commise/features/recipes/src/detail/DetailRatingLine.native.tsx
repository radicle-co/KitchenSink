'use client';

/**
 * @module @commise/features-recipes — the native recipe page's rating line: the star and figure, then the draft badge
 * or the visibility mark. Draws nothing when the recipe states neither.
 *
 * Presentational: props → JSX.
 */
import { Icon } from '@commise/ui/icon';
import { StatusBadge } from '@commise/ui/status-badge';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Text, View } from 'react-native';

import type { DetailRatingLine as DetailRatingLineFacts } from './detailFacts.js';
import { detailStyles as styles } from './detailStyles.native.js';

/** Props for {@link DetailRatingLine}. */
export interface DetailRatingLineProps {
    /** The facts `detailRatingLine` derived. */
    readonly ratingLine: DetailRatingLineFacts;
}

/** The native rating line. */
export const DetailRatingLine: FC<DetailRatingLineProps> = ({ ratingLine }) => {
    const { colors } = useTheme();
    const { rating, status } = ratingLine;

    if (rating === undefined && status === undefined) {
        return null;
    }

    return (
        <View style={styles.ratingLine}>
            {rating !== undefined && (
                <View style={styles.inline}>
                    <Icon name="star" size={16} tone="rating" filled />
                    <Text style={[styles.meta, styles.figures, { color: colors.ink }]}>{rating.text}</Text>
                </View>
            )}
            {status?.kind === 'draft' && <StatusBadge status="draft">{status.text}</StatusBadge>}
            {status?.kind === 'visibility' && (
                <View style={styles.inline}>
                    <Icon name={status.visibility === 'public' ? 'globe' : 'lock'} size={16} tone="inkMuted" />
                    <Text style={[styles.meta, { color: colors.inkMuted }]}>{status.text}</Text>
                </View>
            )}
        </View>
    );
};
