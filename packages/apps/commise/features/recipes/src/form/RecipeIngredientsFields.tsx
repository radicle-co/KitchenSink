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
import { Popover } from '@commise/ui/popover';
import { StandIn } from '@commise/ui/stand-in';
import { StatusBadge } from '@commise/ui/status-badge';
import { useLocale, useMessages } from '@commise/i18n/react';
import { classifyUnit } from '@kitchensink/recipe-core';
import type { FC, ReactElement } from 'react';

import type { RecipeFormIngredient } from './values.js';

import { errorText, fieldChrome, rowField, sectionCard, sectionHeading, sizedField } from './formSectionStyles.js';
import { fillTemplate } from '../list/model.js';
import {
    ingredientNameDescribedBy,
    ingredientNoFoodNoteId,
    ingredientQuantityDescribedBy,
    ingredientGlyphId,
    ingredientRemoveId,
    ingredientsAddId,
    ingredientStandInId,
    ingredientStatusWordId,
    ingredientsErrorId,
    ingredientUnitNoteId,
} from './fieldErrorIds.js';
import { recipeNutritionTotal } from './nutrition.js';
import { nutritionPanelOf, rowFiguresOf } from './nutritionPanel.js';
import { NutritionPanelBody } from './NutritionPanelBody.js';
import { draftQuantity, draftQuantityVerdict } from './quantity.js';
import { AlertIcon, InfoIcon, PlusIcon, RetryIcon, TrashIcon } from './icons.js';
import { panelBodyOf } from './ingredientRowPanel.js';
import { lookupSettledMessage } from './lookupSettledMessage.js';
import { rowPresentationOf } from './ingredientRowPolicy.js';
import { isStandInName, lineDisplayName } from '../detail/lineName.js';
import { lineSummary, rangeDerivedNotice } from '../detail/model.js';
import { recipeMessages } from '../messages.js';
import { recipeFormMessages } from './messages.js';
import {
    applyDraftAction,
    ingredientSections,
    unitClassNote,
    unresolvedLineNote,
    parseQuantityBound,
    quantityInputValue,
    type RecipeIngredientsFieldsProps,
} from './props.js';

