/**
 * @module @commise/features-recipes/form — `RecipeIngredientsFields` (native): step 2 of the recipe form, the
 * dynamic ingredient list, the trailing add row after it, and the running nutrition total. The trailing add row is an
 * entry combobox (plan 002 V1 B8, `./trailingEntryField.ts`), with native's clear button.
 *
 * The React Native leaf of `./RecipeIngredientsFields.tsx`: a step body of the 4-step edit wizard
 * (`wizard/Wizard.native.tsx`). This orchestration component takes the group's state, focus and row views from
 * `useIngredientsFields` and draws them with native's own mechanisms: the entry field's list is in flow below it
 * (`docs/design/rowEditorOpenDecisions.md` item 7), a field that is not in Change food has a clear button, Android
 * back cancels Change food (item 4), and the reading cursor returns to a row's `⋮` once a sheet it opened has gone
 * (items 1 and 8, §S8.8).
 *
 * @pattern Mediator — between the host's row-editor controllers and the row controls, through `useIngredientsFields`
 */
import { ActionMenu } from '@commise/ui/action-menu';
import { useBackIntercept } from '@commise/ui/back-intercept';
import { Button } from '@commise/ui/button';
import { Combobox } from '@commise/ui/combobox';
import { useKeyboardHidden } from '@commise/ui/layout';
import { LiveRegion } from '@commise/ui/live-region';
import { Popover } from '@commise/ui/popover';
import { StandIn } from '@commise/ui/stand-in';
import { StatusBadge } from '@commise/ui/status-badge';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { TextInput } from '@commise/ui/text-input';
import { Feather } from '@expo/vector-icons';
import type { FC, ReactElement } from 'react';
import { Text, View } from 'react-native';

import { VariantDetailsDialog } from '../details/VariantDetailsDialog.native.js';
import { useLastDefined } from '../hooks/useLastDefined.js';
import { AuthoredFoodSheet } from './AuthoredFoodSheet.native.js';
import { fillTemplate } from '../list/model.js';
import {
    ingredientCommitFailureId,
    ingredientPendingTextId,
    ingredientNoFoodNoteId,
    ingredientStandInId,
    ingredientsErrorId,
    ingredientUnitNoteId,
    trailingCommitFailureId,
    trailingPendingTextId,
} from './fieldErrorIds.js';
import type { IngredientRowView } from './ingredientRowView.js';
import type { RecipeFormMessages } from './messages.js';
import type { IngredientNutrition } from './nutritionLookup.js';
import { nutritionPanelOf } from './nutritionPanel.js';
import { rowEntryFieldOf, type RowEntryFieldCopy } from './rowEntryField.js';
import { trailingEntryFieldOf } from './trailingEntryField.js';
import { NutritionPanelBody } from './NutritionPanelBody.native.js';
import { ShortlistPanel } from './ShortlistPanel.native.js';
import { recipeFormMessages } from './messages.js';
import { styles } from './formSectionStyles.native.js';
import { quantityInputValue, type RecipeIngredientsFieldsProps } from './props.js';
import { useIngredientsFields } from './useIngredientsFields.js';
import { useSpokenRefusal, type SpeakRefusal } from './useSpokenRefusal.js';

/**
 * Native's two ways out of Change food on the row it is mounted for (item 4). Android back cancels it. The keyboard
 * closing ends it when nothing new was typed, the native reading of focus leaving the row. It is mounted only while
 * that row is in Change food, so the back chain, which asks its newest link first, offers it the press before the
 * wizard's own guard.
 */
const ChangeFoodExits: FC<{ readonly onBack: () => void; readonly onKeyboardHidden: () => void }> = ({
    onBack,
    onKeyboardHidden,
}) => {
    useBackIntercept(() => {
        onBack();

        return true;
    });
    useKeyboardHidden(onKeyboardHidden);

    return null;
};

/** What a row draws with, beyond its view. */
interface RowDrawing {
    readonly m: RecipeFormMessages;
    readonly entryCopy: RowEntryFieldCopy;
    readonly nutrition: IngredientNutrition;
    readonly speak: SpeakRefusal;
}

