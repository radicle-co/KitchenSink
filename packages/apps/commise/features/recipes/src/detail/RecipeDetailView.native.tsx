'use client';

/**
 * @module @commise/features-recipes — native recipe-detail view (T066 building block).
 *
 * The React Native leaf of the recipe page's ORCHESTRATION SHELL: it binds the SAME session state the web shell binds
 * — the serving scale, the cook's marks (`useCookMarks`), the one "Screen on" state with its keep-awake hold, and the
 * description's disclosure — and measures the layout from the window (`detailNativeLayoutOf`), because the pure body
 * takes no dimension hook. Keeping the bindings here rather than in `RecipeDetailScreen` is what makes it impossible
 * for one platform to ship the page with any of them inert.
 *
 * It also owns the Data sources sheet that the nutrition note's link opens (curated U15;
 * `docs/design/ingredientSpecialization.md` §S16): native has no router, so the page is a full-screen sheet over the
 * recipe, and the cook returns to the same place.
 *
 * @pattern Orchestration shell over the Humble Object render half — the same bindings as the web shell, kept here
 *     rather than in the screen so one platform cannot ship the page with any of them inert.
 */
import { useKeepAwake } from '@commise/ui/keep-awake';
import { nativeTokens } from '@commise/ui/native';
import { useState, type FC } from 'react';
import { useWindowDimensions } from 'react-native';

import { DataSourcesScreen } from '../dataSources/DataSourcesScreen.native.js';
import { detailNativeLayoutOf } from './detailFacts.js';
import { RecipeDetailBody } from './RecipeDetailBody.native.js';
import { useCookMarks } from './useCookMarks.js';
import { useServingScale } from './useServingScale.js';
import type { RecipeDetailViewProps } from './model.js';

/** The page's gutters on each side, in points. */
const GUTTER = nativeTokens.spacing[4];

/** The native orchestration shell of the recipe page. */
export const RecipeDetailView: FC<RecipeDetailViewProps> = (props) => {
    const scale = useServingScale(props.recipe.id, props.recipe.servings);
    const marks = useCookMarks(props.recipe.id);
    const { width } = useWindowDimensions();
    const [screenOn, setScreenOn] = useState(false);
    const [descriptionExpanded, setDescriptionExpanded] = useState(false);
    const [sourcesOpen, setSourcesOpen] = useState(false);
    const [sourcesClosed, setSourcesClosed] = useState(0);

    useKeepAwake(screenOn);

    return (
        <>
            <RecipeDetailBody
                {...props}
                servings={scale.servings}
                onServingsChange={scale.setServings}
                marks={marks}
                screenOn={{ on: screenOn, onChange: setScreenOn }}
                descriptionExpanded={descriptionExpanded}
                onToggleDescription={() => setDescriptionExpanded((expanded) => !expanded)}
                layout={detailNativeLayoutOf(width - 2 * GUTTER)}
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
