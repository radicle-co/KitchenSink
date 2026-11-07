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

import { Text } from '../text/Text.native.js';
import type { TypeRole } from '../tokens/typography.js';
import type { VariantPartsLineProps, VariantPartsTone } from './props.js';
import { PART_SEPARATOR, partRuns, spokenVariantParts } from './variantPartsText.js';

const NON_BREAKING_HYPHEN = '\u2011';

/** A part as the eye sees it: each measurement token's hyphen made non-breaking. Pure. */
function shownPart(part: string): string {
    return partRuns(part)
        .map((run) => (run.measurement ? run.text.replace('-', NON_BREAKING_HYPHEN) : run.text))
        .join('');
}

/**
 * Each tone's type role and colour token, so a new tone fails the build here as well. A role carries its px leading
 * (E2 I14) and its 2× ceiling (ADR-0080 §8): `secondary` is `meta` (14 / 20) and `primary` is `body` (16 / 24).
 */
const TONE: Readonly<Record<VariantPartsTone, { readonly typeRole: TypeRole; readonly color: '$inkMuted' | '$ink' }>> =
    {
        secondary: { typeRole: 'meta', color: '$inkMuted' },
        primary: { typeRole: 'body', color: '$ink' },
    };

/** The dotted line, in one wrapping `Text`. */
export const VariantPartsLine: FC<VariantPartsLineProps> = ({ parts, tone }) => (
    <Text aria-label={spokenVariantParts(parts)} {...TONE[tone]}>
        {parts.map(shownPart).join(`${PART_SEPARATOR} `)}
    </Text>
);
