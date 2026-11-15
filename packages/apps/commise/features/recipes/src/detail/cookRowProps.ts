/**
 * @module @commise/features-recipes — the shared contracts of the recipe page's checkable rows (build spec §6.3): an
 * ingredient row the cook checks off, and a step the cook marks as the one they are on. Both leaves of each implement
 * the same props, and both are pure: the marks live in the orchestration layer (`useCookMarks`).
 */
import type { RecipeIngredientView, RecipeStepView } from '@kitchensink/recipe-core';
import type { ReactNode } from 'react';

/** Props for `IngredientCheckRow` (web and native). */
export interface IngredientCheckRowProps {
    /** The line, at the serving count on screen. */
    readonly ingredient: RecipeIngredientView;
    /** Whether the cook has checked the line off. */
    readonly checked: boolean;
    /** Whether every line of the recipe is removed, which drops the per-row removed badge. */
    readonly allRemoved: boolean;
    /** Called with the line's key (`ingredientId`). */
    readonly onToggle: (line: string) => void;
    /** Whether a hairline separates this row from the one above it: every row of a group but its first. */
    readonly divided?: boolean;
    /**
     * The owner's control that opens this line in the editor, for a line that needs review. Drawn as a SIBLING of the
     * check control, under the row text (a control inside the checkbox would tick the line when pressed). When it is
     * given, the row leaves the "Needs review" badge to it.
     */
    readonly reviewAction?: ReactNode;
}

/** Props for `StepRow` (web and native). */
export interface StepRowProps {
    /** The step, as the detail read returns it. */
    readonly step: RecipeStepView;
    /** Whether this is the step the cook is on. */
    readonly current: boolean;
    /** Called with the step's number. */
    readonly onToggle: (step: number) => void;
}
