/**
 * @module @commise/features-recipes/wizard — pure step-rail + dirty-comparison state for the 4-step
 * recipe-edit wizard shell (w3/e1,e2). No React, no platform APIs — `Wizard.tsx`/`Wizard.native.tsx` thread
 * these through `useState`/context; this module is the ONE place the rail's completed/current/invalid rule
 * and the "unsaved edits" structural comparison are DEFINED, so the two platform leaves cannot drift.
 */
import { errorsInStep, type RecipeWizardStep } from '../form/steps.js';
import type { RecipeFormErrorCode, RecipeFormErrors } from '../form/validate.js';
import type { RecipeFormValues } from '../form/values.js';

/**
 * The wizard's 4 steps, in order — `[1] Details → [2] Ingredients → [3] Instructions → [4] Review` (U33).
 *
 * ⚠️ Step 4 used to be `Photos`. It is now REVIEW, and photos are a FIELD of step 1 rather than a step of
 * their own — see `form/values.ts`'s `RecipeFormPhoto` for why they had to stop demanding a persisted recipe
 * id before they could be touched. The step COUNT did not change, so the `stepNames` tuple's arity was never
 * the guard the plan expected it to be; `WizardMessages.stepNames` is keyed by {@link RecipeWizardStep}
 * instead, which fails at every construction site if the step set ever does change.
 */
export const WIZARD_STEPS: readonly RecipeWizardStep[] = [1, 2, 3, 4];

export const WIZARD_TOTAL_STEPS = WIZARD_STEPS.length;

/**
 * The first step, in order, holding one of `errors`: where a refused Save Draft or Publish goes, so the cook lands on
 * what refused it (`docs/design/rowEditorOpenDecisions.md` R7, WCAG 3.3.1). Pure.
 *
 * @param errors - The errors a gate refused with.
 * @returns The step, or `undefined` when nothing was refused.
 */
export const firstStepWithErrors = (errors: RecipeFormErrors): RecipeWizardStep | undefined =>
    WIZARD_STEPS.find((step) => Object.keys(errorsInStep(errors, step)).length > 0);

/**
 * What a save or Next gate decided: go ahead, refuse, or wait for a rebind command in flight (`useRecipeEditor`). A
 * refusal carries its errors and the first step holding one (`undefined` when no step owns them), which is where the
 * cook lands (`docs/design/rowEditorOpenDecisions.md` R7).
 */
export type GateOutcome =
    | { readonly kind: 'send' }
    | { readonly kind: 'refused'; readonly errors: RecipeFormErrors; readonly step: RecipeWizardStep | undefined }
    | { readonly kind: 'busy' };

/**
 * The gate's decision over the errors it found: any error refuses, whether or not a step owns it, so an error code the
 * field->step map does not list can never let a save through. Pure.
 *
 * @param errors - The errors the gate's validator found.
 * @returns `send`, or `refused` with the step to land on.
 */
export const gateOutcomeOf = (errors: RecipeFormErrors): Exclude<GateOutcome, { readonly kind: 'busy' }> =>
    Object.keys(errors).length === 0
        ? { kind: 'send' }
        : { kind: 'refused', errors, step: firstStepWithErrors(errors) };

/**
 * Where the wizard stands once a gate has decided: a refusal lands on the step that holds its first error (R7), and any
 * other outcome leaves the cook where they are. Pure.
 *
 * @param current - The step the cook is on.
 * @param outcome - What the gate decided.
 * @returns The step to show.
 */
export const stepAfterGate = (current: RecipeWizardStep, outcome: GateOutcome): RecipeWizardStep =>
    outcome.kind === 'refused' && outcome.step !== undefined ? outcome.step : current;

/**
 * The step BEFORE `step`, or `null` at the first step. Pure.
 *
 * Step adjacency is stated once, here, rather than as `index - 1` arithmetic against a positional array in
 * each platform leaf: both leaves derived the Prev/Next labels that way and both carried a `?? ''` fallback,
 * so an off-by-one could only ever surface as a button labelled `Prev:` with nothing after the colon.
 *
 * @param step - The step to look behind.
 * @returns The preceding step, or `null` when `step` is the first.
 */
export function previousStep(step: RecipeWizardStep): RecipeWizardStep | null {
    return step === 1 ? null : ((step - 1) as RecipeWizardStep);
}

/**
 * The step AFTER `step`, or `null` at the last step. Pure. See {@link previousStep} for why adjacency lives
 * here rather than in the leaves.
 *
 * @param step - The step to look ahead of.
 * @returns The following step, or `null` when `step` is the last.
 */
export function nextStep(step: RecipeWizardStep): RecipeWizardStep | null {
    return step === WIZARD_TOTAL_STEPS ? null : ((step + 1) as RecipeWizardStep);
}

