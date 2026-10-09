/**
 * @module @commise/features-recipes — one per-serving nutrition figure on the native recipe page (build spec §6.1):
 * the value in `figureStat` over its `caption` label, half a row wide so four make a 2 × 2. Presentational; colours
 * from the theme at render.
 */
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Props for {@link NutritionFigure}. */
export interface NutritionFigureProps {
    /** The figure's name ("Protein"). */
    readonly label: string;
    /** The figure, per serving ("32 g"). */
    readonly value: string;
}

/** The native nutrition figure. */
export const NutritionFigure: FC<NutritionFigureProps> = ({ label, value }) => {
    const { colors } = useTheme();

    return (
        <View style={styles.figure}>
            <Text style={[styles.value, { color: colors.ink }]}>{value}</Text>
            <Text style={[styles.label, { color: colors.inkMuted }]}>{label}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    figure: { flexBasis: '50%', gap: nativeTokens.spacing[1] },
    value: { ...nativeTokens.type.figureStat },
    label: { ...nativeTokens.type.caption },
});
