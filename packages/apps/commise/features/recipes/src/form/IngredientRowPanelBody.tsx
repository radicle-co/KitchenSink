'use client';

/**
 * @module @commise/features-recipes/form — `IngredientRowPanelBody` (web): what a row's panel says, by the row policy's
 * panel (`ingredientRowPanel.ts`). The attention line's popover, the Food details sheet and the row editor's Food details
 * all draw this one body, so a state cannot read one way in one place and another way in the next. Calories live here,
 * never on the row (R30).
 *
 * Presentational: it draws the row view it is given; its actions are the row's.
 *
 * @pattern Visitor — an exhaustive `switch` over the panel body's discriminated union
 */
import { Button } from '@commise/ui/button';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import type { FC, ReactElement } from 'react';

import { fillTemplate } from '../list/model.js';
import type { IngredientRowView } from './ingredientRowView.js';
import type { RecipeFormMessages } from './messages.js';
import type { IngredientNutrition } from './nutritionLookup.js';
import { nutritionPanelOf } from './nutritionPanel.js';
import { NutritionPanelBody } from './NutritionPanelBody.js';
import { ShortlistPanel } from './ShortlistPanel.js';

/** Props for {@link IngredientRowPanelBody}. */
export interface IngredientRowPanelBodyProps {
    readonly row: IngredientRowView;
    readonly m: RecipeFormMessages;
    readonly nutrition: IngredientNutrition;
    /** Close the surface the body sits in (a Try again or a pick that hands the work back to the row). */
    readonly close: () => void;
}

/** What a row's panel says. */
export const IngredientRowPanelBody: FC<IngredientRowPanelBodyProps> = ({ row, m, nutrition, close }): ReactElement => {
    const { body } = row;

    switch (body.kind) {
        case 'nutrition':
            return (
                <>
                    {/* §S1: the panel's heading is the root's name, and the dotted line sits under it. */}
                    {row.variantParts !== undefined && (
                        <span className="mb-2 block">
                            <VariantPartsLine parts={row.variantParts} tone="secondary" />
                        </span>
                    )}
                    <NutritionPanelBody
                        state={nutritionPanelOf(row.line, nutrition.lookup)}
                        onRetry={nutrition.retry}
                    />
                </>
            );
        case 'lookupFailed':
            // Try again hands the work to the row: the panel closes, and the row says it is looking it up while the ask
            // runs. While it runs, the panel says so and offers no second ask (V1 sign-off, busy rule 2).
            return row.retrying ? (
                <p role="status">{m.statusLookupRetrying}</p>
            ) : (
                <div className="flex flex-col items-start gap-2">
                    <p>{m.statusExplainFailed}</p>
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
                </div>
            );
        case 'explanation':
            return <p>{m[body.key]}</p>;
        case 'twoPaths':
            return <p>{fillTemplate(m.errorPromptEntryMode, { createLabel: m.createCustomFoodIconLabel })}</p>;
        case 'candidates':
        case 'shortlist':
            // Rows 6 and 7: what the food search finds for the line's own words, remote foods included; one pick binds
            // this line (SPECIFY.1 rows 6 and 7, S7 list contract P12).
            return <ShortlistPanel {...row.shortlist(close)} />;
        case 'foodRemovedNameless':
            return (
                <p>{fillTemplate(m.statusExplainFoodRemovedUnnamed, { changeFoodLabel: m.statusActionChangeFood })}</p>
            );
    }
};
