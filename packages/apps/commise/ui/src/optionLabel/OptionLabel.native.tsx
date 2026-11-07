/**
 * @module @commise/ui/option-label — the native design-system {@link OptionLabel}: the React Native leaf of
 * `./OptionLabel.tsx`, on the same props. A View holding the label `Text`, the `note` badge after it (a View of its own,
 * so it keeps its radius and padding) and the parts line under it. At 320 pt the tag wraps under the label and the label
 * shrinks (`flexShrink: 1`, `minWidth: 0`), so nothing is cut off or pushes the row sideways. Colours come from the theme
 * at render.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Facade — one label over `StatusBadge` and `VariantPartsLine`, so every list of options draws a tagged,
 *     parted name the same way
 */
import type { FC } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';

import { StatusBadge } from '../statusBadge/StatusBadge.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import { VariantPartsLine } from '../variantPartsLine/VariantPartsLine.native.js';
import type { OptionLabelProps, OptionLabelSize } from './props.js';

/** The native option label. */
export const OptionLabel: FC<OptionLabelProps> = ({ label, tag, detailParts, textSize }) => {
    const { colors } = useTheme();

    return (
        <View style={styles.column}>
            <View style={styles.nameLine}>
                <Text style={[SIZE_STYLE[textSize], styles.label, { color: colors.ink }]}>{label}</Text>
                {tag === undefined ? null : <StatusBadge status="note">{tag}</StatusBadge>}
            </View>
            {detailParts === undefined ? null : <VariantPartsLine parts={detailParts} tone="secondary" />}
        </View>
    );
};

const styles = StyleSheet.create({
    // `minWidth: 0`: a column that cannot shrink below its longest word is how a row comes to scroll sideways.
    column: { flex: 1, minWidth: 0 },
    nameLine: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: nativeTokens.spacing[2],
        rowGap: nativeTokens.spacing[1],
    },
    label: { flexShrink: 1, minWidth: 0 },
});

/** Each size's text style. */
const SIZE_STYLE: Readonly<Record<OptionLabelSize, TextStyle>> = StyleSheet.create({
    list: nativeTokens.type.list,
    bodyMd: { ...nativeTokens.type.body },
});
