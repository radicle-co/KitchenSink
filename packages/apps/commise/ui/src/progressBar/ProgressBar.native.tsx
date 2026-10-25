/**
 * @module @commise/ui/progress-bar — the native design-system {@link ProgressBar}: a 6 dp `surfaceMuted` track filled
 * with `action` to the share done, exposed as a determinate `progressbar` with its name and value. Colours come from
 * the theme at render. The fill does not animate.
 *
 * @pattern Specification consumer — `progressFraction` decides the fill; both leaves draw its one answer
 */
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/useTheme.native.js';
import { progressFraction, type ProgressBarProps } from './props.js';

/** The track's height, dp. */
const TRACK_HEIGHT = 6;

/** The native determinate progress bar. */
export const ProgressBar: FC<ProgressBarProps> = ({ label, value, max }) => {
    const { colors } = useTheme();
    const fraction = progressFraction(value, max);
    const bound = Math.max(0, max);

    return (
        <View
            role="progressbar"
            aria-label={label}
            aria-valuenow={Math.round(fraction * bound)}
            aria-valuemin={0}
            aria-valuemax={bound}
            style={[styles.track, { backgroundColor: colors.surfaceMuted }]}
        >
            <View style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: colors.action }]} />
        </View>
    );
};

const styles = StyleSheet.create({
    track: { height: TRACK_HEIGHT, width: '100%', overflow: 'hidden', borderRadius: TRACK_HEIGHT / 2 },
    fill: { height: '100%', borderRadius: TRACK_HEIGHT / 2 },
});
