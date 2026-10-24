/**
 * @module @commise/ui/avatar — the native design-system {@link Avatar}: the profile entry (`buildSpec.md` §3.3, §3.8).
 * A `Pressable` button in a 44 pt target around the 32 pt disc. The disc is `AvatarDisc`.
 *
 * Presentational: props → JSX.
 *
 * @pattern Visitor — an exhaustive switch over the disc's three faces
 */
import type { FC } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { AvatarDisc } from './AvatarDisc.native.js';
import type { AvatarProps } from './props.js';

/** The native design-system avatar. */
export const Avatar: FC<AvatarProps> = ({ status, initials, label, onPress }) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.target}>
        <AvatarDisc status={status} initials={initials} />
    </Pressable>
);

const styles = StyleSheet.create({
    target: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