/** Slot 1's sheet body, by the row policy's panel. Calories live in this panel, not on the row (R30). */
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
                <View style={styles.panelStack}>
                    {/* §S1: the sheet's title is the root's name, and the dotted line sits under it. */}
                    {row.variantParts !== undefined && <VariantPartsLine parts={row.variantParts} tone="secondary" />}
                    <NutritionPanelBody
                        state={nutritionPanelOf(row.line, nutrition.lookup)}
                        onRetry={nutrition.retry}
                    />
                </View>
            );
        case 'lookupFailed':
            // Try again closes the sheet and the glyph reads busy; while the ask runs, the sheet says so and offers no
            // second ask (V1 sign-off, busy rule 2).
            return row.retrying ? (
                <Text accessibilityLiveRegion="polite" style={styles.panelText}>
                    {m.statusLookupRetrying}
                </Text>
            ) : (
                <View style={styles.panelStack}>
                    <Text style={styles.panelText}>{m.statusExplainFailed}</Text>
                    <View style={styles.addAction}>
                        <Button
                            variant="secondary"
                            icon={<Feather name="refresh-cw" size={16} color={palette.charcoal} />}
                            accessibilityLabel={fillTemplate(m.statusActionRetryLookupLabel, { food: row.triggerFood })}
                            onPress={() => {
                                close();
                                row.onRetryLookup();
                            }}
                        >
                            {m.statusActionRetry}
                        </Button>
                    </View>
                </View>
            );
        case 'explanation':
            return <Text style={styles.panelText}>{m[body.key]}</Text>;
        case 'twoPaths':
            return (
                <Text style={styles.panelText}>
                    {fillTemplate(m.errorPromptEntryMode, { createLabel: m.createCustomFoodIconLabel })}
                </Text>
            );
        case 'candidates':
        case 'shortlist':
            // Rows 6 and 7: what the food search finds for the line's own words, remote foods included; one pick binds
            // this line (SPECIFY.1 rows 6 and 7, S7 list contract P12).
            return <ShortlistPanel {...row.shortlist(close)} />;
        case 'foodRemovedNameless':
            return (
                <Text style={styles.panelText}>
                    {fillTemplate(m.statusExplainFoodRemovedUnnamed, { changeFoodLabel: m.statusActionChangeFood })}
                </Text>
            );
    }
};

/** The row's name: the entry combobox, the stand-in, or record text, by the row policy's name mode (§2b, §3b). */
const RowName: FC<RowDrawing & { readonly row: IngredientRowView }> = ({ row, m, entryCopy, speak }): ReactElement => {
    if (row.presentation.nameMode === 'entry') {
        return (
            // The entry field and its in-flow list take the name's whole line (item 7).
            <View style={styles.rowGrow}>
                <Combobox
                    // PLATFORM-FORK: native has no `aria-describedby`, so a refused field says its row sentence in its
                    // own alert (`useSpokenRefusal`); on web the sentence describes the field.
                    {...rowEntryFieldOf(speak(row.entryField, row.line.key, row.pendingText), entryCopy)}
                    loadingIcon={<Feather name="search" size={16} color={palette.slate} />}
                    // Item 4: a row in Change food has Cancel instead.
                    {...(row.changing
                        ? {}
                        : {
                              clear: {
                                  label: m.ingredientEntryClear,
                                  icon: <Feather name="x" size={18} color={palette.slate} />,
                              },
                          })}
                />
            </View>
        );
    }

    if (row.standIn) {
        return (
            <View id={ingredientStandInId(row.index)}>
                <StandIn tone={row.presentation.tone}>{row.displayName}</StandIn>
            </View>
        );
    }

    // §3b (`docs/design/ingredientStatusExplanation.md`): a matched name is text, which wraps and clamps reliably where
    // a read-only `TextInput` does neither, and which no one can type over. The group carries the row's name; the text
    // stays its own node, so the screen reader still reads the food.
    return (
        <View
            collapsable={false}
            role="group"
            aria-label={fillTemplate(m.ingredientNameLabel, { number: row.number })}
            aria-invalid={row.nameInvalid || undefined}
            aria-describedby={row.describedBy.name}
            style={styles.rowGrow}
        >
            <Text numberOfLines={2} style={styles.recordName}>
                {row.line.name}
            </Text>
        </View>
    );
};

