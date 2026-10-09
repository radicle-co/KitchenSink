'use client';

/**
 * @module @commise/features-recipes/form — `RecipeIngredientsFields` (web): the editor's Ingredients section body
 * (build spec §7.5): quiet read rows with their `⋯`, the row editor (a sheet below a 600 container, inline from 600),
 * the groups, the one add field (type the amount, then pick the food), Paste a list in the empty section, and the
 * running total at the section's foot.
 *
 * This orchestration component takes the section's state, focus and views from `useIngredientsFields` and picks the
 * row editor's frame by the container's class (`useMainContainerClass`); the leaves only draw. Rows are grouped in one
 * list per run: an ungrouped recipe is one list named "Ingredients" with no group chrome, and each group's list is named
 * by its heading. A row that moves to another group remounts under it, and its `⋯` takes focus back by request.
 *
 * @pattern Mediator — between the host's row-editor controllers and the row controls, through `useIngredientsFields`
 */
import { Button } from '@commise/ui/button';
import { Combobox } from '@commise/ui/combobox';
import { Icon } from '@commise/ui/icon';
import { useLocale, useMessages } from '@commise/i18n/react';
import { type FC, type ReactNode } from 'react';

import { VariantDetailsDialog } from '../details/VariantDetailsDialog.js';
import { editorMessages, pluralOf } from '../editor/messages.js';
import { useLastDefined } from '../hooks/useLastDefined.js';
import { useMainContainerClass } from '../layout/useMainContainerClass.js';
import { AuthoredFoodSheet } from './AuthoredFoodSheet.js';
import { FoodDetailsSheet } from './FoodDetailsSheet.js';
import { ingredientsErrorId, trailingCommitFailureId, trailingPendingTextId } from './fieldErrorIds.js';
import { errorText } from './formSectionStyles.js';
import { GroupNameField } from './GroupNameField.js';
import { IngredientGroupHeading } from './IngredientGroupHeading.js';
import { IngredientLineEditor } from './IngredientLineEditor.js';
import { IngredientLineEditorSheet } from './IngredientLineEditorSheet.js';
import { IngredientRow } from './IngredientRow.js';
import { IngredientRowPanelBody } from './IngredientRowPanelBody.js';
import type { IngredientRowView } from './ingredientRowView.js';
import { IngredientsNutritionTotal } from './IngredientsNutritionTotal.js';
import { recipeFormMessages } from './messages.js';
import { MoveToGroupSheet } from './MoveToGroupSheet.js';
import { PastedReadingRow } from './PastedReadingRow.js';
import type { RecipeIngredientsFieldsProps } from './props.js';
import { trailingEntryFieldOf } from './trailingEntryField.js';
import type { SectionAddView } from './useIngredientGroups.js';
import { useIngredientsFields, type IngredientsFieldsModel } from './useIngredientsFields.js';

