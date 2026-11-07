/**
 * @module @commise/features-recipes/format — a preparation joined to the name before it, on the web (`prepJoiner.ts`).
 *
 * The eye reads "· melted" in the muted ink; a screen reader skips the dot and hears the hidden comma, "unsalted butter,
 * melted" (UI Designer). Native has no markup to share: its rows put `PREP_JOINER` in the text and name the row with a
 * comma in the `accessibilityLabel`.
 *
 * Presentational: props to text.
 */
import type { FC } from 'react';

import { PREP_JOINER } from './prepJoiner.js';

/** The preparation (or the notes standing in its place). */
export interface PrepJoinProps {
    readonly children: string;
}

export const PrepJoin: FC<PrepJoinProps> = ({ children }) => (
    <span className="text-ink-muted">
        <span aria-hidden="true">{PREP_JOINER}</span>
        <span className="sr-only">, </span>
        {children}
    </span>
);
