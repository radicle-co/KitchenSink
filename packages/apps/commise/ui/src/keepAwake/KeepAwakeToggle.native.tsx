/**
 * @module @commise/ui/keep-awake — the native design-system {@link KeepAwakeToggle} ("Screen on").
 *
 * A `switch` with `aria-checked`, drawn as the secondary Button pill and pressed through the same `PressScale` Button
 * uses, NOT a chip: it sets a mode, it does not filter a
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
import { StyleSheet, Text, View } from 'react-native';

import { BUTTON_PILL_LAYOUT, buttonToggleSurfacePaint } from '../button/surfacePaint.native.js';
import { Icon } from '../icon/Icon.native.js';
import { touchFloor } from '../layout/touchFloor.native.js';
import { PressScale } from '../pressScale/index.js';
import { useSurfaceTone } from '../surfaceTone/surfaceToneContext.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { KeepAwakeToggleProps } from './props.js';

/** The native "Screen on" switch. */
export const KeepAwakeToggle: FC<KeepAwakeToggleProps> = ({ on, onChange, label, display }) => {
    const theme = useTheme();
    const tone = useSurfaceTone();
    const { colors } = theme;
    const height = touchFloor();

    return (
        <View style={styles.hug}>
            <PressScale
                onPress={() => onChange(!on)}
                accessibilityRole="switch"
                checked={on}
                accessibilityLabel={label}
            >
                {({ pressed }) => (
                    <View
                        collapsable={false}
                        style={[
                            styles.pill,
                            {
                                minHeight: height,
                                minWidth: height,
                                borderRadius: height / 2,
                                ...buttonToggleSurfacePaint(theme, on, tone, pressed),
                            },
                        ]}
                    >
                        <Icon name="sun" size={20} filled={on} tone="ink" />
                        {display === 'labelled' ? (
                            <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
                        ) : null}
                    </View>
                )}
            </PressScale>
        </View>
    );
};

const styles = StyleSheet.create({
    // The control hugs its content, as it did when the pressable was the outer element; `PressScale` takes no style.
    hug: { alignSelf: 'flex-start' },
    pill: BUTTON_PILL_LAYOUT,
    label: nativeTokens.type.cardTitle,
});