/** The one add field, with its reading, its notices and its sentences (§7.5.3). */
const AddField: FC<{ readonly model: IngredientsFieldsModel }> = ({ model }) => {
    const { trailing } = model;

    return (
        <div className="flex flex-col gap-1">
            <Combobox
                {...trailingEntryFieldOf(trailing.entryField, model.entryCopy)}
                // How the text was read, and "Pick a food from the list." (§7.5.3), directly under the field. The
                // reading is said to a screen reader, after a pause, below.
                belowField={
                    <>
                        {trailing.readingShown === undefined ? null : (
                            <span className="text-caption text-ink-muted">{trailing.readingShown}</span>
                        )}
                        <p role="status" className={trailing.pickFoodNotice === undefined ? 'sr-only' : errorText}>
                            {trailing.pickFoodNotice ?? ''}
                        </p>
                    </>
                }
                leadingIcon={<Icon name="plus" size={16} />}
                loadingIcon={<Icon name="search" size={16} />}
            />
            <p role="status" className="sr-only">
                {trailing.readingSpoken}
            </p>
            {trailing.busyText !== undefined && (
                <span className="text-caption text-ink-muted">{trailing.busyText}</span>
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
    );
};

/** What sits at a group's foot: the add field, or the button that moves it there. */
const GroupFoot: FC<{ readonly add: SectionAddView; readonly model: IngredientsFieldsModel }> = ({ add, model }) => {
    switch (add.kind) {
        case 'none':
            return null;
        case 'field':
            return <AddField model={model} />;
        case 'button':
            return (
                <div className="flex">
                    <Button variant="ghost" icon="plus" onPress={add.onPress}>
                        {add.label}
                    </Button>
                </div>
            );
    }
};

/** The Ingredients section body. */
export const RecipeIngredientsFields: FC<RecipeIngredientsFieldsProps> = (props) => {
    const m = useMessages(recipeFormMessages);
    const { ingredients: editor, index } = useMessages(editorMessages);
    const locale = useLocale();
    const model = useIngredientsFields(props);
    const { nutrition, rowEditor, paste } = props;
    const reading = paste?.reading ?? [];
    const { authoredFood, details } = rowEditor;
    // §7.5.2: the row editor is a sheet below a 600 container and inline from 600.
    const inline = useMainContainerClass() !== 'narrow';
    const rows = model.sections.flatMap((section) => section.rows);
    // The sheet keeps its row while it closes; the key is kept, never the row object.
    const sheetKey = useLastDefined(model.openRow?.line.key);
    const sheetRow = rows.find((row) => row.line.key === sheetKey);
    const panelOf =
        (row: IngredientRowView) =>
        (close: () => void): ReactNode => (
            <IngredientRowPanelBody row={row} m={m} nutrition={nutrition} close={close} />
        );
    const detailsOf = (row: IngredientRowView): ReactNode => panelOf(row)(row.lineEditor.onToggleDetails);
    const empty = model.sections.length === 0 && reading.length === 0;

    const rowOf = (row: IngredientRowView): ReactNode => (
        <IngredientRow
            // Keyed by the line's identity, never its index: an index key hands this row's DOM (its focused field, its
            // open panel) to the row below when a line above is removed (plan 002 V1).
            key={row.line.key}
            row={row}
            entryCopy={model.entryCopy}
            panel={panelOf(row)}
            expanded={inline ? row.editorOpen : undefined}
            inlineEditor={
                inline && row.editorOpen ? (
                    <div
                        className="mb-3 flex flex-col gap-4 rounded-md bg-surface-muted/60 p-4"
                        // Escape closes the editor and focus returns to the row (§7.5.2).
                        onKeyDown={(event) => {
                            if (event.key === 'Escape' && !event.defaultPrevented) {
                                event.preventDefault();
                                row.lineEditor.onDone();
                            }
                        }}
                    >
                        <IngredientLineEditor view={row.lineEditor} index={row.index} m={m} details={detailsOf(row)} />
                        <div className="flex justify-end">
                            <Button variant="secondary" icon="check" onPress={row.lineEditor.onDone}>
                                {m.rowDone}
                            </Button>
                        </div>
                    </div>
                ) : null
            }
        />
    );

    return (
        // Slice 7: the editor's section holds the region and its H2 ("Ingredients"); this leaf is the body under it.
        // One form needs no cards (§7.1).
        <div className="flex flex-col gap-4">
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
            <p role="status" className="sr-only">
                {paste?.added === undefined ? '' : pluralOf(editor.pasteAdded, paste.added.count, locale)}
            </p>
            {empty ? (
                <p className="text-body-sm text-ink-muted">{m.noIngredients}</p>
            ) : (
                <>
                    {model.sections.map((section, at) => {
                        const headingId = `${section.key}-heading`;

                        return (
                            <div key={section.key} className="flex flex-col gap-1">
                                {section.group !== undefined && (
                                    <IngredientGroupHeading id={headingId} group={section.group} />
                                )}
                                <ul
                                    {...(section.group === undefined
                                        ? { 'aria-label': index.sections.ingredients }
                                        : { 'aria-labelledby': headingId })}
                                    className="flex flex-col"
                                >
                                    {section.rows.map(rowOf)}
                                    {/* Pasted lines being read follow the list's own rows (§7.5.4). */}
                                    {at === model.sections.length - 1 &&
                                        reading.map((row) => (
                                            <PastedReadingRow key={row.key} row={row} onRetry={paste?.onRetry} />
                                        ))}
                                </ul>
                                <GroupFoot add={section.addHere} model={model} />
                            </div>
                        );
                    })}
                    {model.sections.length === 0 && (
                        <ul aria-label={index.sections.ingredients} className="flex flex-col">
                            {reading.map((row) => (
                                <PastedReadingRow key={row.key} row={row} onRetry={paste?.onRetry} />
                            ))}
                        </ul>
                    )}
                </>
            )}
            {model.emptyGroups.map((group) => (
                <div key={group.key} className="flex flex-col gap-1">
                    {group.group !== undefined && (
                        <IngredientGroupHeading id={`${group.key}-heading`} group={group.group} />
                    )}
                    <GroupFoot add={group.addHere} model={model} />
                </div>
            ))}
            {paste?.onOpen !== undefined && model.sections.length === 0 && reading.length === 0 && (
                // §7.5.4: in the empty section, Paste a list sits beside the add field as a secondary button.
                <div className="flex">
                    <Button variant="secondary" icon="clipboardPaste" onPress={paste.onOpen}>
                        {editor.pasteList}
                    </Button>
                </div>
            )}
            {/* The add field when no run holds it: the empty section, or a list whose rows are all being read. */}
            {model.sections.length === 0 && !model.emptyGroups.some((group) => group.addHere.kind === 'field') && (
                <AddField model={model} />
            )}
            {/* §7.5.5: "+ Add a group" at the section's foot; an ungrouped recipe shows no other group chrome. */}
            <div className="flex flex-col gap-2">
                {model.addGroup.field === undefined ? (
                    <div className="flex">
                        <Button
                            variant="ghost"
                            icon="plus"
                            onPress={model.addGroup.onOpen}
                            focusRequested={model.addGroup.focusRequested}
                            onFocusRequestHandled={model.addGroup.onFocusRequestHandled}
                        >
                            {model.addGroup.label}
                        </Button>
                    </div>
                ) : (
                    <GroupNameField field={model.addGroup.field} />
                )}
            </div>
            <div className="rounded-md bg-surface-muted px-4 py-3">
                <IngredientsNutritionTotal
                    view={model.totalView}
                    loadingLabel={m.nutritionLoading}
                    failedText={m.nutritionLoadFailed}
                    retryLabel={m.statusActionRetry}
                    onRetry={nutrition.retry}
                />
            </div>
            {inline ? null : (
                <IngredientLineEditorSheet
                    open={model.openRow !== undefined}
                    row={sheetRow}
                    m={m}
                    details={sheetRow === undefined ? null : detailsOf(sheetRow)}
                />
            )}
            <FoodDetailsSheet view={model.foodDetails} closeLabel={model.foodDetails.row?.labels.panelClose ?? ''}>
                {model.foodDetails.row === undefined ? null : panelOf(model.foodDetails.row)(model.foodDetails.onClose)}
            </FoodDetailsSheet>
            <MoveToGroupSheet view={model.moveToGroup} />
            <AuthoredFoodSheet
                state={authoredFood.state}
                onFieldChange={authoredFood.setField}
                onSubmit={authoredFood.submit}
                onReuse={authoredFood.reuseExisting}
                onCancel={authoredFood.cancel}
                // After a success the row's open control takes focus (item 1), once the Sheet's own return is done.
                onDismissed={() => {
                    model.focus.authoredSheetDismissed();
                }}
            />
            {/* One details dialog, for the line whose `⋯` opened it. Its own focus return goes back to that `⋯`
                (§S8.8): the menu put focus there before it opened the dialog. */}
            <VariantDetailsDialog open={model.details.open} foodName={model.details.foodName} details={details.model} />
        </div>
    );
};
