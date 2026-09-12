/**
 * @module @commise/features-recipes/form — `RecipeIngredientsFields` (native): step 2 of the recipe form, the
 * dynamic ingredient list plus its running nutrition total. The ingredient typeahead/picker itself stays
 * app-owned and is composed alongside this leaf by the container/wizard-step.
 *
 * The React Native leaf of `./RecipeIngredientsFields.tsx` — same extraction rationale (see that module's
 * doc): the SAME field markup composes both under `RecipeForm.native.tsx`'s single scroll form (unchanged)
 * and, one-for-one, as a step body of the 4-step edit wizard (`wizard/Wizard.native.tsx`).
 */
import { Button } from '@commise/ui/button';
import { LiveRegion } from '@commise/ui/live-region';
import { Popover } from '@commise/ui/popover';
import { StandIn } from '@commise/ui/stand-in';
import { StatusBadge } from '@commise/ui/status-badge';
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Feather } from '@expo/vector-icons';
import type { FC, ReactElement } from 'react';
import { classifyUnit } from '@kitchensink/recipe-core';
import { Text, TextInput, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import {
    ingredientNameDescribedBy,
    ingredientNoFoodNoteId,
    ingredientQuantityDescribedBy,
    ingredientStandInId,
    ingredientsErrorId,
    ingredientUnitNoteId,
} from './fieldErrorIds.js';
import { recipeNutritionTotal } from './nutrition.js';
import { nutritionPanelOf, rowFiguresOf } from './nutritionPanel.js';
import { NutritionPanelBody } from './NutritionPanelBody.native.js';
import { draftQuantity, draftQuantityVerdict } from './quantity.js';
import { panelBodyOf } from './ingredientRowPanel.js';
import { lookupSettledMessage } from './lookupSettledMessage.js';
import { rowPresentationOf } from './ingredientRowPolicy.js';
import { isStandInName, lineDisplayName } from '../detail/lineName.js';
import { lineSummary, rangeDerivedNotice } from '../detail/model.js';
import { recipeMessages } from '../messages.js';
import { recipeFormMessages } from './messages.js';
import { styles } from './formSectionStyles.native.js';
import type { RecipeFormIngredient } from './values.js';
import {
    applyDraftAction,
    ingredientSections,
    parseQuantityBound,
    quantityInputValue,
    unitClassNote,
    unresolvedLineNote,
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

    // R38 — the disclosure the running total owes when a line states a range (see the web leaf).
    const rangeNotice = rangeDerivedNotice(total, {
        low: m.nutritionRangeDerivedLow,
        high: m.nutritionRangeDerivedHigh,
    });

    const renderRow = (line: RecipeFormIngredient, index: number): ReactElement => {
        const number = index + 1;
        // U6/U28 (data-integrity): EVERY line's name is READ-ONLY (`editable={false}`) — a food is picked,
        // never typed. See the web leaf for why U28 extended this to unresolved lines too, and for why the
        // note below is derived from the LINE rather than from `errors`.
        const noFoodNote = unresolvedLineNote(m, line);
        // B8: mirrors the web leaf — a line is invalid only when it is ITSELF the reason, never every row on
        // an `ingredientsEmpty` (empty-list) error.
        const nameInvalid = noFoodNote !== undefined;
        const quantityInvalid =
            errors?.ingredients === 'ingredientsQuantityInvalid' && draftQuantityVerdict(line) === 'invalid';
        // U25 — DERIVED at render from `recipe-core`'s vocabulary, never stored. The SAME `unitClassNote` the
        // web leaf calls, so the two platforms cannot mark a unit differently.
        const unitClass = classifyUnit(line.unit ?? '');
        const unitNote = unitClassNote(m, line.unit);
        // Plan 002 R9 — the web leaf's stand-in in the name's place, with no status word. DISPLAY only.
        const standIn = isStandInName(line);
        // Plan 002 V1 — the same row policy as the web leaf: status word, tone and slot 1's panel are decided once.
        const presentation = rowPresentationOf(line, rowFiguresOf(line, nutrition.lookup));
        const body = panelBodyOf(presentation.panel, presentation.standIn);

        const removeLine = (): void => {
            onChange(applyDraftAction(values, { kind: 'removeAt', field: 'ingredients', index }));
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
            // Keyed by the line's identity, never its index (see the web leaf).
            <View key={line.key} style={styles.listRow}>
                {standIn ? (
                    <View id={ingredientStandInId(index)}>
                        <StandIn tone={presentation.tone}>{displayName}</StandIn>
                    </View>
                ) : (
                    <TextInput
                        accessibilityLabel={fillTemplate(m.ingredientNameLabel, { number })}
                        editable={false}
                        aria-invalid={nameInvalid || undefined}
                        aria-describedby={ingredientNameDescribedBy(
                            index,
                            noFoodNote !== undefined,
                            errors?.ingredients === 'ingredientsUnresolved',
                        )}
                        value={line.name}
                        style={[styles.input, styles.rowGrow, styles.inputReadOnly]}
                    />
                )}
                {noFoodNote !== undefined && (
                    // ⛔ TEXT, not colour — see the web leaf. `role="note"`: a standing fact about the row,
                    // not an event, so a list of eight does not shout eight times.
                    // The design system's `StatusBadge` (namelessLineCopy §2c); it takes no id and no role, so this
                    // wrapper `View` carries both.
                    <View id={ingredientNoFoodNoteId(index)} role="note">
                        <StatusBadge tone={presentation.tone}>{noFoodNote}</StatusBadge>
                    </View>
                )}
                {/* R42's two bounds, sharing the ONE unit field that follows — the web leaf's markup, with
                    the same empty-means-absent rendering (R40). */}
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientQuantityLabel, { number })}
                    aria-invalid={quantityInvalid || undefined}
                    aria-describedby={ingredientQuantityDescribedBy(index, standIn, quantityInvalid)}
                    keyboardType="numeric"
                    value={quantityInputValue(line.quantity)}
                    onChangeText={(text) =>
                        onChange(
                            applyDraftAction(values, {
                                kind: 'setIngredientQuantityLow',
                                index,
                                value: parseQuantityBound(text),
                            }),
                        )
                    }
                    style={[styles.input, styles.rowNarrow]}
                />
                {/* Punctuation, not copy — the EN DASH `formatQuantity` prints on the read surface. Hidden
                    from assistive tech: each input already carries its own accessible name.

                    Spelled `aria-hidden`, NOT RN's legacy `accessibilityElementsHidden` +
                    `importantForAccessibility="no-hide-descendants"` pair, for the reason
                    `RecipeWidgetSkeleton.native.tsx` records: the two are equivalent on device (RN
                    reverse-maps `aria-hidden` onto both), but react-native-web translates the legacy pair to
                    NO DOM attribute — so the web build would leave a bare dash in the accessibility tree,
                    which is also the exact form the web leaf uses. One fewer way for the two to drift. */}
                <Text aria-hidden style={styles.rangeSeparator}>
                    –
                </Text>
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientQuantityHighLabel, { number })}
                    aria-invalid={quantityInvalid || undefined}
                    aria-describedby={quantityInvalid ? ingredientsErrorId : undefined}
                    keyboardType="numeric"
                    value={quantityInputValue(line.quantityHigh)}
                    onChangeText={(text) =>
                        onChange(
                            applyDraftAction(values, {
                                kind: 'setIngredientQuantityHigh',
                                index,
                                value: parseQuantityBound(text),
                            }),
                        )
                    }
                    style={[styles.input, styles.rowNarrow]}
                />
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientUnitLabel, { number })}
                    // U25 — the note DESCRIBES the field; an unknown unit is accepted, never rejected, so
                    // nothing here ever marks it invalid.
                    aria-describedby={unitNote === undefined ? undefined : ingredientUnitNoteId(index)}
                    value={line.unit ?? ''}
                    onChangeText={(text) =>
                        onChange(applyDraftAction(values, { kind: 'updateIngredientAt', index, patch: { unit: text } }))
                    }
                    style={[styles.input, styles.rowNarrow, unitClass !== 'canonical' && styles.inputSubdued]}
                />
                {unitNote !== undefined && (
                    // ⛔ TEXT, not colour — see the web leaf for the WCAG 1.4.1 reasoning and for why a
                    // deliberate `handful` must not read like a mistyped `blorp`.
                    <Text id={ingredientUnitNoteId(index)} style={styles.unitNote}>
                        {unitNote}
                    </Text>
                )}
                {/* U26 — the PREPARATION, its own field and never part of the food's name. */}
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientPreparationLabel, { number })}
                    placeholder={m.ingredientPreparationPlaceholder}
                    value={line.preparation ?? ''}
                    onChangeText={(text) =>
                        onChange(
                            applyDraftAction(values, {
                                kind: 'updateIngredientAt',
                                index,
                                patch: { preparation: text },
                            }),
                        )
                    }
                    style={[styles.input, styles.rowPreparation]}
                />
                {/* U27 — the SECTION, the quieter of the two: the primary way to group is `addIngredient`
                    inheriting the label from the line above (see `props.ts`), because the brief rules that
                    per-row typing is the wrong PRIMARY interaction. */}
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientGroupLabel, { number })}
                    placeholder={m.ingredientGroupPlaceholder}
                    value={line.groupLabel ?? ''}
                    onChangeText={(text) =>
                        onChange(
                            applyDraftAction(values, {
                                kind: 'updateIngredientAt',
                                index,
                                patch: { groupLabel: text },
                            }),
                        )
                    }
                    style={[styles.input, styles.rowGroup]}
                />
                {presentation.statusWord !== undefined && (
                    // The status word, from the row policy, as the design system's chip (the web leaf's twin).
                    <StatusBadge tone={presentation.tone}>{m[presentation.statusWord]}</StatusBadge>
                )}
                {body !== undefined && (
                    // Slot 1 — the state glyph, opened by a TAP into a bottom sheet (R32, §8e "moved").
                    <Popover
                        triggerLabel={fillTemplate(m.ingredientStatusPanelTriggerLabel, { food: triggerFood })}
                        triggerIcon={
                            <Feather
                                name={presentation.glyph === 'alert' ? 'alert-triangle' : 'info'}
                                size={20}
                                color={palette.charcoal}
                            />
                        }
                        title={displayName}
                        closeLabel={fillTemplate(m.ingredientStatusPanelCloseLabel, { food: displayName })}
                        busy={retrying}
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
                                    // See the web leaf: Try again closes the sheet and the glyph reads busy; while the ask
                                    // runs, the sheet says so and offers no second ask.
                                    return retrying ? (
                                        <Text accessibilityLiveRegion="polite" style={styles.panelText}>
                                            {m.statusLookupRetrying}
                                        </Text>
                                    ) : (
                                        <View style={styles.panelStack}>
                                            <Text style={styles.panelText}>{m.statusExplainFailed}</Text>
                                            <View style={styles.addAction}>
                                                <Button
                                                    variant="secondary"
                                                    icon={
                                                        <Feather name="refresh-cw" size={16} color={palette.charcoal} />
                                                    }
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
                                            </View>
                                        </View>
                                    );
                                case 'explanation':
                                    return <Text style={styles.panelText}>{m[body.key]}</Text>;
                            }
                        }}
                    </Popover>
                )}
                {/* Slot 2 — Remove, shown directly (see the web leaf). */}
                <View style={styles.rowAction}>
                    <Button
                        variant="destructive"
                        icon={<Feather name="trash-2" size={16} color={palette['error-dark']} />}
                        onPress={removeLine}
                    >
                        {fillTemplate(m.removeIngredient, { number })}
                    </Button>
                </View>
            </View>
        );
    };

    // U27 — the ONE fold, shared with the web leaf (`props.ts`). An UNGROUPED recipe folds to exactly one
    // UNLABELLED section and renders no heading at all.
    const sections = ingredientSections(values);
    const settledMessage = lookupSettledMessage(m, values, lookupRetry.settled, ingredientLineName);

    return (
        <View accessibilityLabel={m.ingredientsHeading} style={styles.card}>
            <Text accessibilityRole="header" style={styles.sectionHeading}>
                {m.ingredientsHeading}
            </Text>
            {/* The settled retry's outcome, announced politely (V1 sign-off 3c). */}
            <LiveRegion politeness="polite" visuallyHidden>
                {settledMessage}
            </LiveRegion>
            {errors?.ingredients !== undefined && (
                <Text id={ingredientsErrorId} accessibilityRole="alert" style={styles.error}>
                    {m.errors[errors.ingredients]}
                </Text>
            )}
            {sections.length === 0 ? (
                <Text style={styles.emptyText}>{m.noIngredients}</Text>
            ) : (
                sections.flatMap((section) => [
                    // ⛔ NO HEADING for an unlabelled run — most recipes never group, and those must not look
                    // unfinished. `aria-level` 3 sits under the section's own header.
                    //
                    // ⛔ INTERLEAVED, never a wrapper per run — see the web leaf for the full reasoning. A
                    // per-run wrapper makes the section the ancestor of its rows, so typing the first
                    // character of a new label resplits the runs and UNMOUNTS the row holding the focused
                    // input: on native that dismisses the keyboard mid-word.
                    ...(section.label === undefined
                        ? []
                        : [
                              <Text
                                  key={`section-${section.lines[0]?.line.key ?? 'none'}`}
                                  accessibilityRole="header"
                                  aria-level={3}
                                  style={styles.groupHeading}
                              >
                                  {section.label}
                              </Text>,
                          ]),
                    ...section.lines.map((entry) => renderRow(entry.line, entry.index)),
                ])
            )}
            <View style={styles.addAction}>
                {/* U28 — a REQUEST, not a mutation; the container answers it by focusing the ingredient
                    picker. See the web leaf for the dead end this removes. */}
                <Button
                    variant="secondary"
                    icon={<Feather name="plus" size={16} color={palette.charcoal} />}
                    onPress={onRequestAddIngredient}
                >
                    {m.addIngredient}
                </Button>
            </View>
            <View style={styles.nutritionTotal}>
                {nutrition.read === 'loading' && (
                    <Text accessibilityLiveRegion="polite" style={styles.emptyText}>
                        {m.nutritionLoading}
                    </Text>
                )}
                {nutrition.read === 'failed' && (
                    // ⛔ No figure beside the failure (see the web leaf, REVIEW F3).
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
                        {/* R38 — see the web leaf. */}
                        {rangeNotice !== undefined && <Text style={styles.emptyText}>{rangeNotice}</Text>}
                    </>
                )}
            </View>
        </View>
    );
};