/** One row: its name, its sentences, its fields, its status word, and its two slots (§3a). */
const IngredientRow: FC<RowDrawing & { readonly row: IngredientRowView }> = (props): ReactElement => {
    const { row, m } = props;
    const { presentation, line, number } = row;

    return (
        <View style={styles.listRow}>
            {row.changing && <ChangeFoodExits onBack={row.onLeaveEntry} onKeyboardHidden={row.onFocusLeft} />}
            <RowName {...props} />
            {row.variantParts !== undefined && presentation.nameMode === 'record' && (
                // Under the name, on a line of its own (§S1). Hidden in Change food (item 4).
                <View style={styles.rowGrow}>
                    <VariantPartsLine parts={row.variantParts} tone="secondary" />
                </View>
            )}
            {row.busyText !== undefined && <Text style={[styles.rowGrow, styles.unitNote]}>{row.busyText}</Text>}
            {row.pendingText !== undefined && (
                <Text id={ingredientPendingTextId(line.key)} style={[styles.rowGrow, styles.error]}>
                    {row.pendingText}
                </Text>
            )}
            {row.failure !== undefined && (
                // Shown on the row; the field says it assertively, so this text is not live too (system change 2).
                <Text id={ingredientCommitFailureId(line.key)} style={[styles.rowGrow, styles.error]}>
                    {row.failure}
                </Text>
            )}
            {row.noFoodNote !== undefined && (
                // `IngredientRowView.noFoodNote`. The design system's `StatusBadge` (namelessLineCopy §2c); it takes no
                // id and no role, so this wrapper `View` carries both.
                <View id={ingredientNoFoodNoteId(row.index)} role="note">
                    <StatusBadge tone={presentation.tone}>{row.noFoodNote}</StatusBadge>
                </View>
            )}
            {/* R42's two bounds, sharing the ONE unit field that follows, with empty meaning absent (R40). */}
            <TextInput
                accessibilityLabel={fillTemplate(m.ingredientQuantityLabel, { number })}
                aria-invalid={row.quantityInvalid || undefined}
                aria-describedby={row.describedBy.quantity}
                keyboardType="numeric"
                value={quantityInputValue(line.quantity)}
                onChangeText={row.edit.quantityLow}
                style={[styles.input, styles.rowNarrow]}
            />
            {/* Punctuation, not copy — the EN DASH `formatQuantity` prints on the read surface. Hidden from assistive
                tech: each input already carries its own accessible name.

                Spelled `aria-hidden`, NOT RN's legacy `accessibilityElementsHidden` +
                `importantForAccessibility="no-hide-descendants"` pair, for the reason `RecipeWidgetSkeleton.native.tsx`
                records: the two are equivalent on device (RN reverse-maps `aria-hidden` onto both), but
                react-native-web translates the legacy pair to NO DOM attribute — so the web build would leave a bare
                dash in the accessibility tree. */}
            <Text aria-hidden style={styles.rangeSeparator}>
                –
            </Text>
            <TextInput
                accessibilityLabel={fillTemplate(m.ingredientQuantityHighLabel, { number })}
                aria-invalid={row.quantityInvalid || undefined}
                aria-describedby={row.describedBy.quantityHigh}
                keyboardType="numeric"
                value={quantityInputValue(line.quantityHigh)}
                onChangeText={row.edit.quantityHigh}
                style={[styles.input, styles.rowNarrow]}
            />
            <TextInput
                accessibilityLabel={fillTemplate(m.ingredientUnitLabel, { number })}
                // `IngredientRowView.unitNote`: it describes the field and never marks it invalid.
                aria-describedby={row.describedBy.unit}
                value={line.unit ?? ''}
                onChangeText={row.edit.unit}
                style={[styles.input, styles.rowNarrow, !row.unitCanonical && styles.inputSubdued]}
            />
            {row.unitNote !== undefined && (
                <Text id={ingredientUnitNoteId(row.index)} style={styles.unitNote}>
                    {row.unitNote}
                </Text>
            )}
            {/* U26 — the PREPARATION, its own field and never part of the food's name. */}
            <TextInput
                accessibilityLabel={fillTemplate(m.ingredientPreparationLabel, { number })}
                placeholder={m.ingredientPreparationPlaceholder}
                value={line.preparation ?? ''}
                onChangeText={row.edit.preparation}
                style={[styles.input, styles.rowPreparation]}
            />
            {/* U27 — the SECTION, the quieter of the two: the primary way to group is the append inheriting the label
                from the line above, because the brief rules that per-row typing is the wrong PRIMARY interaction. */}
            <TextInput
                accessibilityLabel={fillTemplate(m.ingredientGroupLabel, { number })}
                placeholder={m.ingredientGroupPlaceholder}
                value={line.groupLabel ?? ''}
                onChangeText={row.edit.groupLabel}
                style={[styles.input, styles.rowGroup]}
            />
            {presentation.statusWord !== undefined && (
                // The status word, from the row policy, as the design system's chip.
                <StatusBadge tone={presentation.tone}>{m[presentation.statusWord]}</StatusBadge>
            )}
            {/* Slot 1 — the state glyph, opened by a TAP into a bottom sheet (R32, §8e "moved"). */}
            <Popover
                triggerLabel={row.labels.glyphTrigger}
                triggerIcon={
                    <Feather
                        name={presentation.glyph === 'alert' ? 'alert-triangle' : 'info'}
                        size={20}
                        color={palette.charcoal}
                    />
                }
                title={row.displayName}
                closeLabel={row.labels.glyphClose}
                busy={row.glyphBusy}
                focusRequested={row.glyphFocus.requested}
                onFocusRequestHandled={row.glyphFocus.onHandled}
                onDismissed={row.glyphFocus.onPanelDismissed}
            >
                {(close) => <GlyphPanelBody {...props} close={close} />}
            </Popover>
            {presentation.slot2.kind === 'menu' ? (
                // Slot 2 — the row's actions behind one `⋮`, a bottom sheet of menu items (§3a).
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
                <View style={styles.rowAction}>
                    <Button
                        variant="destructive"
                        icon={<Feather name="trash-2" size={16} color={palette['error-dark']} />}
                        onPress={row.onRemove}
                    >
                        {fillTemplate(m.removeIngredient, { number })}
                    </Button>
                </View>
            )}
        </View>
    );
};

