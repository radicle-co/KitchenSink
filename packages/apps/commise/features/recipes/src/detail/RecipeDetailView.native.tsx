'use client';

/**
 * @module @commise/features-recipes — native recipe-detail view (T066 building block).
 *
 * The React Native leaf of the detail's ORCHESTRATION SHELL: it binds the SAME session serving-scale store and hook
 * the web shell binds, and hands the pure render (`RecipeDetailBody.native.tsx`) the count to render at. Keeping the
 * binding here rather than in `RecipeDetailScreen` is what makes it impossible for one platform to ship the detail
 * with the scale inert.
 *
 * It also owns the Data sources sheet that the nutrition note's link opens (curated U15;
 * `docs/design/ingredientSpecialization.md` §S16): native has no router, so the page is a full-screen sheet over the
 * recipe, and the cook returns to the same place. Owned here for the reason the scale is: no screen can mount the
 * detail with the link inert.
 *
 * @pattern Orchestration shell over the Humble Object render half — the same binding as the web shell, kept here
 *     rather than in the screen so one platform cannot ship the detail with the scale inert.
 */
import { useState, type FC } from 'react';

import { DataSourcesScreen } from '../dataSources/DataSourcesScreen.native.js';
import { RecipeDetailBody } from './RecipeDetailBody.native.js';
import { useServingScale } from './useServingScale.js';
import type { RecipeDetailViewProps } from './model.js';

/**
 * The ORCHESTRATION shell (native): binds the session serving-scale store — the SAME store and hook the web leaf
 * uses — and hands the pure body a scaled projection, and opens and closes the Data sources sheet.
 */
export const RecipeDetailView: FC<RecipeDetailViewProps> = (props) => {
    const scale = useServingScale(props.recipe.id, props.recipe.servings);
    const [sourcesOpen, setSourcesOpen] = useState(false);
    const [sourcesClosed, setSourcesClosed] = useState(0);

    return (
        <>
            <RecipeDetailBody
                {...props}
                servings={scale.servings}
                onServingsChange={scale.setServings}
                onOpenDataSources={() => setSourcesOpen(true)}
                dataSourcesReturnFocusSignal={sourcesClosed}
            />
            {sourcesOpen ? (
                <DataSourcesScreen
                    onRequestClose={() => {
                        setSourcesOpen(false);
                        setSourcesClosed((count) => count + 1);
                    }}
                />
            ) : null}
        </>
    );
};