/**
 * A step rail marker's visual/semantic state:
 * - `invalid` — the step was ATTEMPTED (the user tried to advance past it, or attempted Publish) and still
 *   has validation errors; takes priority even over the current step, so a bad current step is flagged too.
 * - `current` — the active step, not (yet) flagged invalid.
 * - `completed` — an earlier step than the active one, not flagged invalid.
 * - `upcoming` — a later step than the active one, not yet visited/attempted.
 */
export type WizardRailStepState = 'completed' | 'current' | 'invalid' | 'upcoming';

/** The wizard copy's word for each rail state, which the rail pill's accessible name carries. */
export const RAIL_STATE_WORD: Record<
    WizardRailStepState,
    'stateCompleted' | 'stateCurrent' | 'stateInvalid' | 'stateUpcoming'
> = {
    completed: 'stateCompleted',
    current: 'stateCurrent',
    invalid: 'stateInvalid',
    upcoming: 'stateUpcoming',
};

/**
 * Derive one rail marker's state (FR-044's numbered/filled/invalid circle). `attempted` gates the invalid
 * flag deliberately — an untouched step 3 must not show as "invalid" just because its instructions are still
 * empty; only a step the user actually tried to leave (via Next) or tried to Publish through earns the flag.
 * Pure.
 *
 * @param params - The step being rendered, the wizard's current step, whether `step` was attempted, and
 *   whether `step` currently has validation errors.
 * @returns The rail marker's state for `step`.
 */
export function deriveRailStepState(params: {
    readonly step: RecipeWizardStep;
    readonly currentStep: RecipeWizardStep;
    readonly attempted: boolean;
    readonly hasErrors: boolean;
}): WizardRailStepState {
    const { step, currentStep, attempted, hasErrors } = params;

    if (attempted && hasErrors) {
        return 'invalid';
    }

    if (step === currentStep) {
        return 'current';
    }

    return step < currentStep ? 'completed' : 'upcoming';
}

/**
 * The distinct validation codes that are BLOCKING the author from leaving a step — what the footer surfaces
 * when `Next` was pressed and the wizard refused to advance.
 *
 * Why this exists: `Next` is always enabled and `requestGoNext` marks the step attempted then calls a
 * `goNext` that no-ops while the step is invalid. Before this, the only feedback was the rail marker
 * flipping to `invalid` — so on a step whose body is a single empty list (step 2 with no ingredients) the
 * primary control simply did nothing, with nothing said. An enabled control that silently refuses is a
 * defect; DISABLING it instead would be worse, because the attempt is what flags the rail in the first
 * place (see {@link deriveRailStepState}).
 *
 * `attempted` gates it for the same reason the rail's `invalid` flag is gated: an author who has merely
 * ARRIVED at an incomplete step must not be shouted at. Deduped, because two fields of one step can carry
 * the same code and the notice must not repeat a sentence. Pure.
 *
 * NOTE — after a failed Publish the container ALSO populates its own `errors` prop (whole-form validation),
 * so returning to an invalid step can show the same sentence both inline and here. That overlap is
 * deliberate and bounded: the two have different triggers (a field's own state vs. a refused navigation),
 * and suppressing either would put one of them back to failing silently.
 *
 * @param attempted - Whether the author has already tried to advance past (or publish through) this step.
 * @param errors - That step's validation errors (`stepErrorsFor`'s output).
 * @returns The distinct blocking codes, in field order; empty when unattempted or valid.
 */
export function blockedAdvanceErrors(attempted: boolean, errors: RecipeFormErrors): readonly RecipeFormErrorCode[] {
    if (!attempted) {
        return [];
    }

    return [...new Set(Object.values(errors).filter((code): code is RecipeFormErrorCode => code !== undefined))];
}

/**
 * Structural equality over {@link RecipeFormValues} — the discard guard's "are there unsaved edits" test.
 * Every real caller builds both sides from this package's own pure builders (`defaultRecipeFormValues`,
 * `toRecipeFormValues`, and the `props.ts` line/step transitions), which never store an explicit `undefined`
 * (optional fields are OMITTED, per the repo's omit-never-undefined convention — `CODING_STANDARDS §6`,
 * which is a convention rather than a compiler setting) and construct object
 * keys in a stable, repeatable order — so a `JSON.stringify` comparison is EXACT here, not an approximation:
 * two values compare equal iff they carry the same data. Pure.
 *
 * @param a - One draft.
 * @param b - The other draft.
 * @returns Whether `a` and `b` carry the same data.
 */
export function recipeFormValuesEqual(a: RecipeFormValues, b: RecipeFormValues): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}
