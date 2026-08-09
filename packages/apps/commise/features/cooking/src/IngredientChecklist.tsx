/**
 * @module @commise/features-cooking/IngredientChecklist — the WEB ingredient-checkoff panel (FR-032a).
 *
 * Pattern: **pure presentational (render) component**, in its CONTROLLED form — `props → JSX` with one
 * responsibility (render the recipe's ingredients as a checkable list at the active yield). It fetches
 * nothing, mutates nothing, holds no state and no ref: the checked ids and the open/dismissed flag arrive
 * as props, and the only things that leave are the intents `onToggleIngredient(id)` and `onDismiss()`. The
 * orchestrating `CookingModeScreen` owns the session and applies `toggleIngredient` (MOD-019).
 *
 * Two requirements are met STRUCTURALLY rather than by discipline:
 *  - **Never mutates the stored recipe** (FR-032a / REQ-CN-001) — the component is handed no writer, so
 *    there is nothing here that could issue one.
 *  - **Opens and dismisses without leaving the current step** — it renders no navigation affordance at all;
 *    dismissed, it renders nothing, so the step behind it is never disturbed.
 *
 * Accessibility (NFR-003/NFR-004): every line is a real `checkbox` whose accessible name is the full
 * "quantity unit name" of the line, and checked state rides on `aria-checked` PLUS a ✓ glyph — never on
 * colour alone. Copy comes only from the shared `cookingMessages` dictionary; the native leaf
 * (`IngredientChecklist.native.tsx`) mirrors this contract via the shared props in `./sessionExtras`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { isChecked } from '@kitchensink/cooking-core';
import type { FC } from 'react';

import { cookingMessages } from './messages';
import { formatCheckoffProgress, scaleIngredientLine, type IngredientChecklistProps } from './sessionExtras';

/** The ingredient-checkoff panel shown inside Cooking Mode (FR-032a), scaled for the active yield (FR-034a). */
export const IngredientChecklist: FC<IngredientChecklistProps> = ({
    ingredients,
    checkedIngredientIds,
    scaleFactor = 1,
    isOpen,
    onToggleIngredient,
    onDismiss,
}) => {
    const cooking = useMessages(cookingMessages);
    const locale = useLocale();

    if (!isOpen) {
        return null;
    }

    const checkedCount = ingredients.filter((ingredient) =>
        isChecked(checkedIngredientIds, ingredient.ingredientId),
    ).length;
    const progress = formatCheckoffProgress(checkedCount, ingredients.length, cooking.ingredientsChecked, locale);

    return (
        <section
            aria-label={cooking.ingredientListLabel}
            className="flex w-full flex-col gap-3 rounded-2xl bg-card p-4 shadow-sm"
        >
            <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-heading-md font-semibold text-charcoal">{cooking.ingredientsLabel}</h2>
                <button
                    type="button"
                    aria-label={cooking.closeIngredientsLabel}
                    onClick={onDismiss}
                    className="flex size-11 shrink-0 items-center justify-center rounded-full text-charcoal"
                >
                    <span aria-hidden>✕</span>
                </button>
            </div>

            {ingredients.length === 0 ? (
                <p className="text-body-sm text-slate">{cooking.ingredientsEmptyBody}</p>
            ) : (
                <>
                    {/* Live so a screen reader hears progress change as boxes are ticked; also the queryable
                        name of the readout, so the count is assertable without a test id. */}
                    <p role="status" aria-label={progress} className="text-body-sm text-slate">
                        {progress}
                    </p>
                    <ul className="flex flex-col divide-y divide-border">
                        {ingredients.map((ingredient) => {
                            const { quantityText, label } = scaleIngredientLine(ingredient, scaleFactor, locale);
                            const checked = isChecked(checkedIngredientIds, ingredient.ingredientId);

                            return (
                                <li key={ingredient.ingredientId} className="flex items-center gap-3 py-2">
                                    {/* The interactive control is the 44px base touch target (`size-11`),
                                        collapsing to the 24px box from sm up — the same geometry the shipped
                                        recipe-detail checklist uses, so the two surfaces feel identical. */}
                                    <button
                                        type="button"
                                        role="checkbox"
                                        aria-checked={checked}
                                        aria-label={label}
                                        onClick={() => onToggleIngredient(ingredient.ingredientId)}
                                        className="flex size-11 shrink-0 items-center justify-center sm:size-6"
                                    >
                                        <span
                                            aria-hidden
                                            className={`flex size-8 items-center justify-center rounded border-2 sm:size-6 ${
                                                checked
                                                    ? 'border-seafoam bg-seafoam text-white'
                                                    : // Unchecked, the outline IS the affordance — a UI
                                                      // component owing 3:1 under SC 1.4.11, where `mist`
                                                      // measures 1.90:1.
                                                      'border-slate bg-transparent'
                                            }`}
                                        >
                                            {checked && <span>✓</span>}
                                        </span>
                                    </button>
                                    <span className="shrink-0 font-medium text-charcoal">{quantityText}</span>
                                    <span
                                        className={`min-w-0 break-words text-charcoal ${
                                            // A second, non-colour cue that this line is done (SC 1.4.1).
                                            checked ? 'line-through' : ''
                                        }`}
                                    >
                                        {ingredient.name}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </section>
    );
};
