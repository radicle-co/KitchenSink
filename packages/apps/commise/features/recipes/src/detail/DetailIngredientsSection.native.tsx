'use client';

/**
 * @module @commise/features-recipes — the native recipe page's ingredients section: the heading with the serving
 * scale, the owner's Edit action, the scaled-from notice, the unreachable-lines notice, the withdrawn-food tile and the
 * checkable rows (or the empty state).
 *
 * Presentational: props → JSX. The one effect it owns is the screen-reader cursor: a retry from the unreachable notice
 * that succeeds removes the button pressed, so the cursor goes to the heading.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { useTheme } from '@commise/ui/theme';
import type { scaleRecipeForServings } from '@kitchensink/recipe-core/scaling';
import type { FC } from 'react';
import { Text, View } from 'react-native';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeMessages } from '../messages.js';
import { DetailEmptySection } from './DetailEmptySection.native.js';
import { detailStyles as styles } from './detailStyles.native.js';
import { IngredientCheckRow } from './IngredientCheckRow.native.js';
import { ingredientGroupRuns } from './detailFacts.js';
import { allLinesFoodRemoved, removedFoodNotice, type RecipeDetailBodyNativeProps } from './model.js';
import { ServingScaleControl } from './ServingScaleControl.js';

/** Props for {@link DetailIngredientsSection}. */
export interface DetailIngredientsSectionProps {
    readonly recipe: RecipeDetailBodyNativeProps['recipe'];
    /** The recipe at the serving count on screen. */
    readonly scaled: ReturnType<typeof scaleRecipeForServings>;
    readonly servings: number;
    readonly onServingsChange: (servings: number) => void;
    readonly marks: RecipeDetailBodyNativeProps['marks'];
    readonly unreachableRetry: RecipeDetailBodyNativeProps['unreachableRetry'];
    /** The unreachable-lines notice, when some lines' foods cannot be reached. */
    readonly unreachable: string | undefined;
    /** Whether the heading announces that the unreachable lines were recovered. */
    readonly saysRecovered: boolean;
    /** The owner's Edit action; absent when the viewer cannot edit. */
    readonly onEdit: (() => void) | undefined;
    /** Whether the page is in its two-column layout, where this section takes five parts of twelve. */
    readonly twoColumns: boolean;
}

/** The native ingredients section. */
export const DetailIngredientsSection: FC<DetailIngredientsSectionProps> = ({
    recipe,
    scaled,
    servings,
    onServingsChange,
    marks,
    unreachableRetry,
    unreachable,
    saysRecovered,
    onEdit,
    twoColumns,
}) => {
    const { detail } = useMessages(recipeMessages);
    const { colors } = useTheme();
    const headingRef = useScreenReaderFocusOnSignal<Text>(unreachableRetry.recoveries);
    const removedNotice = removedFoodNotice(recipe.ingredients, detail);
    const allRemoved = allLinesFoodRemoved(recipe.ingredients);
    const ink = { color: colors.ink };
    const hasIngredients = recipe.ingredients.length > 0;

    return (
        <View style={[styles.section, twoColumns ? styles.ingredientsColumn : null]}>
            <View style={styles.headingRow}>
                <Text
                    ref={headingRef}
                    accessibilityRole="header"
                    {...(saysRecovered ? { accessibilityHint: detail.unreachableResolved } : {})}
                    style={[styles.sectionHeading, ink]}
                >
                    {detail.ingredientsHeading}
                </Text>
                <Text style={[styles.meta, { color: colors.inkMuted }, styles.grow]}>
                    {fillTemplate(detail.ingredientsFor, { count: servings })}
                </Text>
                <ServingScaleControl
                    servings={servings}
                    baseServings={recipe.servings}
                    onServingsChange={onServingsChange}
                />
                {/* The owner's Edit: a ghost link at the END of the heading row (§6.1), never a centred line of its own
                    (F22). The row wraps on a narrow phone, so it takes the next line before it squeezes. */}
                {onEdit !== undefined && hasIngredients && (
                    <Button
                        variant="ghost"
                        size="sm"
                        icon="pencilLine"
                        accessibilityLabel={detail.editIngredientsLabel}
                        onPress={onEdit}
                    >
                        {detail.editSection}
                    </Button>
                )}
            </View>
            {scaled.scaling.isScaled && (
                <View
                    accessibilityLiveRegion="polite"
                    style={[styles.scaleNotice, { backgroundColor: colors.surfaceMuted }]}
                >
                    <Text style={[styles.meta, ink]}>
                        {fillTemplate(detail.scaledFrom, { original: recipe.servings })}
                    </Text>
                    <Text style={[styles.meta, styles.caveat, ink]}>{detail.scaledTimingCaveat}</Text>
                    <Button variant="ghost" size="sm" onPress={() => onServingsChange(recipe.servings)}>
                        {detail.resetScale}
                    </Button>
                </View>
            )}
            {/* Plan 002 R2 — ALWAYS MOUNTED; it takes precedence over the page-level notice (see the web leaf). */}
            <RefreshNotice
                failed={unreachable !== undefined}
                refreshing={unreachableRetry.refreshing}
                onRetry={unreachableRetry.onRetry}
                labels={{ failed: unreachable ?? '', retry: detail.refreshRetry }}
            />
            {/* The withdrawn-food tile: a warning TINT with an `ink` label. `role="note"` is inert on device (RN has no
                note role on either platform) and is kept because it states intent; the text is its own node. */}
            {removedNotice !== undefined && (
                <Text role="note" style={[styles.notice, ink, { backgroundColor: colors.attentionTint }]}>
                    {removedNotice}
                </Text>
            )}
            {hasIngredients ? (
                <View>
                    {/* A group is an overline over its run of lines (§6.1, F9); an ungrouped recipe draws one list. */}
                    {ingredientGroupRuns(scaled.ingredients).map((run, index) => (
                        <View key={`${run.label ?? ''}-${String(index)}`}>
                            {run.label !== undefined && (
                                <Text
                                    accessibilityRole="header"
                                    style={[styles.overline, styles.groupHeading, { color: colors.inkMuted }]}
                                >
                                    {run.label}
                                </Text>
                            )}
                            {run.lines.map((ingredient) => (
                                <IngredientCheckRow
                                    key={ingredient.ingredientId}
                                    ingredient={ingredient}
                                    checked={marks.checkedLines.has(ingredient.ingredientId)}
                                    allRemoved={allRemoved}
                                    onToggle={marks.toggleLine}
                                />
                            ))}
                        </View>
                    ))}
                </View>
            ) : (
                <DetailEmptySection text={detail.noIngredients} actionLabel={detail.addIngredients} onAction={onEdit} />
            )}
        </View>
    );
};
