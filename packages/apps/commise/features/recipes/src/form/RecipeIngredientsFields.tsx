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
import { classifyUnit, FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { FC, ReactElement } from 'react';

import type { RecipeFormIngredient } from './model.js';

import { errorText, field, rowField, sectionCard, sectionHeading } from './formSectionStyles.js';
import { fillTemplate } from '../list/model.js';
import {
    ingredientNameDescribedBy,
    ingredientNoFoodNoteId,
    ingredientsErrorId,
    ingredientUnitNoteId,
} from './fieldErrorIds.js';
import { draftQuantityVerdict, lineCalories, recipeNutritionTotal } from './model.js';
import { PlusIcon, TrashIcon } from './icons.js';
import { rangeDerivedNotice } from '../detail/model.js';
import { recipeFormMessages } from './messages.js';
import {
    ingredientSections,
    unitClassNote,
    unresolvedLineNote,
    parseQuantityBound,
    quantityInputValue,
    removeIngredientAt,
    resolutionStatusLabel,
    setIngredientQuantityHigh,
    setIngredientQuantityLow,
    updateIngredientAt,
    type RecipeIngredientsFieldsProps,
} from './props.js';

/** Step 2: the dynamic ingredient list (the ingredient typeahead/picker itself is app-owned and composed alongside this). */
export const RecipeIngredientsFields: FC<RecipeIngredientsFieldsProps> = ({
    values,
    errors,
    onChange,
    onRequestAddIngredient,
}) => {
    const m = useMessages(recipeFormMessages);
    const total = recipeNutritionTotal(values);

    // R38 — the disclosure the running total owes when a line states a range (see `rangeDerivedNotice`).
    const rangeNotice = rangeDerivedNotice(total, {
        low: m.nutritionRangeDerivedLow,
        high: m.nutritionRangeDerivedHigh,
    });

    const renderRow = (line: RecipeFormIngredient, index: number): ReactElement => {
        const number = index + 1;
        const calories = lineCalories(line);
        // U6 (data-integrity): a line's name is BOUND to the food supplying its calories and is rendered
        // READ-ONLY; identity changes only by re-picking through the resolver.
        //
        // ⛔ U28 EXTENDED THAT TO EVERY LINE, unresolved ones included. U6 kept an unresolved line's name
        // editable as "the freeform search text, not a persisted name" — a premise that died with the
        // blank-row button: a line resolves ONLY through the picker, so typing here could never produce an
        // id, and `toCreateRecipeInput` dropped the row whatever it said. It was dead UI wearing the costume
        // of a working control. The brief is explicit: the food "is filled from the picker below … It can be
        // cleared or re-picked, never typed over." The text the cook wrote stays VISIBLE — read-only is not
        // hidden — and the note below says what to do with it.
        //
        // U28's note: derived from the LINE, never from `errors`. A row restored unresolved must say so
        // before anyone presses anything; `errors` is only populated by a submit attempt, which is why the
        // row used to look complete right up until the save that dropped it.
        const noFoodNote = unresolvedLineNote(m, line);
        // B8: a LINE is marked invalid only when it is itself the reason (WCAG 3.3.1 — identify the specific
        // control, not the whole list) — never every row on an `ingredientsEmpty` error, since there are no
        // line inputs to mark in that case.
        //
        // U9 narrowed this from "any ingredients error" to the SPECIFIC code; U28 narrowed it again to the
        // LINE's own state, so the mark and the note appear together and cannot disagree.
        const nameInvalid = noFoodNote !== undefined;
        // Both bounds carry the mark: the invalid thing is the PAIR (`3` and `2` are each fine alone), and
        // marking only one would send the user to a field that may be the correct half of the two.
        const quantityInvalid =
            errors?.ingredients === 'ingredientsQuantityInvalid' && draftQuantityVerdict(line) === 'invalid';
        // U25 — DERIVED at render from the vocabulary, never stored. `classifyUnit` is `recipe-core`'s, so
        // this editor, the service and the mobile leaf cannot disagree about what `handful` is.
        const unitClass = classifyUnit(line.unit ?? '');
        const unitNote = unitClassNote(m, line.unit);

        return (
            <li key={index} className="flex flex-wrap items-center gap-2">
                {/* A read-only textbox (not a plain span): keeps the "Ingredient N name" accessible label AND
                    announces the value, while making the name un-editable so it cannot drift from the
                    `ingredientId` supplying the calories. No `onChange` at all — the value changes only by
                    re-picking through the resolver. */}
                <input
                    type="text"
                    readOnly
                    aria-label={fillTemplate(m.ingredientNameLabel, { number })}
                    aria-invalid={nameInvalid || undefined}
                    aria-describedby={ingredientNameDescribedBy(
                        index,
                        noFoodNote !== undefined,
                        errors?.ingredients === 'ingredientsUnresolved',
                    )}
                    value={line.name}
                    className={`${rowField} bg-pearl/40`}
                />
                {noFoodNote !== undefined && (
                    // ⛔ TEXT beside the row, not a colour on it — WCAG 1.4.1, and a colour cannot name the
                    // remedy. `role="note"` rather than `alert`: this is a standing fact about the row, not
                    // something that just happened, and a list of eight would otherwise shout eight times.
                    <span
                        id={ingredientNoFoodNoteId(index)}
                        role="note"
                        className="rounded-full bg-warning/25 px-2 py-0.5 text-caption font-medium text-charcoal"
                    >
                        {noFoodNote}
                    </span>
                )}
                {/* The two bounds of R42's ranged quantity, sharing the ONE unit field that follows. An
                    emptied field renders as empty (`quantityInputValue`), never as `0` or the literal
                    "NaN" — an absent amount is a state the recipe can genuinely be in (R40). */}
                <input
                    type="number"
                    aria-label={fillTemplate(m.ingredientQuantityLabel, { number })}
                    aria-invalid={quantityInvalid || undefined}
                    aria-describedby={quantityInvalid ? ingredientsErrorId : undefined}
                    value={quantityInputValue(line.quantity)}
                    onChange={(event) =>
                        onChange(setIngredientQuantityLow(values, index, parseQuantityBound(event.target.value)))
                    }
                    className={`${field} w-24`}
                />
                {/* Punctuation, not copy — the same EN DASH `formatQuantity` prints between the bounds on the
                    read surface, so the editor and the detail agree on what a range looks like. Hidden from
                    assistive tech: each input already carries its own accessible name. */}
                <span aria-hidden className="text-slate">
                    –
                </span>
                <input
                    type="number"
                    aria-label={fillTemplate(m.ingredientQuantityHighLabel, { number })}
                    aria-invalid={quantityInvalid || undefined}
                    aria-describedby={quantityInvalid ? ingredientsErrorId : undefined}
                    value={quantityInputValue(line.quantityHigh)}
                    onChange={(event) =>
                        onChange(setIngredientQuantityHigh(values, index, parseQuantityBound(event.target.value)))
                    }
                    className={`${field} w-24`}
                />
                <input
                    type="text"
                    aria-label={fillTemplate(m.ingredientUnitLabel, { number })}
                    // U25 — the note DESCRIBES the field; it never marks it invalid. An unknown unit is
                    // accepted, never rejected, so `aria-invalid` stays off in every branch.
                    aria-describedby={unitNote === undefined ? undefined : ingredientUnitNoteId(index)}
                    value={line.unit ?? ''}
                    onChange={(event) => onChange(updateIngredientAt(values, index, { unit: event.target.value }))}
                    className={`${field} w-28 ${unitClass === 'canonical' ? 'text-charcoal' : 'text-slate italic'}`}
                />
                {unitNote !== undefined && (
                    // ⛔ TEXT, not colour. The mockup marks an unrecognised unit by styling alone — WCAG
                    // 1.4.1's exact failure — and styling also cannot tell a deliberate `handful` from a
                    // mistyped `blorp`, which is the distinction U25 exists to draw.
                    <span id={ingredientUnitNoteId(index)} className="text-caption text-slate">
                        {unitNote}
                    </span>
                )}
                {/* U26 — the PREPARATION, its own field beside the food and never part of its name. The
                    vocabulary is `recipe-import-core`'s `modifierLexicon.ts` (KTD-11b): a past participle or
                    a temperature. An adjective is IDENTITY and arrives from the picker, inside the name. */}
                <input
                    type="text"
                    aria-label={fillTemplate(m.ingredientPreparationLabel, { number })}
                    placeholder={m.ingredientPreparationPlaceholder}
                    value={line.preparation ?? ''}
                    onChange={(event) =>
                        onChange(updateIngredientAt(values, index, { preparation: event.target.value }))
                    }
                    className={`${field} w-48`}
                />
                {/* U27 — the SECTION. Deliberately the LAST and quietest control on the row: the brief is
                    explicit that per-row typing is the wrong PRIMARY interaction (a cook would type "For the
                    marinade" eight times), so the primary path is `addIngredient` inheriting the label from
                    the line above and this stays the secondary way to start or change one. */}
                <input
                    type="text"
                    aria-label={fillTemplate(m.ingredientGroupLabel, { number })}
                    placeholder={m.ingredientGroupPlaceholder}
                    value={line.groupLabel ?? ''}
                    onChange={(event) =>
                        onChange(updateIngredientAt(values, index, { groupLabel: event.target.value }))
                    }
                    className={`${field} w-40`}
                />
                {line.resolutionStatus !== undefined && (
                    <span
                        aria-label={fillTemplate(m.ingredientStatusLabel, { number })}
                        // U14 — a line the verification gate CONTRADICTED is the one status a cook can act on
                        // (re-pick the food), and the editor is where they do it. Wearing the same neutral
                        // pearl as "Resolved" would put that affordance in front of them in the colour of
                        // "nothing to do here". ⛔ CHARCOAL on a `warning` TINT, never `warning` as the text
                        // colour: `@commise/ui`'s palette JSDoc is explicit that #F5B041 is a light FILL that
                        // takes a charcoal label, and as a foreground on near-white it is far under 4.5:1.
                        className={
                            line.resolutionStatus === FoodResolutionStatus.NEEDS_REVIEW
                                ? 'rounded-full bg-warning/25 px-2 py-0.5 text-caption font-medium text-charcoal'
                                : 'rounded-full bg-pearl px-2 py-0.5 text-caption text-slate'
                        }
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
    };

    // U27 — the ONE fold, shared with the native leaf (`props.ts`), so the two platforms cannot section a
    // recipe differently. An UNGROUPED recipe folds to exactly one UNLABELLED section, which renders with no
    // heading at all — the flat list is byte-for-byte what it was before U27.
    const sections = ingredientSections(values);

    return (
        <section aria-label={m.ingredientsHeading} className={sectionCard}>
            <h2 className={sectionHeading}>{m.ingredientsHeading}</h2>
            {errors?.ingredients !== undefined && (
                <p id={ingredientsErrorId} className={errorText} role="alert">
                    {m.errors[errors.ingredients]}
                </p>
            )}
            {sections.length === 0 ? (
                <p className="text-body-sm text-slate">{m.noIngredients}</p>
            ) : (
                <ul className="flex flex-col gap-3">
                    {sections.flatMap((section) => [
                        // ⛔ NO HEADING for an unlabelled run. Most recipes will never group, and the brief is
                        // explicit that those "must not look unfinished" — so section chrome appears only
                        // where a cook asked for it. `h3` sits under the section's own `h2`.
                        //
                        // ⛔ INTERLEAVED IN THE ONE LIST, never a wrapper around each run, and that is a
                        // FOCUS bug rather than a styling preference. A per-run wrapper makes the section the
                        // DOM ancestor of its rows, so typing the first character of a new label resplits the
                        // runs, React reconciles the wrapper it matched by key, and the `<li>` holding the
                        // focused input UNMOUNTS — the caret vanishes and every later keystroke goes nowhere
                        // (the keyboard dismisses, on native). Flat, every row keeps its key in ONE stable
                        // parent, so a resplit only inserts a heading beside it.
                        //
                        // `role="presentation"` so the heading is not counted as a list item: the list's item
                        // count stays the ingredient count, while the `<h3>` inside stays a real heading.
                        ...(section.label === undefined
                            ? []
                            : [
                                  <li key={`section-${section.lines[0]?.index ?? -1}`} role="presentation">
                                      <h3 className="text-body-sm font-semibold text-charcoal">{section.label}</h3>
                                  </li>,
                              ]),
                        ...section.lines.map((entry) => renderRow(entry.line, entry.index)),
                    ])}
                </ul>
            )}
            <div className="self-start">
                {/* U28 — a REQUEST, not a mutation. It used to append a blank, unresolved row that
                    `validateRecipeForm` refused and `toCreateRecipeInput` silently dropped: a cook typed into
                    a row that could never be saved. The container answers this by focusing the ingredient
                    picker, which is where a line actually resolves. This leaf must not know the picker
                    exists — it is app-owned and composed alongside (see the module doc). */}
                <Button variant="secondary" icon={<PlusIcon />} onPress={onRequestAddIngredient}>
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
                {/* R38 — a total computed from the low end of `2–3 cups` is up to a third under, and says so
                    here rather than reading as an exact figure. */}
                {rangeNotice !== undefined && <p className="text-caption text-slate">{rangeNotice}</p>}
            </div>
        </section>
    );
};
