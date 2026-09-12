/**
 * @module @commise/ui/stand-in — the web chip that stands where a missing value would be.
 *
 * A recipe line with no name shows `Private ingredient` in its name's place (`docs/design/namelessLineCopy.md` §2).
 * The dashed outline marks the words as a stand-in, so they cannot pass for a food called that; the words carry the
 * meaning, so the outline and tint are never the only signal (WCAG 1.4.1).
 *
 * ⛔ Plain text: no role, no `aria-label`, never `aria-hidden`. On a nameless line the chip IS the name, and text in
 * the list item is announced with the line.
 *
 * ⛔ It wraps at spaces inside itself and is never truncated or `nowrap`: at 320 px a stand-in beside a quantity has
 * the width of the name and no more.
 *
 * A presentational leaf: the caller chooses the words and the tone.
 *
 * @pattern Value Object contract (`StandInProps`) rendered as a pure `props → JSX` leaf — the chip a caller's Special
 *   Case draws; the caller decides when a value is absent and what stands in for it
 */
import type { FC } from 'react';

import type { StandInProps, StandInTone } from './props.js';

const TONE_CLASS: Readonly<Record<StandInTone, string>> = {
    // `slate` on the white card is 5.24:1.
    neutral: 'border-slate bg-card text-slate',
    // ⛔ `warning` is a FILL under a charcoal label (10.83:1 over white), never a text colour.
    caution: 'border-warning-dark bg-warning/25 text-charcoal',
};

/** The stand-in chip: inline, dashed, and as wide as its words allow. */
export const StandIn: FC<StandInProps> = ({ tone, children }) => (
    <span
        className={`inline-block max-w-full break-words rounded-sm border border-dashed px-2 py-0.5 text-body-sm font-medium ${TONE_CLASS[tone]}`}
    >
        {children}
    </span>
);
