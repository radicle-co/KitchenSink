/**
 * @module @commise/features-recipes/form — `NutritionPanelBody` (web): the body of a matched or declared row's status
 * panel — every sub-state of `ingredientStatusExplanation.md` §6b and SPECIFY.4 — rendered from `nutritionPanelOf`
 * (`./nutritionPanel.ts`). Presentational, pure `props → JSX`: the read and its retry belong to the editor
 * (`useLineNutrition`).
 *
 * - An unpublished figure is an em dash with ONE footnote, never `0` and never a hidden row.
 * - The cook's own figures are labelled as theirs and show only what they stated: an unstated figure is not one food
 *   failed to publish, so it gets no dash and no footnote.
 *
 * @pattern Visitor — an exhaustive `switch` over `NutritionPanelState`
 */
import { Button } from '@commise/ui/button';
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { recipeFormMessages, type RecipeFormMessages } from './messages.js';
import type { LineFigures } from './nutrition.js';
import { nutritionFigureRows } from './nutritionFigureRows.js';
import type { NutritionPanelState } from './nutritionPanel.js';

/** Props for {@link NutritionPanelBody} (web and native). */
export interface NutritionPanelBodyProps {
    readonly state: NutritionPanelState;
    /** Read again (the failed state's Try again). */
    readonly onRetry: () => void;
}

/** The figures as a definition list: label, then value. */
const FigureList: FC<{
    readonly figures: LineFigures;
    readonly dashMissing: boolean;
    readonly m: RecipeFormMessages;
}> = ({ figures, dashMissing, m }) => {
    const locale = useLocale();

    return (
        <dl className="mt-1 grid grid-cols-[auto_auto] justify-start gap-x-4 gap-y-0.5">
            {nutritionFigureRows(figures, m, locale, dashMissing).map((row) => (
                <div key={row.label} className="contents">
                    <dt className="text-ink-muted">{row.label}</dt>
                    <dd className="font-medium">{row.value}</dd>
                </div>
            ))}
        </dl>
    );
};

/** The nutrition panel's body. */
export const NutritionPanelBody: FC<NutritionPanelBodyProps> = ({ state, onRetry }): ReactElement => {
    const m = useMessages(recipeFormMessages);

    switch (state.kind) {
        case 'loading':
            return <p role="status">{m.nutritionLoading}</p>;
        case 'failed':
            return (
                <div className="flex flex-col items-start gap-2">
                    <p>{m.nutritionLoadFailed}</p>
                    <Button variant="secondary" icon="refreshCw" onPress={onRetry}>
                        {m.statusActionRetry}
                    </Button>
                </div>
            );
        case 'noData':
            return <p>{m.nutritionNoneAvailable}</p>;
        case 'noFigures':
            return <p>{m.nutritionNoFiguresResolved}</p>;
        case 'userStated':
            return (
                <div>
                    <p>{m.nutritionUserStatedNote}</p>
                    <FigureList figures={state.figures} dashMissing={false} m={m} />
                </div>
            );
        case 'figures':
            return (
                <div>
                    <p className="text-caption text-ink-muted">{m.nutritionBasis}</p>
                    <FigureList figures={state.figures} dashMissing m={m} />
                    {state.partial && <p className="mt-1 text-caption text-ink-muted">{m.nutritionFieldUnpublished}</p>}
                </div>
            );
    }
};
