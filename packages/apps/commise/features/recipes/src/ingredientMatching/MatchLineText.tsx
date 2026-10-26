/**
 * @module @commise/features-recipes/ingredientMatching — `MatchLineText` (web): an ingredient line as the cook wrote it,
 * its measure set heavier than its words, as the ingredient-matching boards draw it, in the 16 px `body` role: the owner's
 * type-scale ruling (2026-10-25) sets the cook's line at 16 px in both phases (`PastedReadingRow` while it is read, this
 * once it is matched) and everything under it at 14. One block of text, so it reads as one line and can sit inside a
 * control, and it wraps rather than truncating.
 *
 * Presentational: props in, markup out. The native leaf is `./MatchLineText.native.tsx`.
 */
import type { FC } from 'react';

import type { MatchLineTextProps } from './matchLineTextProps.js';

/** The line as the cook wrote it. */
export const MatchLineText: FC<MatchLineTextProps> = ({ line }) => (
    <span className="block break-words text-body text-ink">
        {line.measure === '' ? null : <span className="font-semibold">{line.measure}</span>}
        {line.measure === '' ? null : ' '}
        {line.words}
    </span>
);
