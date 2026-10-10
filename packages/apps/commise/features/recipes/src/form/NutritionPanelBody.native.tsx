/**
 * @module @commise/features-recipes/form — `NutritionPanelBody` (native): the web leaf's job in the row's bottom
 * sheet. The same sub-states, the same figure rows (`nutritionFigureRows`), the same copy. Presentational, like the web
 * leaf. Colour comes from the theme at render (D15): body copy in `ink`, a figure's label in `inkMuted`.
 *
 * Each figure row is ONE accessible element named "label value", so a screen reader reads a pair, not two orphans.
 *
 * @pattern Visitor — an exhaustive `switch` over `NutritionPanelState`
 */
import { Button } from '@commise/ui/button';
import { useLocale, useMessages } from '@commise/i18n/react';
import { useTheme } from '@commise/ui/theme';
import type { FC, ReactElement } from 'react';
import { Text, View } from 'react-native';

import { styles } from './formSectionStyles.native.js';
import { recipeFormMessages, type RecipeFormMessages } from './messages.js';
import type { LineFigures } from './nutrition.js';
import { nutritionFigureRows } from './nutritionFigureRows.js';
import type { NutritionPanelBodyProps } from './NutritionPanelBody.js';

const FigureList: FC<{
    readonly figures: LineFigures;
    readonly dashMissing: boolean;
    readonly m: RecipeFormMessages;
}> = ({ figures, dashMissing, m }) => {
    const locale = useLocale();
    const { colors } = useTheme();

    return (
        <View style={styles.panelFigures}>
            {nutritionFigureRows(figures, m, locale, dashMissing).map((row) => (
                <View
                    key={row.label}
                    accessible
                    accessibilityLabel={`${row.label} ${row.value}`}
                    style={styles.panelFigureRow}
                >
                    <Text style={[styles.panelFigureLabel, { color: colors.inkMuted }]}>{row.label}</Text>
                    <Text style={[styles.panelText, { color: colors.ink }]}>{row.value}</Text>
                </View>
            ))}
        </View>
    );
};

/** The nutrition panel's body. */
export const NutritionPanelBody: FC<NutritionPanelBodyProps> = ({ state, onRetry }): ReactElement => {
    const m = useMessages(recipeFormMessages);
    const { colors } = useTheme();
    const text = [styles.panelText, { color: colors.ink }];
    const label = [styles.panelFigureLabel, { color: colors.inkMuted }];

    switch (state.kind) {
        case 'loading':
            return (
                <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={text}>
                    {m.nutritionLoading}
                </Text>
            );
        case 'failed':
            return (
                <View style={styles.panelStack}>
                    <Text style={text}>{m.nutritionLoadFailed}</Text>
                    <View style={styles.addAction}>
                        <Button variant="secondary" icon="refreshCw" onPress={onRetry}>
                            {m.statusActionRetry}
                        </Button>
                    </View>
                </View>
            );
        case 'noData':
            return <Text style={text}>{m.nutritionNoneAvailable}</Text>;
        case 'noFigures':
            return <Text style={text}>{m.nutritionNoFiguresResolved}</Text>;
        case 'userStated':
            return (
                <View style={styles.panelStack}>
                    <Text style={text}>{m.nutritionUserStatedNote}</Text>
                    <FigureList figures={state.figures} dashMissing={false} m={m} />
                </View>
            );
        case 'figures':
            return (
                <View style={styles.panelStack}>
                    <Text style={label}>{m.nutritionBasis}</Text>
                    <FigureList figures={state.figures} dashMissing m={m} />
                    {state.partial && <Text style={label}>{m.nutritionFieldUnpublished}</Text>}
                </View>
            );
    }
};
