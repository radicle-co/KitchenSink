/**
 * @module @commise/features-recipes/common — the house shape of ONE control's focus request, read by every leaf that can
 * take a requested focus (the editor's rows, the ingredient-matching lists, the import wizard's Next). Its own module,
 * with no imports, so a leaf outside the row editor can name it without depending on the row editor's hook.
 */

/** One control's focus request: a level it lowers once it has taken focus (`useFocusRequest`). */
export interface ControlFocus {
    readonly requested: boolean;
    readonly onHandled: () => void;
}
