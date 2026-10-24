'use client';

/**
 * @module @commise/features-recipes/list — how My recipes presents itself: the list/grid view, the card variant that
 * view and the container class decide, and how the chips lay out.
 *
 * Web and mobile each derived the same three values from the same two inputs. What differs is where the cook's CHOICE
 * is kept (a cookie the server reads on web, device storage on mobile), so the host owns that and passes it in.
 *
 * @pattern Headless hook — a projection of the cook's stored choice and the measured container
 */
import type { ChipRowOverflow } from '@commise/ui/chip';

import { cardVariantOf, type CardVariant, type ListViewMode } from '../card/cardVariant.js';
import { useMainContainerClass } from '../layout/useMainContainerClass.js';
import { viewModeOf } from './viewModePreference.js';

/** What the library renders from its container and the cook's choice. */
export interface RecipeListPresentation {
    readonly viewMode: ListViewMode;
    readonly variant: CardVariant;
    readonly chipOverflow: ChipRowOverflow;
}

/**
 * Decide the library's presentation.
 *
 * @param viewChoice - The cook's stored list/grid choice, or `undefined` before they have made one.
 * @returns The view, the card variant and the chip layout.
 */
export function useRecipeListPresentation(viewChoice: ListViewMode | undefined): RecipeListPresentation {
    const container = useMainContainerClass();
    const viewMode = viewModeOf(viewChoice, container);

    return {
        viewMode,
        variant: cardVariantOf(container, viewMode, 'library'),
        chipOverflow: container === 'narrow' ? 'scroll' : 'wrap',
    };
}
