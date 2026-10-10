/**
 * @module @commise/features-recipes — the native add-recipes picker body while the caller's recipes load, the twin of the
 * web leaf: a status that says what is loading, over six skeleton rows the height of a real row
 * (`docs/design/uiOverhaul/buildSpec.md` §5.3), so the list does not jump when the rows arrive. Colour is read from the
 * theme at render (D15).
 *
 * Presentational: the picker's loading body.
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { collectionMessages } from './messages.js';

/** How many skeleton rows the loading body draws. */
const SKELETON_ROWS = 6;

export const CollectionRecipePickerLoading: FC = () => {
    const { picker } = useMessages(collectionMessages);
    const { colors } = useTheme();
    const block = { backgroundColor: colors.lineDivider };

    return (
        <View collapsable={false} role="status" style={styles.region}>
            <Text style={[styles.caption, { color: colors.inkMuted }]}>{picker.loadingLabel}</Text>
            <View aria-hidden>
                {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                    <View key={index} style={styles.row}>
                        <View style={[styles.thumb, block]} />
                        <View style={styles.text}>
                            <View style={[styles.line, styles.wide, block]} />
                            <View style={[styles.line, styles.narrow, block]} />
                        </View>
                        <View style={[styles.circle, block]} />
                    </View>
                ))}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    region: { gap: nativeTokens.spacing[2] },
    caption: { ...nativeTokens.type.meta },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
        minHeight: 64,
        paddingHorizontal: nativeTokens.spacing[2],
    },
    thumb: { width: 48, height: 48, borderRadius: nativeTokens.radius.md },
    text: { flex: 1, gap: nativeTokens.spacing[2] },
    line: { height: 12, borderRadius: nativeTokens.radius.sm },
    wide: { width: '66%' },
    narrow: { width: '33%' },
    circle: { width: 28, height: 28, borderRadius: 14 },
});
