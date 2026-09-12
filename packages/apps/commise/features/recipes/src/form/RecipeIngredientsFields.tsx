'use client';

/**
 * @module @commise/features-recipes/form — `RecipeIngredientsFields` (web): step 2 of the recipe form, the
 * dynamic ingredient list, the trailing add row after it, and the running nutrition total. The trailing add row is an
 * entry combobox (plan 002 V1 B8, `./trailingEntryField.ts`): type, pick, and the line appends.
 *
 * One of the four field GROUPS (T067, w3), each a step body of the 4-step edit wizard (`wizard/Wizard.tsx`).
 *
 * The row editor (plan 002 V1 B7, curated U15): a row that names no food, a declared row and a row in Change food
 * show their name as an entry combobox (`./rowEntryField.ts`); every row's actions sit behind its `⋮`
 * (`docs/design/ingredientStatusExplanation.md` §3a); and the authored-food form and the details dialog open from it.
 * This orchestration component takes the group's state, focus and row views from `useIngredientsFields` and draws them
 * with the DOM's own focus and description mechanisms (the row sentence describes its field, and the Radix surfaces
 * return their own focus).
 *
 * @pattern Mediator — between the host's row-editor controllers and the row controls, through `useIngredientsFields`
 */
import { ActionMenu } from '@commise/ui/action-menu';
import { Button } from '@commise/ui/button';
import { Combobox } from '@commise/ui/combobox';
import { Popover } from '@commise/ui/popover';
import { StandIn } from '@commise/ui/stand-in';
import { StatusBadge } from '@commise/ui/status-badge';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import { useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { errorText, fieldChrome, sectionCard, sectionHeading, sizedField } from './formSectionStyles.js';
import { fillTemplate } from '../list/model.js';
import {
    ingredientCommitFailureId,
    ingredientPendingTextId,
    ingredientNoFoodNoteId,
    ingredientStandInId,
    ingredientStatusWordId,
    ingredientsErrorId,
    ingredientUnitNoteId,
    trailingCommitFailureId,
    trailingPendingTextId,
} from './fieldErrorIds.js';
import { VariantDetailsDialog } from '../details/VariantDetailsDialog.js';
import { AuthoredFoodSheet } from './AuthoredFoodSheet.js';
import type { IngredientRowView } from './ingredientRowView.js';
import type { RecipeFormMessages } from './messages.js';
import type { IngredientNutrition } from './nutritionLookup.js';
import { nutritionPanelOf } from './nutritionPanel.js';
import { rowEntryFieldOf, type RowEntryFieldCopy } from './rowEntryField.js';
import { trailingEntryFieldOf } from './trailingEntryField.js';
import { NutritionPanelBody } from './NutritionPanelBody.js';
import { AlertIcon, InfoIcon, PlusIcon, RetryIcon, SearchIcon, TrashIcon } from './icons.js';
import { ShortlistPanel } from './ShortlistPanel.js';
import { recipeFormMessages } from './messages.js';
import { quantityInputValue, type RecipeIngredientsFieldsProps } from './props.js';
import { useIngredientsFields } from './useIngredientsFields.js';

/** What a row draws with, beyond its view. */
interface RowDrawing {
    readonly m: RecipeFormMessages;
    readonly entryCopy: RowEntryFieldCopy;
    readonly nutrition: IngredientNutrition;
}

/** Slot 1's panel body, by the row policy's panel. Calories live in this panel, not on the row (R30). */
const GlyphPanelBody: FC<RowDrawing & { readonly row: IngredientRowView; readonly close: () => void }> = ({
    row,
    close,
    m,
    nutrition,
}): ReactElement => {
    const { body } = row;

    switch (body.kind) {
        case 'nutrition':
            return (
                <>
                    {/* §S1: the panel's heading is the root's name, and the dotted line sits under it. */}
                    {row.variantParts !== undefined && (
                        <span className="mb-2 block">
                            <VariantPartsLine parts={row.variantParts} tone="secondary" />
                        </span>
                    )}
                    <NutritionPanelBody
                        state={nutritionPanelOf(row.line, nutrition.lookup)}
                        onRetry={nutrition.retry}
                    />
                </>
            );
        case 'lookupFailed':
            // Try again hands the work to the glyph: the panel closes, focus returns to the glyph (which reads busy
            // while the ask runs), and the row updates in place. While it runs, the panel says so and offers no second
            // ask (V1 sign-off, busy rule 2).
            return row.retrying ? (
                <p role="status">{m.statusLookupRetrying}</p>
            ) : (
                <div className="flex flex-col items-start gap-2">
                    <p>{m.statusExplainFailed}</p>
                    <Button
                        variant="secondary"
                        icon={<RetryIcon />}
                        accessibilityLabel={fillTemplate(m.statusActionRetryLookupLabel, { food: row.triggerFood })}
                        onPress={() => {
                            close();
                            row.onRetryLookup();
                        }}
                    >
                        {m.statusActionRetry}
                    </Button>
                </div>
            );
        case 'explanation':
            return <p>{m[body.key]}</p>;
        case 'twoPaths':
            return <p>{fillTemplate(m.errorPromptEntryMode, { createLabel: m.createCustomFoodIconLabel })}</p>;
        case 'candidates':
        case 'shortlist':
            // Rows 6 and 7: what the food search finds for the line's own words, remote foods included; one pick binds
            // this line (SPECIFY.1 rows 6 and 7, S7 list contract P12).
            return <ShortlistPanel {...row.shortlist(close)} />;
        case 'foodRemovedNameless':
            return (
                <p>{fillTemplate(m.statusExplainFoodRemovedUnnamed, { changeFoodLabel: m.statusActionChangeFood })}</p>
            );
    }
};

/** The row's name: the entry combobox, the stand-in, or record text, by the row policy's name mode (§2b, §3b). */
const RowName: FC<RowDrawing & { readonly row: IngredientRowView }> = ({ row, m, entryCopy }): ReactElement => {
    if (row.presentation.nameMode === 'entry') {
        return (
            <div className="min-w-0 basis-full">
                <Combobox {...rowEntryFieldOf(row.entryField, entryCopy)} loadingIcon={<SearchIcon />} />
            </div>
        );
    }

    if (row.standIn) {
        return (
            <span id={ingredientStandInId(row.index)} className="basis-full">
                <StandIn tone={row.presentation.tone}>{row.displayName}</StandIn>
            </span>
        );
    }

    // Record text that wraps, in a group carrying the row's name, description and invalid state (§3b), so it cannot be
    // typed over and drift from the food supplying its calories.
    return (
        <div
            role="group"
            aria-label={fillTemplate(m.ingredientNameLabel, { number: row.number })}
            aria-invalid={row.nameInvalid || undefined}
            aria-describedby={row.describedBy.name}
            className="min-w-0 basis-full"
        >
            <span className="line-clamp-2 break-words text-body-md text-charcoal">{row.line.name}</span>
        </div>
    );
};

/** One row: its name, its sentences, its fields, its status word, and its two slots (§3a). */
const IngredientRow: FC<RowDrawing & { readonly row: IngredientRowView }> = (props): ReactElement => {
    const { row, m } = props;
    const { presentation, line, number } = row;

    return (
        <li
            className="flex flex-wrap items-center gap-2"
            // Item 4: focus leaving the row for somewhere outside it (`IngredientRowView.onFocusLeft`).
            onBlur={(event) => {
                const next = event.relatedTarget;

                if (!(next instanceof Node && event.currentTarget.contains(next))) {
                    row.onFocusLeft();
                }
            }}
        >
            {/* The name takes the row's first full line at every width, in both modes, so entering Change food moves
                nothing (`docs/design/ingredientStatusExplanation.md`, V3 amendment). */}
            <RowName {...props} />
            {row.variantParts !== undefined && presentation.nameMode === 'record' && (
                // The dotted line on a line of its own under the name (§S1). Hidden in Change food: it describes the
                // binding the cook is replacing (item 4).
                <span className="basis-full">
                    <VariantPartsLine parts={row.variantParts} tone="secondary" />
                </span>
            )}
            {row.busyText !== undefined && <span className="basis-full text-caption text-slate">{row.busyText}</span>}
            {row.pendingText !== undefined && (
                <span id={ingredientPendingTextId(line.key)} className={`basis-full ${errorText}`}>
                    {row.pendingText}
                </span>
            )}
            {row.failure !== undefined && (
                // Shown on the row; the field says it assertively, so this text is not live too (system change 2).
                <span id={ingredientCommitFailureId(line.key)} className={`basis-full ${errorText}`}>
                    {row.failure}
                </span>
            )}
            {row.noFoodNote !== undefined && (
                // `IngredientRowView.noFoodNote`. The chip is the design system's `StatusBadge` (namelessLineCopy §2c);
                // it takes no id and no role, so this wrapper carries both, as `StandIn`'s wrapper carries its id.
                <span id={ingredientNoFoodNoteId(row.index)} role="note">
                    <StatusBadge tone={presentation.tone}>{row.noFoodNote}</StatusBadge>
                </span>
            )}
            {/* The two bounds of R42's ranged quantity, sharing the ONE unit field that follows. An emptied field
                renders as empty (`quantityInputValue`), never as `0` or the literal "NaN" (R40). One group that does
                not wrap, so a range and its unit never split across lines; its fields narrow to fit 320 px (V3
                amendment, rule 2). */}
            <div className="flex min-w-0 items-center gap-2">
                <input
                    type="number"
                    aria-label={fillTemplate(m.ingredientQuantityLabel, { number })}
                    aria-invalid={row.quantityInvalid || undefined}
                    aria-describedby={row.describedBy.quantity}
                    value={quantityInputValue(line.quantity)}
                    onChange={(event) => row.edit.quantityLow(event.target.value)}
                    className={`${sizedField} w-24 min-w-16`}
                />
                {/* Punctuation, not copy — the same EN DASH `formatQuantity` prints between the bounds on the read
                    surface. Hidden from assistive tech: each input already carries its own accessible name. */}
                <span aria-hidden className="shrink-0 text-slate">
                    –
                </span>
                <input
                    type="number"
                    aria-label={fillTemplate(m.ingredientQuantityHighLabel, { number })}
                    aria-invalid={row.quantityInvalid || undefined}
                    aria-describedby={row.describedBy.quantityHigh}
                    value={quantityInputValue(line.quantityHigh)}
                    onChange={(event) => row.edit.quantityHigh(event.target.value)}
                    className={`${sizedField} w-24 min-w-16`}
                />
                <input
                    type="text"
                    aria-label={fillTemplate(m.ingredientUnitLabel, { number })}
                    // `IngredientRowView.unitNote`: it describes the field and never marks it invalid.
                    aria-describedby={row.describedBy.unit}
                    value={line.unit ?? ''}
                    onChange={(event) => row.edit.unit(event.target.value)}
                    className={`${fieldChrome} w-28 min-w-16 ${row.unitCanonical ? 'text-charcoal' : 'text-slate italic'}`}
                />
            </div>
            {row.unitNote !== undefined && (
                <span id={ingredientUnitNoteId(row.index)} className="text-caption text-slate">
                    {row.unitNote}
                </span>
            )}
            {/* U26 — the PREPARATION, its own field beside the food and never part of its name. The vocabulary is
                `recipe-import-core`'s `modifierLexicon.ts` (KTD-11b): a past participle or a temperature. An adjective
                is IDENTITY and arrives from the picker, inside the name. */}
            <input
                type="text"
                aria-label={fillTemplate(m.ingredientPreparationLabel, { number })}
                placeholder={m.ingredientPreparationPlaceholder}
                value={line.preparation ?? ''}
                onChange={(event) => row.edit.preparation(event.target.value)}
                className={`${sizedField} w-48`}
            />
            {/* U27 — the SECTION. Deliberately the LAST and quietest control on the row: the brief is explicit that
                per-row typing is the wrong PRIMARY interaction (a cook would type "For the marinade" eight times), so
                the primary path is the append inheriting the label from the line above and this stays the secondary
                way to start or change one. */}
            <input
                type="text"
                aria-label={fillTemplate(m.ingredientGroupLabel, { number })}
                placeholder={m.ingredientGroupPlaceholder}
                value={line.groupLabel ?? ''}
                onChange={(event) => row.edit.groupLabel(event.target.value)}
                className={`${sizedField} w-40`}
            />
            {presentation.statusWord !== undefined && (
                // The status word, from the row policy. Plain text announced with the row: `StatusBadge` is the design
                // system's chip, so its tones (and W2's charcoal-on-tint contrast rule) live once.
                <span id={ingredientStatusWordId(line.key)}>
                    <StatusBadge tone={presentation.tone}>{m[presentation.statusWord]}</StatusBadge>
                </span>
            )}
            {/* Slot 1 — the state glyph (R24, R25). Opened by activation only (R32, §6d). */}
            <Popover
                triggerLabel={row.labels.glyphTrigger}
                triggerIcon={presentation.glyph === 'alert' ? <AlertIcon /> : <InfoIcon />}
                title={row.displayName}
                closeLabel={row.labels.glyphClose}
                busy={row.glyphBusy}
                describedBy={presentation.statusWord === undefined ? undefined : ingredientStatusWordId(line.key)}
                focusRequested={row.glyphFocus.requested}
                onFocusRequestHandled={row.glyphFocus.onHandled}
                onDismissed={row.glyphFocus.onPanelDismissed}
            >
                {(close) => <GlyphPanelBody {...props} close={close} />}
            </Popover>
            {presentation.slot2.kind === 'menu' ? (
                // Slot 2 — the row's actions behind one `⋮`, remedy first (§3a). Try again lives in the row's panel,
                // not here: in a menu that the row's settled state removes, focus would fall to the page.
                <ActionMenu
                    triggerLabel={row.labels.actionsTrigger}
                    title={row.displayName}
                    closeLabel={row.labels.actionsClose}
                    items={row.actions}
                    focusRequested={row.actionsFocus.requested}
                    onFocusRequestHandled={row.actionsFocus.onHandled}
                    unavailable={row.busy}
                />
            ) : (
                // Slot 2 — one action is the control itself, never a one-item menu (§3a); it is always Remove.
                <Button variant="destructive" icon={<TrashIcon />} onPress={row.onRemove}>
                    {/* Icon-only on cramped phone rows (`sr-only`), full label from sm up (`sm:not-sr-only`). The label
                        stays in the accessibility tree, so the button's accessible name is unchanged. */}
                    <span className="sr-only sm:not-sr-only">{fillTemplate(m.removeIngredient, { number })}</span>
                </Button>
            )}
        </li>
    );
};

/** Step 2: the dynamic ingredient list, and the trailing add row after it. */
export const RecipeIngredientsFields: FC<RecipeIngredientsFieldsProps> = (props) => {
    const m = useMessages(recipeFormMessages);
    const model = useIngredientsFields(props);
    const { nutrition, rowEditor } = props;
    const { authoredFood, details } = rowEditor;
    const { trailing, total } = model;
    const drawing: RowDrawing = { m, entryCopy: model.entryCopy, nutrition };

    return (
        <section aria-label={m.ingredientsHeading} className={sectionCard}>
            <h2 className={sectionHeading}>{m.ingredientsHeading}</h2>
            {/* The settled retry's outcome, announced politely; focus does not move (V1 sign-off 3c). Always rendered,
                so the region exists before its text changes. */}
            <p role="status" className="sr-only">
                {model.lookupSettledMessage}
            </p>
            {/* What a row's settled pick did, politely, with the list closed (R3). Always rendered, as above. */}
            <p role="status" className="sr-only">
                {model.settledMessage}
            </p>
            {model.listError !== undefined && (
                <p id={ingredientsErrorId} className={errorText} role="alert">
                    {model.listError}
                </p>
            )}
            {model.sections.length === 0 ? (
                <p className="text-body-sm text-slate">{m.noIngredients}</p>
            ) : (
                <ul className="flex flex-col gap-3">
                    {model.sections.flatMap((section) => [
                        // The sections are interleaved in this ONE list (`useIngredientsFields`), with no heading for
                        // an unlabelled run. `role="presentation"` so the heading is not counted as a list item: the
                        // list's item count stays the ingredient count, while the `<h3>` inside stays a real heading
                        // under the section's own `h2`.
                        ...(section.label === undefined
                            ? []
                            : [
                                  <li key={section.key} role="presentation">
                                      <h3 className="text-body-sm font-semibold text-charcoal">{section.label}</h3>
                                  </li>,
                              ]),
                        // Keyed by the line's identity, never its index: an index key hands this row's DOM — its
                        // focused field, its open panel — to the row below when a line above is removed (plan 002 V1).
                        ...section.rows.map((row) => <IngredientRow key={row.line.key} row={row} {...drawing} />),
                    ])}
                </ul>
            )}
            {/* B8: the trailing add row. Nothing enters the draft until a pick (U28); then the line appends, the field
                empties, and focus stays in it (§2d). Below 640 px it takes a full-width line, as row names do. */}
            <div className="flex flex-col gap-1">
                <Combobox
                    {...trailingEntryFieldOf(trailing.entryField, model.entryCopy)}
                    leadingIcon={<PlusIcon />}
                    loadingIcon={<SearchIcon />}
                />
                {trailing.busyText !== undefined && (
                    <span className="text-caption text-slate">{trailing.busyText}</span>
                )}
                {trailing.pendingText !== undefined && (
                    <span id={trailingPendingTextId} className={errorText}>
                        {trailing.pendingText}
                    </span>
                )}
                {trailing.failure !== undefined && (
                    // Shown here; the field says it assertively, so this text is not live too (system change 2).
                    <span id={trailingCommitFailureId} className={errorText}>
                        {trailing.failure}
                    </span>
                )}
            </div>
            <AuthoredFoodSheet
                state={authoredFood.state}
                onFieldChange={authoredFood.setField}
                onSubmit={authoredFood.submit}
                onReuse={authoredFood.reuseExisting}
                onCancel={authoredFood.cancel}
                // After a success the row's glyph takes focus (item 1), once the Sheet's own return to `⋮` is done.
                // After any other close that return is where focus belongs.
                onDismissed={() => {
                    model.focus.authoredSheetDismissed();
                }}
            />
            {/* One details dialog, for the line whose `⋮` opened it. Its own focus return goes back to that `⋮`
                (§S8.8): the menu put focus there before it opened the dialog. */}
            <VariantDetailsDialog open={model.details.open} foodName={model.details.foodName} details={details.model} />
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
                        {model.rangeNotice !== undefined && (
                            <p className="text-caption text-slate">{model.rangeNotice}</p>
                        )}
                    </>
                )}
            </div>
        </section>
    );
};
