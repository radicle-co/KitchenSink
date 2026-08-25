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
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Feather } from '@expo/vector-icons';
import type { FC, ReactElement } from 'react';
import { classifyUnit, FoodResolutionStatus } from '@kitchensink/recipe-core';
import { Text, TextInput, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { ingredientsErrorId, ingredientUnitNoteId } from './fieldErrorIds.js';
import { draftQuantityVerdict, lineCalories, recipeNutritionTotal } from './model.js';
import { rangeDerivedNotice } from '../detail/model.js';
import { recipeFormMessages } from './messages.js';
import { styles } from './formSectionStyles.native.js';
import type { RecipeFormIngredient } from './model.js';
import {
    addIngredient,
    ingredientSections,
    parseQuantityBound,
    quantityInputValue,
    removeIngredientAt,
    resolutionStatusLabel,
    setIngredientQuantityHigh,
    setIngredientQuantityLow,
    unitClassNote,
    updateIngredientAt,
    type RecipeFormSectionProps,
} from './props.js';

/** Step 2: the dynamic ingredient list (the ingredient typeahead/picker itself is app-owned and composed alongside this). */
export const RecipeIngredientsFields: FC<RecipeFormSectionProps> = ({ values, errors, onChange }) => {
    const m = useMessages(recipeFormMessages);
    const total = recipeNutritionTotal(values);

    // R38 — the disclosure the running total owes when a line states a range (see the web leaf).
    const rangeNotice = rangeDerivedNotice(total, {
        low: m.nutritionRangeDerivedLow,
        high: m.nutritionRangeDerivedHigh,
    });

    const renderRow = (line: RecipeFormIngredient, index: number): ReactElement => {
        const number = index + 1;
        const calories = lineCalories(line);
        // U6 (data-integrity): a RESOLVED line (`ingredientId` set) binds its name to the food supplying the
        // calories — render it READ-ONLY (`editable={false}`); identity changes only by re-picking. Only an
        // UNRESOLVED line still edits its name inline (the freeform search text), so `nameInvalid` can only
        // apply to that editable branch. See the web leaf for the shared rationale.
        const resolved = line.ingredientId !== null;
        // B8: mirrors the web leaf — a line is invalid only when it is ITSELF the reason `errors.ingredients`
        // is set, never every row on an `ingredientsEmpty` (empty-list) error, and (U9) only for the SPECIFIC
        // code whose owning control it is. See the web leaf for the shared rationale.
        const nameInvalid = errors?.ingredients === 'ingredientsUnresolved' && line.ingredientId === null;
        const quantityInvalid =
            errors?.ingredients === 'ingredientsQuantityInvalid' && draftQuantityVerdict(line) === 'invalid';
        // U25 — DERIVED at render from `recipe-core`'s vocabulary, never stored. The SAME `unitClassNote` the
        // web leaf calls, so the two platforms cannot mark a unit differently.
        const unitClass = classifyUnit(line.unit ?? '');
        const unitNote = unitClassNote(m, line.unit);

        return (
            <View key={index} style={styles.listRow}>
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientNameLabel, { number })}
                    editable={!resolved}
                    aria-invalid={nameInvalid || undefined}
                    aria-describedby={nameInvalid ? ingredientsErrorId : undefined}
                    value={line.name}
                    onChangeText={
                        resolved ? undefined : (text) => onChange(updateIngredientAt(values, index, { name: text }))
                    }
                    style={[styles.input, styles.rowGrow, resolved && styles.inputReadOnly]}
                />
                {/* R42's two bounds, sharing the ONE unit field that follows — the web leaf's markup, with
                    the same empty-means-absent rendering (R40). */}
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientQuantityLabel, { number })}
                    aria-invalid={quantityInvalid || undefined}
                    aria-describedby={quantityInvalid ? ingredientsErrorId : undefined}
                    keyboardType="numeric"
                    value={quantityInputValue(line.quantity)}
                    onChangeText={(text) => onChange(setIngredientQuantityLow(values, index, parseQuantityBound(text)))}
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
                        onChange(setIngredientQuantityHigh(values, index, parseQuantityBound(text)))
                    }
                    style={[styles.input, styles.rowNarrow]}
                />
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientUnitLabel, { number })}
                    // U25 — the note DESCRIBES the field; an unknown unit is accepted, never rejected, so
                    // nothing here ever marks it invalid.
                    aria-describedby={unitNote === undefined ? undefined : ingredientUnitNoteId(index)}
                    value={line.unit ?? ''}
                    onChangeText={(text) => onChange(updateIngredientAt(values, index, { unit: text }))}
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
                    onChangeText={(text) => onChange(updateIngredientAt(values, index, { preparation: text }))}
                    style={[styles.input, styles.rowPreparation]}
                />
                {/* U27 — the SECTION, the quieter of the two: the primary way to group is `addIngredient`
                    inheriting the label from the line above (see `props.ts`), because the brief rules that
                    per-row typing is the wrong PRIMARY interaction. */}
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientGroupLabel, { number })}
                    placeholder={m.ingredientGroupPlaceholder}
                    value={line.groupLabel ?? ''}
                    onChangeText={(text) => onChange(updateIngredientAt(values, index, { groupLabel: text }))}
                    style={[styles.input, styles.rowGroup]}
                />
                {line.resolutionStatus !== undefined && (
                    <Text
                        accessibilityLabel={fillTemplate(m.ingredientStatusLabel, { number })}
                        // U14 — mirrors the web leaf: a line the verification gate CONTRADICTED is the one
                        // status a cook can act on, and it must not wear the same neutral badge as
                        // "Resolved". ⛔ Charcoal on a `warning` tint, never `warning` as the text colour.
                        style={
                            line.resolutionStatus === FoodResolutionStatus.NEEDS_REVIEW
                                ? styles.statusBadgeNeedsReview
                                : styles.statusBadge
                        }
                    >
                        {resolutionStatusLabel(m, line.resolutionStatus)}
                    </Text>
                )}
                {calories !== undefined && (
                    <Text style={styles.caloriesBadge}>{fillTemplate(m.ingredientCaloriesTemplate, { calories })}</Text>
                )}
                <View style={styles.rowAction}>
                    <Button
                        variant="destructive"
                        icon={<Feather name="trash-2" size={16} color={palette['error-dark']} />}
                        onPress={() => onChange(removeIngredientAt(values, index))}
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

    return (
        <View accessibilityLabel={m.ingredientsHeading} style={styles.card}>
            <Text accessibilityRole="header" style={styles.sectionHeading}>
                {m.ingredientsHeading}
            </Text>
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
                                  key={`section-${section.lines[0]?.index ?? -1}`}
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
                <Button
                    variant="secondary"
                    icon={<Feather name="plus" size={16} color={palette.charcoal} />}
                    onPress={() => onChange(addIngredient(values))}
                >
                    {m.addIngredient}
                </Button>
            </View>
            <View style={styles.nutritionTotal}>
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
            </View>
        </View>
    );
};
