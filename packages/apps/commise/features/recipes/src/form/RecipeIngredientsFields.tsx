/**
 * @module @commise/features-recipes/form — `RecipeIngredientsFields` (web): step 2 of the recipe form, the
 * dynamic ingredient list plus its running nutrition total. The ingredient typeahead/picker itself stays
 * app-owned and is composed alongside this leaf by the container/wizard-step.
 *
 * One of the four field GROUPS extracted from `RecipeForm.tsx` (T067, w3) so the SAME field markup composes
 * two ways with unchanged behavior and unchanged accessible names/DOM: inside `RecipeForm`'s single `<form>`,
 * and — one-for-one — as a step body of the 4-step edit wizard (`wizard/Wizard.tsx`).
 */
import { Button } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { errorText, field, rowField, sectionCard, sectionHeading } from './formSectionStyles.js';
import { fillTemplate } from '../list/model.js';
import { ingredientsErrorId } from './fieldErrorIds.js';
import { lineCalories, recipeNutritionTotal } from './model.js';
import { PlusIcon, TrashIcon } from './icons.js';
import { recipeFormMessages } from './messages.js';
import {
    addIngredient,
    parseNumericInput,
    removeIngredientAt,
    resolutionStatusLabel,
    updateIngredientAt,
    type RecipeFormSectionProps,
} from './props.js';

/** Step 2: the dynamic ingredient list (the ingredient typeahead/picker itself is app-owned and composed alongside this). */
export const RecipeIngredientsFields: FC<RecipeFormSectionProps> = ({ values, errors, onChange }) => {
    const m = useMessages(recipeFormMessages);
    const total = recipeNutritionTotal(values);

    // B8: an unresolved/invalid LINE is marked invalid only when it is itself the reason `errors.ingredients`
    // is set (WCAG 3.3.1 — identify the specific control, not the whole list) — never the whole list on an
    // `ingredientsEmpty` error, since there are no line inputs to mark in that case.
    const ingredientsInvalid = errors?.ingredients !== undefined;

    const ingredientRows: ReactElement[] = values.ingredients.map((line, index) => {
        const number = index + 1;
        const calories = lineCalories(line);
        // U6 (data-integrity): once a line RESOLVES (`ingredientId` set — via typeahead pick, USDA/add-by-name
        // admission, or freeform create), its name is BOUND to the food supplying the calories and is rendered
        // READ-ONLY; identity changes only by re-picking through the resolver. Only an UNRESOLVED line
        // (`ingredientId === null`) still edits its name inline — before it resolves, that field is the
        // freeform search text, not a persisted name — so `nameInvalid` (an unresolved-line concern) can only
        // ever apply to that editable branch.
        const resolved = line.ingredientId !== null;
        const nameInvalid = ingredientsInvalid && line.ingredientId === null;
        const quantityInvalid = ingredientsInvalid && line.quantity <= 0;

        return (
            <li key={index} className="flex flex-wrap items-center gap-2">
                {resolved ? (
                    // A read-only textbox (not a plain span): keeps the "Ingredient N name" accessible label AND
                    // announces the resolved value, while making the name un-editable so it cannot drift from
                    // the `ingredientId` supplying the calories. No `onChange` — the value is fixed until a
                    // re-pick replaces the line.
                    <input
                        type="text"
                        readOnly
                        aria-label={fillTemplate(m.ingredientNameLabel, { number })}
                        value={line.name}
                        className={`${rowField} bg-pearl/40`}
                    />
                ) : (
                    <input
                        type="text"
                        aria-label={fillTemplate(m.ingredientNameLabel, { number })}
                        aria-invalid={nameInvalid || undefined}
                        aria-describedby={nameInvalid ? ingredientsErrorId : undefined}
                        value={line.name}
                        onChange={(event) => onChange(updateIngredientAt(values, index, { name: event.target.value }))}
                        className={rowField}
                    />
                )}
                <input
                    type="number"
                    aria-label={fillTemplate(m.ingredientQuantityLabel, { number })}
                    aria-invalid={quantityInvalid || undefined}
                    aria-describedby={quantityInvalid ? ingredientsErrorId : undefined}
                    value={String(line.quantity)}
                    onChange={(event) =>
                        onChange(updateIngredientAt(values, index, { quantity: parseNumericInput(event.target.value) }))
                    }
                    className={`${field} w-24`}
                />
                <input
                    type="text"
                    aria-label={fillTemplate(m.ingredientUnitLabel, { number })}
                    value={line.unit ?? ''}
                    onChange={(event) => onChange(updateIngredientAt(values, index, { unit: event.target.value }))}
                    className={`${field} w-28`}
                />
                {line.resolutionStatus !== undefined && (
                    <span
                        aria-label={fillTemplate(m.ingredientStatusLabel, { number })}
                        className="rounded-full bg-pearl px-2 py-0.5 text-caption text-slate"
                    >
                        {resolutionStatusLabel(m, line.resolutionStatus)}
                    </span>
                )}
                {calories !== undefined && (
                    // Contrast (WCAG 2.1 AA): the seafoam tint stays; the badge's READ text takes `ocean-dark`
                    // (see `@commise/ui`'s palette JSDoc — seafoam-as-text on its own `/10` is 3.57:1).
                    <span className="rounded-full bg-seafoam/10 px-2 py-0.5 text-caption font-medium text-ocean-dark">
                        {fillTemplate(m.ingredientCaloriesTemplate, { calories })}
                    </span>
                )}
                <Button
                    variant="destructive"
                    icon={<TrashIcon />}
                    onPress={() => onChange(removeIngredientAt(values, index))}
                >
                    {/* Icon-only on cramped phone rows (`sr-only`), full label from sm up (`sm:not-sr-only`).
                        The label stays in the accessibility tree, so the button's accessible name is
                        unchanged and desktop shows the text exactly as before. */}
                    <span className="sr-only sm:not-sr-only">{fillTemplate(m.removeIngredient, { number })}</span>
                </Button>
            </li>
        );
    });

    return (
        <section aria-label={m.ingredientsHeading} className={sectionCard}>
            <h2 className={sectionHeading}>{m.ingredientsHeading}</h2>
            {errors?.ingredients !== undefined && (
                <p id={ingredientsErrorId} className={errorText} role="alert">
                    {m.errors[errors.ingredients]}
                </p>
            )}
            {ingredientRows.length === 0 ? (
                <p className="text-body-sm text-slate">{m.noIngredients}</p>
            ) : (
                <ul className="flex flex-col gap-3">{ingredientRows}</ul>
            )}
            <div className="self-start">
                <Button variant="secondary" icon={<PlusIcon />} onPress={() => onChange(addIngredient(values))}>
                    {m.addIngredient}
                </Button>
            </div>
            <div className="flex flex-col gap-1 rounded-xl bg-pearl/60 px-4 py-3">
                <p className="text-body-sm font-medium text-charcoal">
                    {fillTemplate(m.nutritionTotalTemplate, {
                        calories: total.calories,
                        protein: total.proteinG,
                        carbs: total.carbsG,
                        fat: total.fatG,
                    })}
                </p>
                {!total.isComplete && <p className="text-caption text-slate">{m.nutritionPartialNotice}</p>}
            </div>
        </section>
    );
};
