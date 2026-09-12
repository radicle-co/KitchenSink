/**
 * @module @commise/ui/status-badge — the native chip that states a line's status (`Custom`, `Needs review`, …).
 *
 * The same contract as the web leaf. React Native's nested `Text` takes no reliable radius or padding, so the chip is
 * a `View` holding a `Text`, the mechanism `StandIn` uses: the job is kept, the mechanism differs.
 *
 * - ⛔ The words are the content: nothing here hides them from the screen reader.
 * - ⛔ Filled, never dashed: the dashed outline is `StandIn`'s mark for words standing in for a missing name.
 * - ⛔ No `numberOfLines`: the label wraps inside the chip and is never truncated.
 * - The radius is half the ONE-LINE height (§S13's rule, E2 I2), computed from the label's declared line height and
 *   the chip's padding. React Native does not scale a radius with the font, so at a large font scale a single line is
 *   a rounded rectangle too. The words always stay inside the curve.
 *
 * A presentational leaf: the caller chooses the words and the tone.
 *
 * @pattern Value Object contract (`StatusBadgeProps`) rendered as a pure `props → JSX` leaf, with the tone as a
 *   display derivation through a `Record` lookup
 */
import type { FC } from 'react';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { palette, tint } from '../tokens/colors.js';
import { nativeTokens } from '../tokens/native.js';
import type { StatusBadgeProps, StatusBadgeTone } from './props.js';

/** The label's leading: the caption ratio over the caption size, so "one line" is a known number. */
const LABEL_LINE_HEIGHT = nativeTokens.fontSize.caption * nativeTokens.lineHeight.caption;
/** The chip's vertical padding on each side, the web leaf's `py-0.5`. */
const PADDING_VERTICAL = 2;

/** The status badge: filled, and as wide as its words allow. */
export const StatusBadge: FC<StatusBadgeProps> = ({ tone, children }) => (
    <View style={[styles.chip, CHIP_TONE[tone]]}>
        <Text style={[styles.label, LABEL_TONE[tone]]}>{children}</Text>
    </View>
);

const styles = StyleSheet.create({
    chip: {
        alignSelf: 'flex-start',
        maxWidth: '100%',
        borderRadius: (LABEL_LINE_HEIGHT + PADDING_VERTICAL * 2) / 2,
        paddingHorizontal: nativeTokens.spacing[2],
        paddingVertical: PADDING_VERTICAL,
    },
    label: {
        flexShrink: 1,
        fontSize: nativeTokens.fontSize.caption,
        lineHeight: LABEL_LINE_HEIGHT,
    },
});

/** One fill per tone, so a new tone fails the build here as it does on web. */
const CHIP_TONE: Readonly<Record<StatusBadgeTone, ViewStyle>> = StyleSheet.create({
    neutral: { backgroundColor: palette.pearl },
    // ⛔ `warning` is a FILL under a charcoal label, never a text colour.
    caution: { backgroundColor: tint(palette.warning, 0.25) },
});

/** One label colour (and weight) per tone, the web leaf's pairs. */
const LABEL_TONE: Readonly<Record<StatusBadgeTone, TextStyle>> = StyleSheet.create({
    neutral: { color: palette.slate },
    caution: { color: palette.charcoal, fontWeight: '500' },
});
