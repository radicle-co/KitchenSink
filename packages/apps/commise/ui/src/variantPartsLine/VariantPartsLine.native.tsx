/**
 * @module @commise/ui/variant-parts-line — the native line that shows a variant's parts with a middle dot between
 * them. The same contract and rules as the web leaf (`docs/design/ingredientSpecialization.md` §S4), drawn in one
 * `Text`:
 * - React Native has no visually hidden span, so the screen reader hears the `accessibilityLabel`:
 *   `spokenVariantParts`, the source parts joined with commas.
 * - A measurement token's hyphen shows as U+2011 (a non-breaking hyphen), so it never splits there. The label keeps
 *   the source hyphen, so the screen reader says the text the catalog wrote.
 * - React Native has no per-span language, so the parts are not marked English. Recorded, not solved.
 * - ⛔ No `numberOfLines` and no `ellipsizeMode`: the line wraps and is never truncated.
 *
 * A presentational leaf: the caller maps the wire parts to their text and places the line.
 *
 * @pattern Value Object contract (`VariantPartsLineProps`) rendered as a pure `props → JSX` leaf, over the
 *   `isMeasurementToken` Specification it shares with the web leaf
 */
import type { FC } from 'react';
import { StyleSheet, Text, type TextStyle } from 'react-native';

import { palette } from '../tokens/colors.js';
import { nativeTokens } from '../tokens/native.js';
import type { VariantPartsLineProps, VariantPartsTone } from './props.js';
import { PART_SEPARATOR, partRuns, spokenVariantParts } from './variantPartsText.js';

const NON_BREAKING_HYPHEN = '\u2011';

/** A part as the eye sees it: each measurement token's hyphen made non-breaking. Pure. */
function shownPart(part: string): string {
    return partRuns(part)
        .map((run) => (run.measurement ? run.text.replace('-', NON_BREAKING_HYPHEN) : run.text))
        .join('');
}

/** The dotted line, in one wrapping `Text`. */
export const VariantPartsLine: FC<VariantPartsLineProps> = ({ parts, tone }) => (
    <Text accessibilityLabel={spokenVariantParts(parts)} style={TONE_STYLE[tone]}>
        {parts.map(shownPart).join(`${PART_SEPARATOR} `)}
    </Text>
);

/**
 * One style per tone, so a new tone fails the build here as it does on web. Each sets the body leading, size × 1.5
 * (E2 I14): web inherits the body's 1.5, and React Native's default of about 1.2 read tight over up to eight lines.
 */
const TONE_STYLE: Readonly<Record<VariantPartsTone, TextStyle>> = StyleSheet.create({
    // `slate` on white is 5.24:1. The dot takes the text colour.
    secondary: {
        color: palette.slate,
        fontSize: nativeTokens.fontSize.bodySm,
        lineHeight: nativeTokens.fontSize.bodySm * nativeTokens.lineHeight.body,
    },
    primary: {
        color: palette.charcoal,
        fontSize: nativeTokens.fontSize.bodyMd,
        lineHeight: nativeTokens.fontSize.bodyMd * nativeTokens.lineHeight.body,
    },
});
