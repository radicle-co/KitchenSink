'use client';

/**
 * @module @commise/features-recipes — web recipe-detail view (T066 building block).
 *
 * The ORCHESTRATION SHELL of the recipe page, and nothing else: it binds what the page holds for the cook — the
 * session serving scale, the cook's marks (`useCookMarks`, blueprint A13), the one "Screen on" state with its wake
 * lock (A20), and the description's disclosure — and hands the pure render (`RecipeDetailBody.tsx`) the result. The
 * public contract (`RecipeDetailViewProps`) carries none of them, which is the point: an app composes this and cannot
 * ship the page with the scale, the checks or Screen on un-wired, because there is nothing for it to wire.
 *
 * Screen on defaults to off on each visit and is released when the cook leaves the page (the hold's effect cleanup).
 *
 * @pattern Orchestration shell over the Humble Object render half — it binds the page's session state and hands
 *     `RecipeDetailBody` the result, so the public contract cannot be composed with any of it un-wired.
 */
import { useMessages } from '@commise/i18n/react';
import { useKeepAwake, useKeepAwakeAvailable } from '@commise/ui/keep-awake';
import { useEffect, useState, type FC } from 'react';

import { recipeMessages } from '../messages.js';

import { RecipeDetailBody } from './RecipeDetailBody.js';
import { useCookMarks } from './useCookMarks.js';
import { useServingScale } from './useServingScale.js';
import type { RecipeDetailViewProps } from './model.js';

/** The web orchestration shell of the recipe page. */
export const RecipeDetailView: FC<RecipeDetailViewProps> = (props) => {
    const scale = useServingScale(props.recipe.id, props.recipe.servings);
    const marks = useCookMarks(props.recipe.id);
    const { detail } = useMessages(recipeMessages);
    const [screenOn, setScreenOn] = useState(false);
    // The one-time hint (§6.3): shown until the cook uses the toggle or scrolls. Held per visit, in no storage.
    const [hintSeen, setHintSeen] = useState(false);
    const [descriptionExpanded, setDescriptionExpanded] = useState(false);
    // A hint for a control the browser cannot offer is noise: the toggle renders nothing without the Wake Lock API.
    const canKeepAwake = useKeepAwakeAvailable();

    useKeepAwake(screenOn);

    // @sideEffect Subscribes to the window's scroll (the document is the web page's scroller). The first scroll is the cook
    // getting on with the recipe: the hint has done its job.
    useEffect(() => {
        const onScroll = (): void => setHintSeen(true);

        window.addEventListener('scroll', onScroll, { once: true, passive: true });

        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    return (
        <RecipeDetailBody
            {...props}
            servings={scale.servings}
            onServingsChange={scale.setServings}
            marks={marks}
            screenOn={{
                on: screenOn,
                onChange: (on) => {
                    setScreenOn(on);
                    setHintSeen(true);
                },
                ...(hintSeen || !canKeepAwake ? {} : { hint: detail.screenOnHint }),
            }}
            descriptionExpanded={descriptionExpanded}
            onToggleDescription={() => setDescriptionExpanded((expanded) => !expanded)}
        />
    );
};
