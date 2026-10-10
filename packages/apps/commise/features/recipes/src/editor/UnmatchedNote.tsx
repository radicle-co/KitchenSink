/**
 * @module @commise/features-recipes/editor — the quiet note in Photos & publish about ingredient lines with no match
 * (owner D20, build spec §7.2): "Ready to publish. 2 ingredients have no match, so their nutrition is left out."
 *
 * The sentence carries the meaning, so colour is never the only signal; the `attention` role colours its words (the
 * design system's attention line, `text-attention`). Not a live region: the action bar's ready line is the one that
 * announces, and the note only sits where the cook reads on to the visibility choice.
 *
 * Presentational: props → JSX. The native leaf is `./UnmatchedNote.native.tsx`.
 */
import type { FC } from 'react';

/** Props for `UnmatchedNote`. */
export interface UnmatchedNoteProps {
    /** The sentence `publishNoteOf` returns. */
    readonly text: string;
}

/** The web note. */
export const UnmatchedNote: FC<UnmatchedNoteProps> = ({ text }) => (
    <p className="text-caption text-attention">{text}</p>
);
