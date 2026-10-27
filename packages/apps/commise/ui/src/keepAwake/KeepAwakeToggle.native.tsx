/**
 * @module @commise/ui/keep-awake — the native design-system {@link KeepAwakeToggle} ("Screen on").
 *
 * A `switch` with `aria-checked`, drawn as the secondary Button pill, NOT a chip: it sets a mode, it does not filter a
 * list (`componentFixes` issue 6). The pill is the touch floor tall (44 pt, 48 dp on Android) with a 1 pt outline: paper
 * and `lineControl` while off, the `selectedFill` and `selectedEdge` while on, at the SAME edge width so turning it on
 * moves nothing around it. The label is the 16/20/600 `cardTitle` in `ink`, and the `sun` glyph is filled while on, so
 * the state never rests on colour alone. The name is always stated, because react-native-web joins a pressable's texts
 * and the icon-only display has no text at all.
 *
 * Native always has the capability (`useKeepAwakeAvailable.native.ts`), so this leaf always renders; the Null Object
 * contract lives in the web leaf, where the capability can be missing.
 */
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../icon/Icon.native.js';
import { touchFloor } from '../layout/touchFloor.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { KeepAwakeToggleProps } from './props.js';

/** The native "Screen on" switch. */
export const KeepAwakeToggle: FC<KeepAwakeToggleProps> = ({ on, onChange, label, display }) => {
    const { colors } = useTheme();
    const height = touchFloor();

    return (
        <Pressable role="switch" aria-checked={on} aria-label={label} onPress={() => onChange(!on)} style={styles.hit}>
            {({ pressed }) => (
                <View
                    collapsable={false}
                    style={[
                        styles.pill,
                        {
                            minHeight: height,
                            minWidth: height,
                            borderRadius: height / 2,
                            backgroundColor: on ? colors.selectedFill : pressed ? colors.surfaceMuted : colors.paper,
                            borderColor: on ? colors.selectedEdge : colors.lineControl,
                        },
                    ]}
                >
                    <Icon name="sun" size={20} filled={on} tone="ink" />
                    {display === 'labelled' ? <Text style={[styles.label, { color: colors.ink }]}>{label}</Text> : null}
                </View>
            )}
        </Pressable>
    );
};

const styles = StyleSheet.create({
    hit: { alignSelf: 'flex-start' },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: nativeTokens.spacing[2],
        // Button's inline step (12), so the two pills read as one family.
        paddingHorizontal: nativeTokens.spacing[3],
        borderWidth: 1,
    },
    label: nativeTokens.type.cardTitle,
});
