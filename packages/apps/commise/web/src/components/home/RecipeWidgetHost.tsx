'use client';

/**
 * @module home/RecipeWidgetHost — the Home surface's render-map entry for the recipe widget (web).
 *
 * The render map needs a `ComponentType`, and the slot needs the surface's error reporter. Closing over the reporter
 * inside the surface made the component TYPE a function of the reporter, so an unstable reporter handed React a new
 * type every render and REMOUNTED the slot (its retry counter and in-flight read reset). This module-level component
 * has one identity for the life of the app and takes the reporter from {@link RecipeWidgetErrorContext}, which the
 * surface provides — a changed reporter re-renders the slot, it never remounts it.
 *
 * @pattern Context-injected dependency — a stable component reads what the composition root provides
 */
import { createContext, useContext, type JSX } from 'react';

import { RecipeWidgetSlot } from './RecipeWidgetSlot';

/** Reports a failure inside the recipe widget. Takes `unknown`: a throw need not be an `Error`. */
export type RecipeWidgetErrorReporter = (error: unknown) => void;

/** The reporter the surface provides; a no-op outside a surface, so a bare slot never throws for want of one. */
export const RecipeWidgetErrorContext = createContext<RecipeWidgetErrorReporter>(() => undefined);

/**
 * The recipe widget's render-map entry.
 *
 * @returns The recipe slot, wired to the surface's reporter.
 */
export function RecipeWidgetHost(): JSX.Element {
    const onWidgetError = useContext(RecipeWidgetErrorContext);

    return <RecipeWidgetSlot onWidgetError={onWidgetError} />;
}
