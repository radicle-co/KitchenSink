/**
 * @module @commise/features-recipes — the recipe Home widget's LOADING card (building block).
 *
 * **Pattern: Null Object for the widget's pending phase.** One titled card whose body is the placeholder
 * grid — what the recipe widget looks like before its recipes are known. Platform-neutral by composition: it
 * touches no DOM and no React Native primitive, only the two building blocks whose specifiers resolve to the
 * web (`*.tsx`) or native (`*.native.tsx`) leaf at bundle time, so both platforms wait in the same shape.
 *
 * ⛔ IT LIVES HERE, NOT IN A WIDGET ENTRY, BECAUSE THREE LAYERS RENDER IT and they must not drift: the web
 * entry's `<Suspense>` fallback, the native entry's `isLoading` branch, and — on web — the HOST slot, whose
 * inner container has to resolve the recipes before it can start the deferred calorie batch (ADR-0021 §6)
 * and therefore owns a boundary of its own that suspends ABOVE the widget. Composing "titled card + N
 * placeholders" separately in each of those is one piece of knowledge in three places, and the widget entry
 * cannot be the single source: it is the code-SPLIT chunk, so importing its fallback statically would pull
 * the whole widget into the host's bundle and defeat the split it exists for.
 */
import type { FC } from 'react';

import { useMessages } from '@commise/i18n/react';

import { recipeMessages } from '../messages.js';
import { RecipeWidgetCard } from './RecipeWidgetCard.js';
import { RecipeWidgetSkeleton } from './RecipeWidgetSkeleton.js';
import { MAX_RECENT_RECIPES } from './props.js';

/**
 * The recipe Home widget while its recipes are still in flight: the widget's own titled card with one
 * placeholder row per card it is about to show.
 *
 * The card keeps its TITLE while loading on purpose — the section is identifiable to a reader (and to a test)
 * from the first frame, and the header does not pop in underneath the content when the data lands.
 *
 * @returns The titled widget card wrapping the placeholder rows.
 */
export const RecipeWidgetLoadingCard: FC = () => {
    const { widgetTitle } = useMessages(recipeMessages);

    return (
        <RecipeWidgetCard title={widgetTitle}>
            <RecipeWidgetSkeleton itemCount={MAX_RECENT_RECIPES} />
        </RecipeWidgetCard>
    );
};
