/**
 * @module @commise/features-recipes/form — `IngredientRowPanelBody` (native): what a row's panel says, by the row
 * policy's panel (`ingredientRowPanel.ts`). The React Native leaf of `./IngredientRowPanelBody.tsx`: the attention
 * line's sheet, the Food details sheet and the row editor's Food details all draw this one body. Calories live here,
 * never on the row (R30).
 *
 * Presentational: it draws the row view it is given; its actions are the row's.
 *
 * @pattern Visitor — an exhaustive `switch` over the panel body's discriminated union
 */
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import type { FC, ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../format/fillTemplate.js';
import type { IngredientRowPanelBodyProps } from './IngredientRowPanelBody.js';
import { nutritionPanelOf } from './nutritionPanel.js';
import { NutritionPanelBody } from './NutritionPanelBody.native.js';
import { ShortlistPanel } from './ShortlistPanel.js';

/** What a row's panel says. */
export const IngredientRowPanelBody: FC<IngredientRowPanelBodyProps> = ({ row, m, nutrition, close }): ReactElement => {
    const { colors } = useTheme();
    const { body } = row;
    const text = [styles.text, { color: colors.ink }];

    switch (body.kind) {
        case 'nutrition':
            return (
                <View style={styles.stack}>
                    {/* §S1: the sheet's title is the root's name, and the dotted line sits under it. */}
                    {row.variantParts !== undefined && <VariantPartsLine parts={row.variantParts} tone="secondary" />}
                    <NutritionPanelBody
                        state={nutritionPanelOf(row.line, nutrition.lookup)}
                        onRetry={nutrition.retry}
                    />
                </View>
            );
        case 'lookupFailed':
            // Try again closes the sheet, and the row says it is looking it up while the ask runs (busy rule 2).
            return row.retrying ? (
                <Text accessibilityLiveRegion="polite" style={text}>
                    {m.statusLookupRetrying}
                </Text>
            ) : (
                <View style={styles.stack}>
                    <Text style={text}>{m.statusExplainFailed}</Text>
                    <View style={styles.action}>
                        <Button
                            variant="secondary"
                            icon="refreshCw"
                            accessibilityLabel={fillTemplate(m.statusActionRetryLookupLabel, { food: row.triggerFood })}
                            onPress={() => {
                                close();
                                row.onRetryLookup();
                            }}
                        >
                            {m.statusActionRetry}
                        </Button>
                    </View>
                </View>
            );
        case 'explanation':
            return <Text style={text}>{m[body.key]}</Text>;
        case 'twoPaths':
            return (
                <Text style={text}>
                    {fillTemplate(m.errorPromptEntryMode, { createLabel: m.createCustomFoodIconLabel })}
                </Text>
            );
        case 'candidates':
        case 'shortlist':
            // Rows 6 and 7: what the food search finds for the line's own words; one pick binds this line.
            return <ShortlistPanel {...row.shortlist(close)} />;
        case 'foodRemovedNameless':
            return (
                <Text style={text}>
                    {fillTemplate(m.statusExplainFoodRemovedUnnamed, { changeFoodLabel: m.statusActionChangeFood })}
                </Text>
            );
    }
};

const styles = StyleSheet.create({
    stack: { gap: nativeTokens.spacing[2] },
    text: { ...nativeTokens.type.body },
    action: { flexDirection: 'row' },
});
