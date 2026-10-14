/**
 * @module @commise/features-recipes/form — `RecipeIngredientsFields` (native): the editor's Ingredients section body
 * (build spec §7.5). The React Native leaf of `./RecipeIngredientsFields.tsx`: quiet read rows with their `⋯`, the row
 * editor (a sheet on a phone, inline on a tablet: §7.12, by the window's content width), the groups, the one add field,
 * Paste a list in the empty section, and the running total.
 *
 * This orchestration component takes the section's state, focus and views from `useIngredientsFields` and draws them
 * with native's own mechanisms: an entry field's list is in flow below it (`docs/design/rowEditorOpenDecisions.md` item
 * 7), a refused field says its sentence in its own alert (`useSpokenRefusal`), and the reading cursor returns to a
 * row's `⋯` once a sheet that row opened has gone (items 1 and 8, §S8.8).
 *
 * @pattern Mediator — between the host's row-editor controllers and the row controls, through `useIngredientsFields`
 */
import { Button } from '@commise/ui/button';
import { Combobox, type ComboboxArrival } from '@commise/ui/combobox';
import { Icon } from '@commise/ui/icon';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { useLocale, useMessages } from '@commise/i18n/react';
import { useState, type FC, type ReactNode } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { VariantDetailsDialog } from '../details/VariantDetailsDialog.native.js';
import { editorMessages, pluralOf } from '../editor/messages.js';
import { useLastDefined } from '../hooks/useLastDefined.js';
import { useMainContainerClass } from '../layout/useMainContainerClass.js';
import { AuthoredFoodSheet } from './AuthoredFoodSheet.native.js';
import { FoodDetailsSheet } from './FoodDetailsSheet.native.js';
import { ingredientsErrorId, trailingCommitFailureId, trailingPendingTextId } from './fieldErrorIds.js';
import { GroupNameField } from './GroupNameField.native.js';
import { IngredientGroupHeading } from './IngredientGroupHeading.native.js';
import { IngredientLineEditor } from './IngredientLineEditor.native.js';
import { IngredientLineEditorSheet } from './IngredientLineEditorSheet.native.js';
import { IngredientRow } from './IngredientRow.native.js';
import { IngredientRowPanelBody } from './IngredientRowPanelBody.native.js';
import type { IngredientRowView } from './ingredientRowView.js';
import { IngredientsNutritionTotal } from './IngredientsNutritionTotal.native.js';
import { recipeFormMessages } from './messages.js';
import { MoveToGroupSheet } from './MoveToGroupSheet.native.js';
import { PastedReadingRow } from './PastedReadingRow.native.js';
import type { RecipeIngredientsFieldsProps } from './props.js';
import { trailingEntryFieldOf } from './trailingEntryField.js';
import type { SectionAddView } from './useIngredientGroups.js';
import { useIngredientsFields, type IngredientsFieldsModel } from './useIngredientsFields.js';
import { useSpokenRefusal, type SpeakRefusal } from './useSpokenRefusal.js';

/** The dp between a group's list and the add field under it: the stack lays it out, and an arrival adds it. */
const LIST_TO_FIELD_DP = nativeTokens.spacing[1];

/** The one add field, with its reading, its notices and its sentences (§7.5.3). */
const AddField: FC<{
    readonly model: IngredientsFieldsModel;
    readonly speak: SpeakRefusal;
    readonly arrival: ComboboxArrival | undefined;
    readonly trailingAction?: ReactNode;
}> = ({ model, speak, arrival, trailingAction }) => {
    const m = useMessages(recipeFormMessages);
    const { colors } = useTheme();
    const { trailing } = model;
    const caption = [styles.caption, { color: colors.inkMuted }];
    const error = [styles.caption, { color: colors.dangerText }];

    return (
        <View style={styles.stack}>
            <Combobox
                // PLATFORM-FORK: native has no `aria-describedby`; the refused field's own alert says its sentence.
                {...trailingEntryFieldOf(
                    { ...speak(trailing.entryField, 'newLine', trailing.pendingText), describedBy: undefined },
                    model.entryCopy,
                )}
                leadingIcon={<Icon name="plus" size={16} tone="inkMuted" />}
                loadingIcon={<Icon name="search" size={16} tone="inkMuted" />}
                // PLATFORM-FORK: the row a pick just added is shown with this field by asking the scroller's field
                // reveal host; web scrolls the page itself (`ingredientArrival.md`).
                {...(arrival === undefined ? {} : { arrival })}
                // How the text was read, and "Pick a food from the list." (§7.5.3): under the field, above its list.
                belowField={
                    <>
                        {trailing.readingShown === undefined ? null : (
                            <Text style={caption}>{trailing.readingShown}</Text>
                        )}
                        <LiveRegion politeness="polite" style={error}>
                            {trailing.pickFoodNotice ?? ''}
                        </LiveRegion>
                    </>
                }
                clear={{ label: m.ingredientEntryClear, icon: <Icon name="x" size={20} tone="inkMuted" /> }}
                {...(trailingAction === undefined ? {} : { trailingAction })}
            />
            <LiveRegion politeness="polite" visuallyHidden>
                {trailing.readingSpoken}
            </LiveRegion>
            {trailing.busyText !== undefined && <Text style={caption}>{trailing.busyText}</Text>}
            {trailing.pendingText !== undefined && (
                <Text nativeID={trailingPendingTextId} style={error}>
                    {trailing.pendingText}
                </Text>
            )}
            {trailing.failure !== undefined && (
                // Shown here; the field says it assertively, so this text is not live too (system change 2).
                <Text nativeID={trailingCommitFailureId} style={error}>
                    {trailing.failure}
                </Text>
            )}
        </View>
    );
};

