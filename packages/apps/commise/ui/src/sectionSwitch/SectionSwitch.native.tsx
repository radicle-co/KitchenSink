/**
 * @module @commise/ui/section-switch — the native design-system {@link SectionSwitch}: the section links as `link`s
 * at least 44 pt tall, the current one in `ink` over the 3 pt `hereBar`, and one trailing control. A press jumps
 * through the screen's ONE scroll host (`useScrollHost().scrollToSection`, blueprint A7), the call the web leaf makes,
 * and is then reported. On Android the bar is a solid surface (D12); colours come from the theme at render.
 *
 * @pattern Mediator client — the switch asks the screen's scroll host for the jump
 */
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useScrollHost } from '../scrollHost/scrollHostContext.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { SectionSwitchProps } from './props.js';

/** The native section switch. */
export const SectionSwitch: FC<SectionSwitchProps> = ({ label, sections, currentId, trailing, onJump }) => {
    const { colors } = useTheme();
    const { scrollToSection } = useScrollHost();

    return (
        <View style={[styles.bar, { backgroundColor: colors.paper, borderBottomColor: colors.lineDivider }]}>
            <View collapsable={false} role="navigation" aria-label={label} style={styles.links}>
                {sections.map((section) => {
                    const current = section.id === currentId;

                    return (
                        <Pressable
                            key={section.id}
                            role="link"
                            aria-label={section.label}
                            {...(current ? { 'aria-current': 'location' as const } : {})}
                            onPress={() => {
                                scrollToSection(section.id);
                                onJump?.(section.id);
                            }}
                            style={styles.link}
                        >
                            <Text style={[styles.label, { color: current ? colors.ink : colors.inkMuted }]}>
                                {section.label}
                            </Text>
                            {current ? <View style={[styles.hereBar, { backgroundColor: colors.hereBar }]} /> : null}
                        </Pressable>
                    );
                })}
            </View>
            {trailing}
        </View>
    );
};

const styles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 48,
        gap: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[2],
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    links: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
    link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: nativeTokens.spacing[3] },
    label: { ...nativeTokens.type.label },
    hereBar: { position: 'absolute', bottom: 0, start: 12, end: 12, height: 3, borderRadius: 2 },
});
