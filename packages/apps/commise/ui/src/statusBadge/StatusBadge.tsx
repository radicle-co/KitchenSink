/**
 * @module @commise/ui/status-badge — the web badge that states a status (`Draft`, `Custom`, `Needs review`, …).
 *
 * It flows INSIDE the text it qualifies, never in a column beside it. A trailing `shrink-0` badge column left a
 * recipe line's name 37 px wide at 320 px and 0 px under 200% text (`docs/design/ingredientSpecialization.md` E2 I1),
 * so the caller places this inline in the text block and the badge wraps under it instead.
 *
 * - ⛔ Plain text: no role, no `aria-label`, never `aria-hidden`. The words are announced with the line; a recipe
 *   status's glyph is decorative, and is what keeps the status from resting on colour (SC 1.4.1).
 * - ⛔ Filled, never dashed: the dashed outline is `StandIn`'s mark for words standing in for a missing name.
 * - ⛔ It wraps at spaces inside itself and is never truncated or `nowrap`.
 * - 24 px tall with the `sm` radius (§1.6): it is not pressable, so it is never a pill.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Registry consumer — the status picks its pair and glyph from closed `Record`s (`BADGE_GLYPH`, the tones)
 */
import type { FC } from 'react';

import { Icon } from '../icon/Icon.js';
import { BADGE_GLYPH, type BadgeStatus, type StatusBadgeProps } from './props.js';

/**
 * A neutral badge (`componentFixes.md` §7): `paper` with a 1 px `lineDivider` edge under `inkMuted`, so it reads on the
 * canvas, on paper and on `surfaceMuted` alike. A `surfaceMuted` fill vanished on a `surfaceMuted` parent.
 */
const NEUTRAL_CLASS = 'border border-line-divider bg-paper text-ink-muted';

/**
 * Each status's fill and label (§1.4), as roles so they re-theme (D15). The recipe statuses, `soon` and a note are
 * neutral ({@link NEUTRAL_CLASS}), never amber; PRO is the grey `pro` pair, slate under snow in light and a light grey
 * under charcoal in dark (`componentFixes.md` §7). ⛔ `attention` is the recorded fallback, an `ink`
 * label on the `attentionTint`: the spec's `attention` text measured below 4.5:1 on its own tint.
 */
const STATUS_CLASS: Readonly<Record<BadgeStatus, string>> = {
    draft: NEUTRAL_CLASS,
    private: NEUTRAL_CLASS,
    public: NEUTRAL_CLASS,
    pro: 'bg-pro-fill text-pro-ink',
    soon: NEUTRAL_CLASS,
    note: NEUTRAL_CLASS,
    attention: 'bg-attention-tint text-ink',
};

/** The status badge: inline, filled, and as wide as its words allow. */
export const StatusBadge: FC<StatusBadgeProps> = ({ status, children }) => {
    const glyph = BADGE_GLYPH[status];

    return (
        <span
            className={`inline-flex min-h-6 max-w-full items-center gap-1 rounded-sm px-2 py-0.5 text-caption ${STATUS_CLASS[status]}`}
        >
            {glyph === null ? null : <Icon name={glyph} size={16} />}
            <span className="min-w-0 break-words">{children}</span>
        </span>
    );
};
