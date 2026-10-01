/**
 * @module @commise/ui/status-badge — the web chip that states a line's status (`Custom`, `Needs review`, …).
 *
 * It flows INSIDE the text it qualifies, never in a column beside it. A trailing `shrink-0` badge column left a
 * recipe line's name 37 px wide at 320 px and 0 px under 200% text (`docs/design/ingredientSpecialization.md` E2 I1),
 * so the caller places this inline in the name's text block and the badge wraps under the name instead.
 *
 * - ⛔ Plain text: no role, no `aria-label`, never `aria-hidden`. The words are announced with the line.
 * - ⛔ Filled, never dashed: the dashed outline is `StandIn`'s mark for words standing in for a missing name.
 * - ⛔ It wraps at spaces inside itself and is never truncated or `nowrap`.
 * - The radius is half the ONE-LINE height (§S13's rule, E2 I2): `0.5lh` plus one side's `py-0.5`. One line reads as
 *   a pill; a wrapped badge is a rounded rectangle whose words stay inside the curve.
 *
 * A presentational leaf: the caller chooses the words and the tone.
 *
 * @pattern Value Object contract (`StatusBadgeProps`) rendered as a pure `props → JSX` leaf, with the tone as a
 *   display derivation through a `Record` lookup
 */
import type { FC } from 'react';

import type { StatusBadgeProps, StatusBadgeTone } from './props.js';

const TONE_CLASS: Readonly<Record<StatusBadgeTone, string>> = {
    // `slate` on `pearl`: the badge's own fill, measured in the leaf test.
    neutral: 'bg-pearl text-slate',
    // ⛔ `warning` is a FILL under a charcoal label, never a text colour.
    caution: 'bg-warning/25 font-medium text-charcoal',
};

/** The status badge: inline, filled, and as wide as its words allow. */
export const StatusBadge: FC<StatusBadgeProps> = ({ tone, children }) => (
    <span
        className={`inline-block max-w-full break-words rounded-[calc(0.5lh+var(--spacing)*0.5)] px-2 py-0.5 text-caption ${TONE_CLASS[tone]}`}
    >
        {children}
    </span>
);
