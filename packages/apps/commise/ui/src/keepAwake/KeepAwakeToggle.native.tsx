/**
 * @module @commise/ui/keep-awake — the native design-system {@link KeepAwakeToggle} ("Screen on").
 *
 * A `switch` with `aria-checked`, drawn as the chip pill inside the chip's 44 pt (48 dp) hit area: the selected tint
 * while on, and the `sun` glyph filled, so the state never rests on colour alone. The name is always stated, because
 * react-native-web joins a pressable's texts and the icon-only display has no text at all.
 *
 * Native always has the capability (`useKeepAwakeAvailable.native.ts`), so this leaf always renders; the Null Object
 * contract lives in the web leaf, where the capability can be missing.
 */
import type { FC } from 'react';
import { Pressable, Text, View } from 'react-native';

import { chipHit, chipHitHeight, chipLabel, chipPill } from '../chip/chipStyle.js';
import { Icon } from '../icon/Icon.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import type { KeepAwakeToggleProps } from './props.js';

/** The native "Screen on" switch. */
export const KeepAwakeToggle: FC<KeepAwakeToggleProps> = ({ on, onChange, label, display }) => {
    const theme = useTheme();

    return (
        <Pressable
            role="switch"
            aria-checked={on}
            aria-label={label}
            onPress={() => onChange(!on)}
            style={[chipHit, { minHeight: chipHitHeight(), minWidth: chipHitHeight() }]}
        >
            {({ pressed }) => (
                <View style={[chipPill(theme, on, pressed), { justifyContent: 'center' }]}>
                    <Icon name="sun" size={16} filled={on} tone={on ? 'actionText' : 'ink'} />
                    {display === 'labelled' ? <Text style={chipLabel(theme, on)}>{label}</Text> : null}
                </View>
            )}
        </Pressable>
    );
};
