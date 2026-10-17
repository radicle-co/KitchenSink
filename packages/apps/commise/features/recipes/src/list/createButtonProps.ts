/**
 * @module @commise/features-recipes — the contract the create entry's web and native leaves share (build spec §3.4).
 */

/** Where the web draws the create entry. Native has only the floating form. */
export type RecipeCreateButtonAppearance = 'fab' | 'sidebar' | 'rail';

/** Props for `RecipeCreateButton`. */
export interface RecipeCreateButtonProps {
    /** Open the empty editor. */
    readonly onCreateRecipe: () => void;
    /** Web only: which form is drawn. Defaults to the floating `fab`; native draws only that form. */
    readonly appearance?: RecipeCreateButtonAppearance;
    /** The screen shows its first-run state, whose own start buttons take the floating form's place (§3.4). */
    readonly firstRun?: boolean;
}
