/**
 * @module @commise/features-recipes/form — `NutritionPanelBody` (native): the web leaf's job in the row's bottom
 * sheet. The same sub-states, the same figure rows (`nutritionFigureRows`), the same copy. Presentational, like the web
 * leaf.
 *
 * Each figure row is ONE accessible element named "label value", so a screen reader reads a pair, not two orphans.
 *
 * @pattern Visitor — an exhaustive `switch` over `NutritionPanelState`
 */
import { Button } from '@commise/ui/button';
import { useLocale, useMessages } from '@commise/i18n/react';
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

    return (
        <View style={styles.panelFigures}>
            {nutritionFigureRows(figures, m, locale, dashMissing).map((row) => (
                <View
                    key={row.label}
                    accessible
                    accessibilityLabel={`${row.label} ${row.value}`}
                    style={styles.panelFigureRow}
                >
                    <Text style={styles.panelFigureLabel}>{row.label}</Text>
                    <Text style={styles.panelText}>{row.value}</Text>
                </View>
            ))}
        </View>
    );
};

/** The nutrition panel's body. */
export const NutritionPanelBody: FC<NutritionPanelBodyProps> = ({ state, onRetry }): ReactElement => {
    const m = useMessages(recipeFormMessages);

    switch (state.kind) {
        case 'loading':
            return (
                <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.panelText}>
                    {m.nutritionLoading}
                </Text>
            );
        case 'failed':
            return (
                <View style={styles.panelStack}>
                    <Text style={styles.panelText}>{m.nutritionLoadFailed}</Text>
                    <View style={styles.addAction}>
                        <Button variant="secondary" icon="refreshCw" onPress={onRetry}>
                            {m.statusActionRetry}
                        </Button>
                    </View>
                </View>
            );
        case 'noData':
            return <Text style={styles.panelText}>{m.nutritionNoneAvailable}</Text>;
        case 'noFigures':
            return <Text style={styles.panelText}>{m.nutritionNoFiguresResolved}</Text>;
        case 'userStated':
            return (
                <View style={styles.panelStack}>
                    <Text style={styles.panelText}>{m.nutritionUserStatedNote}</Text>
                    <FigureList figures={state.figures} dashMissing={false} m={m} />
                </View>
            );
        case 'figures':
            return (
                <View style={styles.panelStack}>
                    <Text style={styles.panelFigureLabel}>{m.nutritionBasis}</Text>
                    <FigureList figures={state.figures} dashMissing m={m} />
                    {state.partial && <Text style={styles.panelFigureLabel}>{m.nutritionFieldUnpublished}</Text>}
                </View>
            );
    }
};
