/**
 * @module @commise/ui/avatar — the native design-system {@link Avatar}: the profile entry (`buildSpec.md` §3.3, §3.8).
 * A `Pressable` button in a 44 pt target around the disc, which is `AvatarDisc` at either size.
 *
 * Presentational: props → JSX.
 *
 * @pattern Visitor — an exhaustive switch over the disc's three faces
 */
import type { FC } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { touchFloor } from '../layout/touchFloor.native.js';
import { AvatarDisc } from './AvatarDisc.native.js';
import type { AvatarProps } from './props.js';

/** The native design-system avatar. */
export const Avatar: FC<AvatarProps> = ({ status, initials, label, onPress, size }) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.target}>
        <AvatarDisc status={status} initials={initials} {...(size === undefined ? {} : { size })} />
    </Pressable>
);

const styles = StyleSheet.create({
    target: { minWidth: touchFloor(), minHeight: touchFloor(), alignItems: 'center', justifyContent: 'center' },
});
