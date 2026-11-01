/**
 * @module @commise/features-recipes/editor — the native quiet note in Photos & publish about ingredient lines with no
 * match (owner D20); the mirror of `UnmatchedNote.tsx`. The sentence carries the meaning, and the `attention` role colours
 * it, so colour is never the only signal.
 *
 * Presentational: props → JSX.
 */
import { Text } from '@commise/ui/text';
import type { FC } from 'react';

import type { UnmatchedNoteProps } from './UnmatchedNote.js';

/** The native note. */
export const UnmatchedNote: FC<UnmatchedNoteProps> = ({ text }) => (
    <Text typeRole="caption" color="$attention">
        {text}
    </Text>
);