/** Step 2: the dynamic ingredient list (the ingredient typeahead/picker itself is app-owned and composed alongside this). */
export const RecipeIngredientsFields: FC<RecipeIngredientsFieldsProps> = ({
    values,
    errors,
    onChange,
    onRequestAddIngredient,
    nutrition,
    lookupRetry,
}) => {
    const m = useMessages(recipeFormMessages);
    const { ingredientLineName } = useMessages(recipeMessages);
    const locale = useLocale();
    // Plan 002 V1 B5 — the total and every row's panel read the SAME background read (blueprint Decision 3).
    const total = recipeNutritionTotal(values, nutrition.lookup);

    // R38 — the disclosure the running total owes when a line states a range (see `rangeDerivedNotice`).
    const rangeNotice = rangeDerivedNotice(total, {
        low: m.nutritionRangeDerivedLow,
        high: m.nutritionRangeDerivedHigh,
    });

    const renderRow = (line: RecipeFormIngredient, index: number): ReactElement => {
        const number = index + 1;
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
        // Plan 002 R9 — a line whose name the read withheld shows its stand-in in the name's place and no status
        // word, as the detail row does (`namelessLineCopy.md` §6c). DISPLAY only: never a field value.
        const standIn = isStandInName(line);
        // Plan 002 V1 — the ONE row policy decides the status word, its tone and slot 1's panel, for both leaves.
        const presentation = rowPresentationOf(line, rowFiguresOf(line, nutrition.lookup));
        const body = panelBodyOf(presentation.panel, presentation.standIn);

        const removeLine = (): void => {
            onChange(applyDraftAction(values, { kind: 'removeAt', field: 'ingredients', index }));
            // V1 sign-off item 11: hand focus on rather than drop it to the page. Rows are keyed, so the next row's
            // controls are the same DOM nodes after the removal; Add ingredient is the trailing control until B6.
            const next = values.ingredients[index + 1];
            const target =
                next === undefined
                    ? document.getElementById(ingredientsAddId)?.querySelector('button')
                    : (document.getElementById(ingredientGlyphId(next.key)) ??
                      document.getElementById(ingredientRemoveId(next.key))?.querySelector('button'));
            target?.focus();
        };

        const retrying = line.ingredientId !== null && lookupRetry.retrying.has(line.ingredientId);

        const retryLookup = (): void => {
            if (line.ingredientId !== null) {
                lookupRetry.retry(line.ingredientId, line.key);
            }
        };

        const displayName = lineDisplayName(line, ingredientLineName);
        // A stand-in names nothing, so the glyph's name carries the amount too, or a list of private rows is a list of
        // identical "About Private ingredient" buttons (namelessLineCopy §7, 1.1.1/2.5.3).
        const triggerFood = presentation.standIn
            ? lineSummary({ ...line, quantity: draftQuantity(line) }, locale, ingredientLineName)
            : displayName;

        return (
            // Keyed by the line's identity, never its index: an index key hands this row's DOM — its focused field,
            // its open panel — to the row below when a line above is removed (plan 002 V1).
            <li key={line.key} className="flex flex-wrap items-center gap-2">
                {/* A read-only textbox (not a plain span): keeps the "Ingredient N name" accessible label AND
                    announces the value, while making the name un-editable so it cannot drift from the
                    `ingredientId` supplying the calories. No `onChange` at all — the value changes only by
                    re-picking through the resolver. */}
                {standIn ? (
                    <span id={ingredientStandInId(index)}>
                        <StandIn tone={presentation.tone}>{displayName}</StandIn>
                    </span>
                ) : (
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
                )}
                {noFoodNote !== undefined && (
                    // ⛔ TEXT beside the row, not a colour on it — WCAG 1.4.1, and a colour cannot name the
                    // remedy. `role="note"` rather than `alert`: this is a standing fact about the row, not
                    // something that just happened, and a list of eight would otherwise shout eight times.
                    // The chip is the design system's `StatusBadge` (namelessLineCopy §2c); it takes no id and no role,
                    // so this wrapper carries both, as `StandIn`'s wrapper carries its id.
                    <span id={ingredientNoFoodNoteId(index)} role="note">
                        <StatusBadge tone={presentation.tone}>{noFoodNote}</StatusBadge>
                    </span>
                )}
                {/* The two bounds of R42's ranged quantity, sharing the ONE unit field that follows. An
                    emptied field renders as empty (`quantityInputValue`), never as `0` or the literal
                    "NaN" — an absent amount is a state the recipe can genuinely be in (R40). */}
                <input
                    type="number"
                    aria-label={fillTemplate(m.ingredientQuantityLabel, { number })}
                    aria-invalid={quantityInvalid || undefined}
                    aria-describedby={ingredientQuantityDescribedBy(index, standIn, quantityInvalid)}
                    value={quantityInputValue(line.quantity)}
                    onChange={(event) =>
                        onChange(
                            applyDraftAction(values, {
                                kind: 'setIngredientQuantityLow',
                                index,
                                value: parseQuantityBound(event.target.value),
                            }),
                        )
                    }
                    className={`${sizedField} w-24`}
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
                        onChange(
                            applyDraftAction(values, {
                                kind: 'setIngredientQuantityHigh',
                                index,
                                value: parseQuantityBound(event.target.value),
                            }),
                        )
                    }
                    className={`${sizedField} w-24`}
                />
                <input
                    type="text"
                    aria-label={fillTemplate(m.ingredientUnitLabel, { number })}
                    // U25 — the note DESCRIBES the field; it never marks it invalid. An unknown unit is
                    // accepted, never rejected, so `aria-invalid` stays off in every branch.
                    aria-describedby={unitNote === undefined ? undefined : ingredientUnitNoteId(index)}
                    value={line.unit ?? ''}
                    onChange={(event) =>
                        onChange(
                            applyDraftAction(values, {
                                kind: 'updateIngredientAt',
                                index,
                                patch: { unit: event.target.value },
                            }),
                        )
                    }
                    className={`${fieldChrome} w-28 ${unitClass === 'canonical' ? 'text-charcoal' : 'text-slate italic'}`}
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
                        onChange(
                            applyDraftAction(values, {
                                kind: 'updateIngredientAt',
                                index,
                                patch: { preparation: event.target.value },
                            }),
                        )
                    }
                    className={`${sizedField} w-48`}
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
                        onChange(
                            applyDraftAction(values, {
                                kind: 'updateIngredientAt',
                                index,
                                patch: { groupLabel: event.target.value },
                            }),
                        )
                    }
                    className={`${sizedField} w-40`}
                />
                {presentation.statusWord !== undefined && (
                    // The status word, from the row policy. Plain text announced with the row: `StatusBadge` is
                    // the design system's chip, so its tones (and W2's charcoal-on-tint contrast rule) live once.
                    <span id={ingredientStatusWordId(line.key)}>
                        <StatusBadge tone={presentation.tone}>{m[presentation.statusWord]}</StatusBadge>
                    </span>
                )}
                {body !== undefined && (
                    // Slot 1 — the state glyph (R24, R25). Opened by activation only (R32, §6d). Rendered only for a
                    // panel whose designed body has shipped (`panelBodyOf`); the others land with V1 B7. Calories
                    // live in this panel, not on the row (R30).
                    <Popover
                        triggerLabel={fillTemplate(m.ingredientStatusPanelTriggerLabel, { food: triggerFood })}
                        triggerIcon={presentation.glyph === 'alert' ? <AlertIcon /> : <InfoIcon />}
                        title={displayName}
                        closeLabel={fillTemplate(m.ingredientStatusPanelCloseLabel, { food: displayName })}
                        busy={retrying}
                        triggerId={ingredientGlyphId(line.key)}
                        describedBy={
                            presentation.statusWord === undefined ? undefined : ingredientStatusWordId(line.key)
                        }
                    >
                        {(close) => {
                            switch (body.kind) {
                                case 'nutrition':
                                    return (
                                        <NutritionPanelBody
                                            state={nutritionPanelOf(line, nutrition.lookup)}
                                            onRetry={nutrition.retry}
                                        />
                                    );
                                case 'lookupFailed':
                                    // Try again hands the work to the glyph: the panel closes, focus returns to the glyph (which
                                    // reads busy while the ask runs), and the row updates in place. While it runs, the panel
                                    // says so and offers no second ask (V1 sign-off, busy rule 2).
                                    return retrying ? (
                                        <p role="status">{m.statusLookupRetrying}</p>
                                    ) : (
                                        <div className="flex flex-col items-start gap-2">
                                            <p>{m.statusExplainFailed}</p>
                                            <Button
                                                variant="secondary"
                                                icon={<RetryIcon />}
                                                accessibilityLabel={fillTemplate(m.statusActionRetryLookupLabel, {
                                                    food: triggerFood,
                                                })}
                                                onPress={() => {
                                                    close();
                                                    retryLookup();
                                                }}
                                            >
                                                {m.statusActionRetry}
                                            </Button>
                                        </div>
                                    );
                                case 'explanation':
                                    return <p>{m[body.key]}</p>;
                            }
                        }}
                    </Popover>
                )}
                {/* Slot 2 — Remove, shown directly: it is the one action every row has shipped (§3a: one action is the
                    control itself, never a one-item menu). The ⋮ menu (`@commise/ui/action-menu`) mounts when V1 B7 adds
                    Change food and Create my own food. Try again lives in the row's panel, not here: in a menu that the
                    row's settled state removes, focus would fall to the page. */}
                <span id={ingredientRemoveId(line.key)} className="contents">
                    <Button variant="destructive" icon={<TrashIcon />} onPress={removeLine}>
                        {/* Icon-only on cramped phone rows (`sr-only`), full label from sm up (`sm:not-sr-only`).
                    The label stays in the accessibility tree, so the button's accessible name is
                    unchanged and desktop shows the text exactly as before. */}
                        <span className="sr-only sm:not-sr-only">{fillTemplate(m.removeIngredient, { number })}</span>
                    </Button>
                </span>
            </li>
        );
    };

    // U27 — the ONE fold, shared with the native leaf (`props.ts`), so the two platforms cannot section a
    // recipe differently. An UNGROUPED recipe folds to exactly one UNLABELLED section, which renders with no
    // heading at all — the flat list is byte-for-byte what it was before U27.
    const sections = ingredientSections(values);
    const settledMessage = lookupSettledMessage(m, values, lookupRetry.settled, ingredientLineName);

    return (
        <section aria-label={m.ingredientsHeading} className={sectionCard}>
            <h2 className={sectionHeading}>{m.ingredientsHeading}</h2>
            {/* The settled retry's outcome, announced politely; focus does not move (V1 sign-off 3c). Always rendered,
                so the region exists before its text changes. */}
            <p role="status" className="sr-only">
                {settledMessage}
            </p>
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
                                  <li key={`section-${section.lines[0]?.line.key ?? 'none'}`} role="presentation">
                                      <h3 className="text-body-sm font-semibold text-charcoal">{section.label}</h3>
                                  </li>,
                              ]),
                        ...section.lines.map((entry) => renderRow(entry.line, entry.index)),
                    ])}
                </ul>
            )}
            <div id={ingredientsAddId} className="self-start">
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
                {nutrition.read === 'loading' && (
                    // Not a partial total: nothing has answered yet, so say so rather than show a figure.
                    <p role="status" className="text-body-sm text-slate">
                        {m.nutritionLoading}
                    </p>
                )}
                {nutrition.read === 'failed' && (
                    // ⛔ No figure beside the failure: a total built from no catalog lines reads as a fact (REVIEW F3).
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-caption text-slate">{m.nutritionLoadFailed}</p>
                        <Button variant="secondary" icon={<RetryIcon />} onPress={nutrition.retry}>
                            {m.statusActionRetry}
                        </Button>
                    </div>
                )}
                {nutrition.read === 'ready' && (
                    <>
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
                    </>
                )}
            </div>
        </section>
    );
};
