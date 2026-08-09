/**
 * @module @commise/features-cooking/stepDisplayModel — the platform-neutral contract behind the Cooking
 * Mode step surface (FR-032), plus the one pure formatter its two leaves share.
 *
 * The web (`StepDisplay.tsx`) and native (`StepDisplay.native.tsx`) leaves implement the SAME prop
 * contract; keeping it here — rather than re-declaring it per platform — is what stops the two from
 * drifting on what the orchestrator must supply. Nothing in this module imports a platform API, so it is
 * safe under web, React Native, and Node alike.
 *
 * Per GR-007 / spec.md D-003 the step itself is `RecipeStepView` from `@kitchensink/recipe-core`; Cooking Mode
 * defines **no** recipe-shaped type of its own.
 */
import type { RecipeStepView } from '@kitchensink/recipe-core';

/**
 * Props for the POPULATED step surface — one step of a recipe that has at least one step.
 *
 * The component is presentational: everything it renders arrives here, and it owns no session state. The
 * position readout is derived from `step.stepNumber` (the server-assigned 1-based order) against
 * `stepCount`, so the orchestrator cannot feed a display index that disagrees with the step's own number.
 */
export interface StepDisplayProps {
    /** The step to render. `stepNumber` is its 1-based position in the recipe. */
    readonly step: RecipeStepView;
    /** How many steps the recipe has in total — the `{total}` of the position readout. */
    readonly stepCount: number;
    /**
     * Optional illustration for this step.
     *
     * `RecipeStepView` carries no image field today (see the module note in `StepDisplay.tsx`), so the URL is
     * supplied by the orchestrator rather than read off the step. Absent → no image is rendered at all.
     */
    readonly imageUrl?: string;
}

/** Props for the ERROR surface — the recipe could not be loaded, and the viewer is offered a retry. */
export interface StepDisplayErrorProps {
    /** Invoked when the viewer asks to retry the failed load. */
    readonly onRetry: () => void;
}

// The step-position formatter lives in ONE place (`./stepPosition`); re-exported here so existing
// importers of this model keep working.
export { formatStepPosition } from './stepPosition';
export type { StepPosition } from './stepPosition';
