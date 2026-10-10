/**
 * @module @commise/features-account/profile/ProfileGroup — a grouped list of Profile rows (native): the settings-list
 * pattern (`docs/design/uiOverhaul/buildSpec.md` §9.1). The heading is a header-role `Text`; the card clips its rows to
 * the radius and draws a hairline between them. Colour comes from the theme at render.
 *
 * Presentational: props → JSX.
 */
import { useTheme } from '@commise/ui/theme';
import { nativeTokens } from '@commise/ui/native';
import { Children, isValidElement, type FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ProfileGroupProps } from './props.js';

/** A grouped list of rows. */
export const ProfileGroup: FC<ProfileGroupProps> = ({ heading, children }) => {
    const { colors } = useTheme();
    const rows = Children.toArray(children);

    return (
        <View style={styles.group}>
            {heading === undefined ? null : (
                <Text role="heading" aria-level={2} style={[styles.heading, { color: colors.ink }]}>
                    {heading}
                </Text>
            )}
            <View style={[styles.card, { backgroundColor: colors.paper }]}>
                {rows.map((row, index) => (
                    <View
                        key={isValidElement(row) ? (row.key ?? index) : index}
                        style={index === 0 ? null : [styles.divided, { borderTopColor: colors.lineDivider }]}
                    >
                        {row}
                    </View>
                ))}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    group: { gap: nativeTokens.spacing[2] },
    heading: { ...nativeTokens.type.sectionTitle },
    card: { borderRadius: nativeTokens.radius.lg, overflow: 'hidden' },
    divided: { borderTopWidth: StyleSheet.hairlineWidth },
});
