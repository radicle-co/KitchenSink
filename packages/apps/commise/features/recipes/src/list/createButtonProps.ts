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
    /**
     * The floating form yields its place (§3.4): while the screen's first load is in flight (it never appears, so it
     * cannot vanish), and on the first run, whose own start buttons take its place.
     */
    readonly yielded?: boolean;
}
