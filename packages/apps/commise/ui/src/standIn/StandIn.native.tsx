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

import { palette, tint } from '../tokens/colors.js';
import { nativeTokens } from '../tokens/native.js';
import type { StandInProps } from './props.js';

/** The stand-in chip: dashed, and as wide as its words allow. */
export const StandIn: FC<StandInProps> = ({ tone, children }) => (
    <View style={[styles.chip, tone === 'caution' ? styles.cautionChip : styles.neutralChip]}>
        <Text style={[styles.label, tone === 'caution' ? styles.cautionLabel : styles.neutralLabel]}>{children}</Text>
    </View>
);

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
    // `slate` on white is 5.24:1.
    neutralChip: { borderColor: palette.slate, backgroundColor: palette.white },
    // ⛔ `warning` is a FILL under a charcoal label, never a text colour; the border is `warning-dark`.
    cautionChip: { borderColor: palette['warning-dark'], backgroundColor: tint(palette.warning, 0.25) },
    label: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500', flexShrink: 1 },
    neutralLabel: { color: palette.slate },
    cautionLabel: { color: palette.charcoal },
});
