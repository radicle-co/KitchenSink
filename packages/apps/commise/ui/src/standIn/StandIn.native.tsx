/**
 * @module @commise/ui/stand-in — the native chip that stands where a missing value would be.
 *
 * The same contract as the web leaf. React Native's nested `Text` takes no border and no padding, so the chip is a
 * `View` holding a `Text`: the job is kept, the mechanism differs (`docs/design/namelessLineCopy.md` §2c).
 *
 * ⛔ The words are the content: nothing here hides them from the screen reader.
 *
 * ⚠️ Dashed borders are not verified on every Android device. The words carry the meaning, so a device that draws the
 * border solid loses nothing but the hint.
 *
 * A presentational leaf: the caller chooses the words and the tone.
 *
 * @pattern Value Object contract (`StandInProps`) rendered as a pure `props → JSX` leaf — the chip a caller's Special
 *   Case draws; the caller decides when a value is absent and what stands in for it
 */
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { StandInProps } from './props.js';

/** The stand-in chip: dashed, and as wide as its words allow. */
export const StandIn: FC<StandInProps> = ({ tone, children }) => {
    const { colors } = useTheme();

    return (
        <View
            style={[
                styles.chip,
                tone === 'caution'
                    ? { borderColor: colors.attention, backgroundColor: colors.attentionTint }
                    : { borderColor: colors.inkMuted, backgroundColor: colors.paper },
            ]}
        >
            <Text style={[styles.label, { color: tone === 'caution' ? colors.ink : colors.inkMuted }]}>{children}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    chip: {
        alignSelf: 'flex-start',
        maxWidth: '100%',
        borderStyle: 'dashed',
        borderWidth: 1,
        borderRadius: nativeTokens.radius.sm,
        paddingHorizontal: nativeTokens.spacing[2],
        paddingVertical: 2,
    },
    // Colours come from the theme at render: neutral is an `inkMuted` edge and label on `paper`; caution is the
    // `attention` edge on the `attentionTint` fill under an `ink` label (the tint is a FILL, never a text colour).
    label: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500', flexShrink: 1 },
});
