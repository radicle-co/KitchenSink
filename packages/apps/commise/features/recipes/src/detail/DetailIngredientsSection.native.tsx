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
import { Surface } from '@commise/ui/surface-tone';
import type { scaleRecipeForServings } from '@kitchensink/recipe-core/scaling';
import { Fragment, type FC } from 'react';
import { View } from 'react-native';
import { Text as DsText } from '@commise/ui/text';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeMessages } from '../messages.js';
import { DetailEmptySection } from './DetailEmptySection.native.js';
import { DetailSection } from './detailFrames.native.js';
import { detailStyles as styles } from './detailStyles.native.js';
import {
    IngredientGroupLabel,
    IngredientsCard,
    IngredientsNotices,
    RemovedFoodNotice,
    IngredientsEditRow,
    IngredientsHeadRow,
} from './ingredientFrames.native.js';
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
    const headingRef = useScreenReaderFocusOnSignal<View>(unreachableRetry.recoveries);
    const removedNotice = removedFoodNotice(recipe.ingredients, detail);
    const allRemoved = allLinesFoodRemoved(recipe.ingredients);
    const hasIngredients = recipe.ingredients.length > 0;

    return (
        <DetailSection {...(twoColumns ? { column: 'ingredients' } : {})}>
            <IngredientsCard>
                <IngredientsHeadRow>
                    {/* The heading is a View, for the screen-reader cursor: the focus hook takes a native view, and the design-system Text
                        inside it sets the heading in the section-title role, which caps its growth with the system text scale. */}
                    <View
                        ref={headingRef}
                        accessible
                        accessibilityRole="header"
                        {...(saysRecovered ? { accessibilityHint: detail.unreachableResolved } : {})}
                    >
                        <DsText typeRole="sectionTitle">{detail.ingredientsHeading}</DsText>
                    </View>
                    <DsText typeRole="meta" color="$inkMuted" flexGrow={1}>
                        {fillTemplate(detail.ingredientsFor, { count: servings })}
                    </DsText>
                    <ServingScaleControl
                        servings={servings}
                        baseServings={recipe.servings}
                        onServingsChange={onServingsChange}
                    />
                </IngredientsHeadRow>
                {/* The owner's Edit sits under the heading row, at the start (`RecipeDetailAndroid384`). */}
                {onEdit !== undefined && hasIngredients && (
                    <IngredientsEditRow>
                        <Button
                            variant="ghost"
                            size="sm"
                            icon="pencilLine"
                            accessibilityLabel={detail.editIngredientsLabel}
                            onPress={onEdit}
                        >
                            {detail.editSection}
                        </Button>
                    </IngredientsEditRow>
                )}
                <IngredientsNotices>
                    {scaled.scaling.isScaled && (
                        <Surface tone="muted" accessibilityLiveRegion="polite" style={[styles.scaleNotice]}>
                            <DsText typeRole="meta">
                                {fillTemplate(detail.scaledFrom, { original: recipe.servings })}
                            </DsText>
                            <DsText typeRole="caption">{detail.scaledTimingCaveat}</DsText>
                            <Button variant="ghost" size="sm" onPress={() => onServingsChange(recipe.servings)}>
                                {detail.resetScale}
                            </Button>
                        </Surface>
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
                    {removedNotice !== undefined && <RemovedFoodNotice role="note">{removedNotice}</RemovedFoodNotice>}
                </IngredientsNotices>
                {hasIngredients ? (
                    <>
                        {/* A group is a label over its run of lines (§6.1, F9); an ungrouped recipe draws one list. */}
                        {ingredientGroupRuns(scaled.ingredients).map((run, index) => (
                            <Fragment key={`${run.label ?? ''}-${String(index)}`}>
                                {run.label !== undefined && <IngredientGroupLabel>{run.label}</IngredientGroupLabel>}
                                {run.lines.map((ingredient, lineIndex) => (
                                    <IngredientCheckRow
                                        key={ingredient.ingredientId}
                                        ingredient={ingredient}
                                        checked={marks.checkedLines.has(ingredient.ingredientId)}
                                        allRemoved={allRemoved}
                                        onToggle={marks.toggleLine}
                                        divided={lineIndex > 0}
                                    />
                                ))}
                            </Fragment>
                        ))}
                    </>
                ) : (
                    <DetailEmptySection
                        text={detail.noIngredients}
                        actionLabel={detail.addIngredients}
                        onAction={onEdit}
                    />
                )}
            </IngredientsCard>
        </DetailSection>
    );
};