/** What sits at a group's foot: the add field, or the button that moves it there. */
const GroupFoot: FC<{
    readonly add: SectionAddView;
    readonly model: IngredientsFieldsModel;
    readonly speak: SpeakRefusal;
    readonly arrival: ComboboxArrival | undefined;
}> = ({ add, model, speak, arrival }) => {
    switch (add.kind) {
        case 'none':
            return null;
        case 'field':
            return <AddField model={model} speak={speak} arrival={arrival} />;
        case 'button':
            return (
                <View style={styles.row}>
                    <Button variant="ghost" icon="plus" onPress={add.onPress}>
                        {add.label}
                    </Button>
                </View>
            );
    }
};

/** The Ingredients section body. */
export const RecipeIngredientsFields: FC<RecipeIngredientsFieldsProps> = (props) => {
    const m = useMessages(recipeFormMessages);
    const { ingredients: editor } = useMessages(editorMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const model = useIngredientsFields(props);
    const { nutrition, rowEditor, paste } = props;
    const reading = paste?.reading ?? [];
    const { authoredFood, details } = rowEditor;
    const { focus } = model;
    const speak = useSpokenRefusal(rowEditor.pendingRefusals);
    // §7.12: a sheet on a phone, inline on a tablet (from a 600 pt content width).
    const inline = useMainContainerClass() !== 'narrow';
    // The add field when no run holds it: the empty section, or a list whose rows are all being read.
    const addFieldHere =
        model.sections.length === 0 && !model.emptyGroups.some((group) => group.addHere.kind === 'field');
    // §7.5.4: Paste a list is offered in the empty section only.
    const pasteButton =
        paste?.onOpen !== undefined && model.sections.length === 0 && reading.length === 0 ? (
            <Button variant="secondary" icon="clipboardPaste" onPress={paste.onOpen}>
                {editor.pasteList}
            </Button>
        ) : null;
    const pasteBesideField = pasteButton !== null && addFieldHere && inline;
    const amountColumn = inline ? 96 : 72;
    const rows = model.sections.flatMap((section) => section.rows);
    // The new row's height, once it has laid out: the add field asks for the row only then, so the ask is made once, with
    // the real distance (`ingredientArrival.md`). A later change of the row's height does not ask again.
    const [arrivedRow, setArrivedRow] = useState<{ readonly key: string; readonly height: number } | undefined>(
        undefined,
    );
    const arrival: ComboboxArrival | undefined =
        model.arrival !== undefined && arrivedRow?.key === model.arrival.key
            ? { key: arrivedRow.key, aboveDp: arrivedRow.height + LIST_TO_FIELD_DP }
            : undefined;
    const sheetKey = useLastDefined(model.openRow?.line.key);
    const sheetRow = rows.find((row) => row.line.key === sheetKey);
    // PLATFORM-FORK: React Native cannot read where the reading cursor was, so this leaf returns it to the row's `⋯` once
    // a sheet that row opened has gone (items 1 and 8, §S8.8). The authored-food Sheet's row is remembered here because
    // its `target` is gone by then.
    const authoredRow = useLastDefined(authoredFood.target?.kind === 'line' ? authoredFood.target.key : undefined);
    const panelOf =
        (row: IngredientRowView) =>
        (close: () => void): ReactNode => (
            <IngredientRowPanelBody row={row} m={m} nutrition={nutrition} close={close} />
        );
    const detailsOf = (row: IngredientRowView): ReactNode => panelOf(row)(row.lineEditor.onToggleDetails);
    const empty = model.sections.length === 0 && reading.length === 0;

    const rowOf = (row: IngredientRowView): ReactNode => (
        <IngredientRow
            key={row.line.key}
            row={row}
            m={m}
            entryCopy={model.entryCopy}
            speak={speak}
            panel={panelOf(row)}
            expanded={inline ? row.editorOpen : undefined}
            amountColumn={amountColumn}
            arrived={model.arrival?.key === row.line.key}
            {...(model.arrival?.key === row.line.key
                ? {
                      onLayout: (event: LayoutChangeEvent) => {
                          setArrivedRow({ key: row.line.key, height: event.nativeEvent.layout.height });
                      },
                  }
                : {})}
            inlineEditor={
                inline && row.editorOpen ? (
                    <View style={[styles.inlineEditor, { backgroundColor: colors.surfaceMuted }]}>
                        <IngredientLineEditor view={row.lineEditor} index={row.index} m={m} details={detailsOf(row)} />
                        <View style={styles.end}>
                            <Button variant="secondary" icon="check" onPress={row.lineEditor.onDone}>
                                {m.rowDone}
                            </Button>
                        </View>
                    </View>
                ) : null
            }
        />
    );

    return (
        // Slice 7: the editor's section holds the heading ("Ingredients"); this leaf is the body under it. No card (§7.1).
        <View style={styles.section}>
            {/* The settled retry's outcome, announced politely (V1 sign-off 3c). */}
            <LiveRegion politeness="polite" visuallyHidden>
                {model.lookupSettledMessage}
            </LiveRegion>
            {/* What a row's settled pick did, politely, with the list closed (R3). */}
            <LiveRegion politeness="polite" visuallyHidden>
                {model.settledMessage}
            </LiveRegion>
            {model.listError !== undefined && (
                <Text
                    nativeID={ingredientsErrorId}
                    accessibilityRole="alert"
                    style={[styles.body, { color: colors.dangerText }]}
                >
                    {model.listError}
                </Text>
            )}
            <LiveRegion politeness="polite" visuallyHidden>
                {paste?.added === undefined ? '' : pluralOf(editor.pasteAdded, paste.added.count, locale)}
            </LiveRegion>
            {empty ? (
                <Text style={[styles.body, { color: colors.inkMuted }]}>{m.noIngredients}</Text>
            ) : (
                model.sections.map((section) => (
                    <View key={section.key} style={styles.stack}>
                        {section.group !== undefined && (
                            <IngredientGroupHeading id={`${section.key}-heading`} group={section.group} />
                        )}
                        {/* N1 (`docs/design/nativeContainerNames.md`): no list is named. The editor's section already
                            says "Ingredients", and a group's heading says its name, so a name here would be said
                            twice (N3). The node is kept so the role reaches TalkBack and Maestro. */}
                        <View role="list" collapsable={false}>
                            {section.rows.map(rowOf)}
                        </View>
                        <GroupFoot add={section.addHere} model={model} speak={speak} arrival={arrival} />
                    </View>
                ))
            )}
            {/* Pasted lines being read follow the list's own rows (§7.5.4). */}
            {reading.map((row) => (
                <PastedReadingRow key={row.key} row={row} onRetry={paste?.onRetry} />
            ))}
            {model.emptyGroups.map((group) => (
                <View key={group.key} style={styles.stack}>
                    {group.group !== undefined && (
                        <IngredientGroupHeading id={`${group.key}-heading`} group={group.group} />
                    )}
                    <GroupFoot add={group.addHere} model={model} speak={speak} arrival={arrival} />
                </View>
            ))}
            {addFieldHere && (
                <AddField
                    model={model}
                    speak={speak}
                    arrival={arrival}
                    {...(pasteBesideField ? { trailingAction: pasteButton } : {})}
                />
            )}
            {/* §7.5.4: in the empty section, Paste a list is a secondary button beside the add field from a 600
                content width, and under it below that, so the field keeps its width (§7.12). */}
            {pasteButton !== null && !pasteBesideField && <View style={styles.row}>{pasteButton}</View>}
            {/* §7.5.5: "+ Add a group" at the section's foot. */}
            {model.addGroup.field === undefined ? (
                <View style={styles.row}>
                    <Button
                        variant="ghost"
                        icon="plus"
                        onPress={model.addGroup.onOpen}
                        focusRequested={model.addGroup.focusRequested}
                        onFocusRequestHandled={model.addGroup.onFocusRequestHandled}
                    >
                        {model.addGroup.label}
                    </Button>
                </View>
            ) : (
                <GroupNameField field={model.addGroup.field} />
            )}
            <View style={[styles.total, { backgroundColor: colors.surfaceMuted }]}>
                <IngredientsNutritionTotal
                    view={model.totalView}
                    loadingLabel={m.nutritionLoading}
                    failedText={m.nutritionLoadFailed}
                    retryLabel={m.statusActionRetry}
                    onRetry={nutrition.retry}
                />
            </View>
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
                // Once it has gone (item 8's one-Modal-at-a-time rule): the row after a success (item 1), else `⋯`.
                onDismissed={() => {
                    if (!focus.authoredSheetDismissed() && authoredRow !== undefined) {
                        focus.request(authoredRow, 'actions');
                    }
                }}
            />
            <VariantDetailsDialog
                open={model.details.open}
                foodName={model.details.foodName}
                details={details.model}
                // §S8.8: on every close the cursor returns to the row's `⋯`, once the sheet has gone.
                onDismissed={() => {
                    if (model.details.line !== undefined) {
                        focus.request(model.details.line.key, 'actions');
                    }
                }}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    section: { gap: nativeTokens.spacing[4] },
    stack: { gap: LIST_TO_FIELD_DP },
    row: { flexDirection: 'row' },
    end: { flexDirection: 'row', justifyContent: 'flex-end' },
    body: { ...nativeTokens.type.body },
    caption: { ...nativeTokens.type.caption },
    inlineEditor: {
        gap: nativeTokens.spacing[4],
        padding: nativeTokens.spacing[4],
        marginBottom: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.md,
    },
    total: {
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.md,
    },
});
