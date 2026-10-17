/**
 * @module @commise/features-recipes/editor — the native quiet note in Photos & publish about ingredient lines with no
 * match (owner D20); the mirror of `UnmatchedNote.tsx`. The sentence carries the meaning, and the `attention` role colours
 * it, so colour is never the only signal.
 *
 * Presentational: props → JSX.
 */
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text } from 'react-native';

import type { UnmatchedNoteProps } from './UnmatchedNote.js';

/** The native note. */
export const UnmatchedNote: FC<UnmatchedNoteProps> = ({ text }) => {
    const { colors } = useTheme();

    return <Text style={[styles.note, { color: colors.attention }]}>{text}</Text>;
};

const styles = StyleSheet.create({
    note: { ...nativeTokens.type.meta },
});