/** Step 2: the dynamic ingredient list, and the trailing add row after it. */
export const RecipeIngredientsFields: FC<RecipeIngredientsFieldsProps> = (props) => {
    const m = useMessages(recipeFormMessages);
    const model = useIngredientsFields(props);
    const { nutrition, rowEditor } = props;
    const { authoredFood, details } = rowEditor;
    const { trailing, total, focus } = model;
    const speak = useSpokenRefusal(rowEditor.pendingRefusals);
    // PLATFORM-FORK: React Native cannot read where the reading cursor was, so this leaf returns it to the row's `⋮`
    // once a sheet that row opened has gone (items 1 and 8, §S8.8); the web surfaces return their own focus. The
    // authored-food Sheet's row is remembered here because its `target` is gone by then.
    const authoredRow = useLastDefined(authoredFood.target?.kind === 'line' ? authoredFood.target.key : undefined);
    const drawing: RowDrawing = { m, entryCopy: model.entryCopy, nutrition, speak };

    return (
        <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.sectionHeading}>
                {m.ingredientsHeading}
            </Text>
            {/* The settled retry's outcome, announced politely (V1 sign-off 3c). */}
            <LiveRegion politeness="polite" visuallyHidden>
                {model.lookupSettledMessage}
            </LiveRegion>
            {/* What a row's settled pick did, politely, with the list closed (R3). */}
            <LiveRegion politeness="polite" visuallyHidden>
                {model.settledMessage}
            </LiveRegion>
            {model.listError !== undefined && (
                <Text id={ingredientsErrorId} accessibilityRole="alert" style={styles.error}>
                    {model.listError}
                </Text>
            )}
            {model.sections.length === 0 ? (
                <Text style={styles.emptyText}>{m.noIngredients}</Text>
            ) : (
                model.sections.flatMap((section) => [
                    // The sections are interleaved in this ONE list (`useIngredientsFields`), with no heading for an
                    // unlabelled run. `aria-level` 3 sits under the section's own header.
                    ...(section.label === undefined
                        ? []
                        : [
                              <Text
                                  key={section.key}
                                  accessibilityRole="header"
                                  aria-level={3}
                                  style={styles.groupHeading}
                              >
                                  {section.label}
                              </Text>,
                          ]),
                    // Keyed by the line's identity, never its index (plan 002 V1).
                    ...section.rows.map((row) => <IngredientRow key={row.line.key} row={row} {...drawing} />),
                ])
            )}
            {/* B8: the trailing add row. Its list is in flow below it (item 7). */}
            <View style={styles.rowGrow}>
                <Combobox
                    // PLATFORM-FORK: native has no `aria-describedby`; the refused field's own alert says its sentence
                    // (`useSpokenRefusal`).
                    {...trailingEntryFieldOf(
                        { ...speak(trailing.entryField, 'newLine', trailing.pendingText), describedBy: undefined },
                        model.entryCopy,
                    )}
                    leadingIcon={<Feather name="plus" size={16} color={palette.slate} />}
                    loadingIcon={<Feather name="search" size={16} color={palette.slate} />}
                    clear={{
                        label: m.ingredientEntryClear,
                        icon: <Feather name="x" size={18} color={palette.slate} />,
                    }}
                />
                {trailing.busyText !== undefined && <Text style={styles.unitNote}>{trailing.busyText}</Text>}
                {trailing.pendingText !== undefined && (
                    <Text id={trailingPendingTextId} style={styles.error}>
                        {trailing.pendingText}
                    </Text>
                )}
                {trailing.failure !== undefined && (
                    // Shown here; the field says it assertively, so this text is not live too (system change 2).
                    <Text id={trailingCommitFailureId} style={styles.error}>
                        {trailing.failure}
                    </Text>
                )}
            </View>
            <AuthoredFoodSheet
                state={authoredFood.state}
                onFieldChange={authoredFood.setField}
                onSubmit={authoredFood.submit}
                onReuse={authoredFood.reuseExisting}
                onCancel={authoredFood.cancel}
                // Once it has gone (item 8's one-Modal-at-a-time rule): the glyph after a success (item 1), else `⋮`.
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
                // §S8.8: on every close the cursor returns to the row's `⋮`, once the sheet has gone.
                onDismissed={() => {
                    if (model.details.line !== undefined) {
                        focus.request(model.details.line.key, 'actions');
                    }
                }}
            />
            <View style={styles.nutritionTotal}>
                {nutrition.read === 'loading' && (
                    <Text accessibilityLiveRegion="polite" style={styles.emptyText}>
                        {m.nutritionLoading}
                    </Text>
                )}
                {nutrition.read === 'failed' && (
                    // ⛔ No figure beside the failure: a total built from no catalog lines reads as a fact (REVIEW F3).
                    <View style={styles.panelStack}>
                        <Text style={styles.emptyText}>{m.nutritionLoadFailed}</Text>
                        <View style={styles.addAction}>
                            <Button
                                variant="secondary"
                                icon={<Feather name="refresh-cw" size={16} color={palette.charcoal} />}
                                onPress={nutrition.retry}
                            >
                                {m.statusActionRetry}
                            </Button>
                        </View>
                    </View>
                )}
                {nutrition.read === 'ready' && (
                    <>
                        <Text style={styles.nutritionTotalText}>
                            {fillTemplate(m.nutritionTotalTemplate, {
                                calories: total.calories,
                                protein: total.proteinG,
                                carbs: total.carbsG,
                                fat: total.fatG,
                            })}
                        </Text>
                        {!total.isComplete && <Text style={styles.emptyText}>{m.nutritionPartialNotice}</Text>}
                        {/* R38 — a total from the low end of a range is up to a third under, and says so. */}
                        {model.rangeNotice !== undefined && <Text style={styles.emptyText}>{model.rangeNotice}</Text>}
                    </>
                )}
            </View>
        </View>
    );
};
