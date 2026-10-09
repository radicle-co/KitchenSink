'use client';

/**
 * @module @commise/features-recipes — native recipe-detail view (T066 building block; `docs/design/uiOverhaul/buildSpec.md`
 * §6, the first slice of 008 FR-035).
 *
 * The React Native leaf of the recipe page — the same contract, sections and reading order as the web leaf: the hero,
 * the meta line, the title, the rating line, the stat strip, the action row, the description and the tags as text;
 * then the ingredients (serves in the heading, tap-to-check rows), the steps (the current step), the nutrition, the
 * rating, the review surface and the footer facts. From a 720 pt body the ingredients and the steps sit side by side.
 *
 * ⚠️ PLATFORM FORK, recorded: below 720 the web leaf puts "Screen on" in the sticky section switch. Native's switch
 * jumps through the screen's one scroller (`ScrollHost`, blueprint A7). The host exists, but the recipe screen does not
 * yet scroll inside one with its sections reported (`sectionLayout`), and a switch with no section to jump to is a dead
 * control — so until the screen does, native draws Screen on, labelled, at the end of the action row at every width,
 * and draws no section switch.
 *
 * Colours are read from the theme at render; the `StyleSheet` holds layout only, so the page repaints in dark mode.
 *
 * This is the PURE render half. Its orchestration shell — `RecipeDetailView.native.tsx` — binds the session state and
 * measures the layout, because a file does ONE thing (CODING_STANDARDS §1).
 *
 * @pattern Humble Object — the pure render half of the orchestration/render split whose shell is
 *     `RecipeDetailView.native.tsx`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { DifficultyBadge } from '@commise/ui/difficulty-badge';
import { Icon } from '@commise/ui/icon';
import { KeepAwakeToggle } from '@commise/ui/keep-awake';
import { nativeTokens } from '@commise/ui/native';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { StatusBadge } from '@commise/ui/status-badge';
import { useTheme } from '@commise/ui/theme';
import { hasCatalogNutrition, hasUserEnteredIngredients } from '@kitchensink/recipe-core';
import { scaleRecipeForServings } from '@kitchensink/recipe-core/scaling';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import { AmbiguityReview } from './AmbiguityReview.native.js';
import { DetailEmptySection } from './DetailEmptySection.native.js';
import { detailMetaItems, detailRatingLine, detailStatCells, isLongDescription } from './detailFacts.js';
import { IngredientCheckRow } from './IngredientCheckRow.native.js';
import {
    allLinesFoodRemoved,
    detailNoticeState,
    needsReviewNotice,
    rangeDerivedNotice,
    removedFoodNotice,
    staleNutritionNotice,
    type RecipeDetailBodyNativeProps,
} from './model.js';
import { NutritionFigure } from './NutritionFigure.native.js';
import { RecipeHero } from './RecipeHero.native.js';
import { RecipeSourceLine } from './RecipeSourceLine.native.js';
import { ServingScaleControl } from './ServingScaleControl.native.js';
import { StepRow } from './StepRow.native.js';

/**
 * The pure `props → JSX` detail render. Everything it shows for a chosen serving count comes from
 * `scaleRecipeForServings`, so what scales is decided once, in the domain, for both platforms.
 *
 * Exported for tests and for its shell; deliberately NOT on the package barrel — an app composes `RecipeDetailView`.
 */
export const RecipeDetailBody: FC<RecipeDetailBodyNativeProps> = ({
    recipe,
    headerActions,
    rating,
    servings,
    onServingsChange,
    refreshNotice,
    unreachableRetry,
    onOpenDataSources,
    dataSourcesReturnFocusSignal,
    onEditSection,
    onViewVersions,
    viewerIsOwner,
    marks,
    screenOn,
    descriptionExpanded,
    onToggleDescription,
    layout,
}) => {
    const { detail, duration, card } = useMessages(recipeMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const owner = viewerIsOwner === true;
    // A retry from the refresh notice that succeeds removes the button pressed, so the cursor goes to the title.
    const titleRef = useScreenReaderFocusOnSignal<Text>(refreshNotice?.recoveries ?? 0);
    const { unreachable, pageRefreshFailed, saysRecovered } = detailNoticeState(
        recipe.ingredients,
        detail,
        refreshNotice,
        unreachableRetry,
    );
    const ingredientsHeadingRef = useScreenReaderFocusOnSignal<Text>(unreachableRetry.recoveries);
    // The Data sources sheet returns the reading cursor to the link that opened it (§S16).
    const sourcesLinkRef = useScreenReaderFocusOnSignal<View>(dataSourcesReturnFocusSignal);
    // Facts about the READ, from the stored figure — not the serving count on screen.
    const rangeNotice = rangeDerivedNotice(recipe.nutrition, {
        low: detail.nutritionRangeDerivedLow,
        high: detail.nutritionRangeDerivedHigh,
    });
    const staleNotice = staleNutritionNotice(recipe.nutrition, detail.nutritionStale);
    const reviewNotice = needsReviewNotice(recipe.ingredients, detail);
    const removedNotice = removedFoodNotice(recipe.ingredients, detail);
    const allRemoved = allLinesFoodRemoved(recipe.ingredients);
    const scaled = scaleRecipeForServings(recipe, servings);
    const stats = detailStatCells(scaled, recipe.difficulty, { detail, duration, card });
    const meta = detailMetaItems(recipe, owner, detail);
    const ratingLine = detailRatingLine(recipe, owner, locale, { detail, card });
    const tags = [...recipe.dietaryFlags, ...recipe.tags];
    const twoColumns = layout.columns === 'two';
    const ink = { color: colors.ink };
    const muted = { color: colors.inkMuted };
    const editIngredients = owner && onEditSection !== undefined ? () => onEditSection('ingredients') : undefined;
    const editSteps = owner && onEditSection !== undefined ? () => onEditSection('steps') : undefined;

    const ingredients = (
        <View style={[styles.section, twoColumns ? styles.ingredientsColumn : null]}>
            <View style={styles.headingRow}>
                <Text
                    ref={ingredientsHeadingRef}
                    accessibilityRole="header"
                    {...(saysRecovered ? { accessibilityHint: detail.unreachableResolved } : {})}
                    style={[styles.sectionHeading, ink]}
                >
                    {detail.ingredientsHeading}
                </Text>
                <Text style={[styles.meta, muted, styles.grow]}>
                    {fillTemplate(detail.ingredientsFor, { count: servings })}
                </Text>
                <ServingScaleControl
                    servings={servings}
                    baseServings={recipe.servings}
                    onServingsChange={onServingsChange}
                />
            </View>
            {editIngredients !== undefined && recipe.ingredients.length > 0 && (
                <Button
                    variant="ghost"
                    size="sm"
                    icon="pencilLine"
                    accessibilityLabel={detail.editIngredientsLabel}
                    onPress={editIngredients}
                >
                    {detail.editSection}
                </Button>
            )}
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
            {recipe.ingredients.length === 0 ? (
                <DetailEmptySection
                    text={detail.noIngredients}
                    actionLabel={detail.addIngredients}
                    onAction={editIngredients}
                />
            ) : (
                <View>
                    {scaled.ingredients.map((ingredient) => (
                        <IngredientCheckRow
                            key={ingredient.ingredientId}
                            ingredient={ingredient}
                            checked={marks.checkedLines.has(ingredient.ingredientId)}
                            allRemoved={allRemoved}
                            onToggle={marks.toggleLine}
                        />
                    ))}
                </View>
            )}
        </View>
    );

    const rest = (
        <View style={[styles.column, twoColumns ? styles.stepsColumn : null]}>
            <View style={styles.section}>
                <Text accessibilityRole="header" style={[styles.sectionHeading, ink]}>
                    {detail.instructionsHeading}
                </Text>
                {editSteps !== undefined && recipe.steps.length > 0 && (
                    <Button
                        variant="ghost"
                        size="sm"
                        icon="pencilLine"
                        accessibilityLabel={detail.editStepsLabel}
                        onPress={editSteps}
                    >
                        {detail.editSection}
                    </Button>
                )}
                {recipe.steps.length === 0 ? (
                    <DetailEmptySection text={detail.noSteps} actionLabel={detail.addSteps} onAction={editSteps} />
                ) : (
                    <View style={styles.steps}>
                        {recipe.steps.map((step) => (
                            <StepRow
                                key={step.stepNumber}
                                step={step}
                                current={marks.currentStep === step.stepNumber}
                                onToggle={marks.toggleStep}
                            />
                        ))}
                    </View>
                )}
            </View>

            <View style={styles.section}>
                <Text accessibilityRole="header" style={[styles.sectionHeading, ink]}>
                    {detail.nutritionHeading}
                </Text>
                <View style={styles.figureGrid}>
                    <NutritionFigure label={detail.caloriesLabel} value={String(recipe.nutrition.calories)} />
                    <NutritionFigure
                        label={detail.proteinLabel}
                        value={fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.proteinG })}
                    />
                    <NutritionFigure
                        label={detail.carbsLabel}
                        value={fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.carbsG })}
                    />
                    <NutritionFigure
                        label={detail.fatLabel}
                        value={fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.fatG })}
                    />
                </View>
                {!recipe.nutrition.isComplete && <Text style={[styles.caption, muted]}>{detail.nutritionPartial}</Text>}
                {rangeNotice !== undefined && <Text style={[styles.caption, muted]}>{rangeNotice}</Text>}
                {staleNotice !== undefined && <Text style={[styles.caption, muted]}>{staleNotice}</Text>}
                {reviewNotice !== undefined && (
                    <Text role="note" style={[styles.caption, styles.caveat, ink]}>
                        {reviewNotice}
                    </Text>
                )}
                {hasCatalogNutrition(recipe.ingredients) && (
                    <View>
                        <Text style={[styles.caption, muted]}>{detail.nutritionSourceNote}</Text>
                        <Pressable
                            ref={sourcesLinkRef}
                            accessibilityRole="link"
                            onPress={onOpenDataSources}
                            style={styles.linkTouch}
                        >
                            <Text style={[styles.caption, styles.link, { color: colors.actionText }]}>
                                {detail.nutritionSourcesLink}
                            </Text>
                        </Pressable>
                    </View>
                )}
                {hasUserEnteredIngredients(recipe.ingredients) && (
                    <Text style={[styles.caption, muted]}>{detail.nutritionCustomNote}</Text>
                )}
            </View>

            {rating}

            <AmbiguityReview recipe={recipe} viewerIsOwner={owner} />

            <View style={styles.footer}>
                <RecipeSourceLine
                    {...(recipe.sourceUrl === undefined ? {} : { sourceUrl: recipe.sourceUrl })}
                    {...(recipe.sourceAttribution === undefined ? {} : { sourceAttribution: recipe.sourceAttribution })}
                />
                <Text style={[styles.meta, muted]}>
                    {fillTemplate(detail.versionLabel, { version: recipe.currentVersion })}
                </Text>
                {onViewVersions !== undefined && (
                    <Button variant="ghost" size="sm" icon="clock" onPress={onViewVersions}>
                        {detail.versionHistory}
                    </Button>
                )}
            </View>
        </View>
    );

    return (
        <View style={styles.container}>
            {/* The hero IS the carousel, so the cover shows once (F2). */}
            <RecipeHero title={recipe.title} photos={recipe.photos} />

            <View style={styles.top}>
                {meta.length > 0 && <Text style={[styles.overline, muted]}>{meta.join(' · ')}</Text>}
                <Text ref={titleRef} accessibilityRole="header" numberOfLines={3} style={[styles.title, ink]}>
                    {recipe.title}
                </Text>
                {(ratingLine.rating !== undefined || ratingLine.status !== undefined) && (
                    <View style={styles.ratingLine}>
                        {ratingLine.rating !== undefined && (
                            <View style={styles.inline}>
                                <Icon name="star" size={16} tone="rating" filled />
                                <Text style={[styles.meta, styles.figures, ink]}>{ratingLine.rating.text}</Text>
                            </View>
                        )}
                        {ratingLine.status?.kind === 'draft' && (
                            <StatusBadge status="draft">{ratingLine.status.text}</StatusBadge>
                        )}
                        {ratingLine.status?.kind === 'visibility' && (
                            <View style={styles.inline}>
                                <Icon
                                    name={ratingLine.status.visibility === 'public' ? 'globe' : 'lock'}
                                    size={16}
                                    tone="inkMuted"
                                />
                                <Text style={[styles.meta, muted]}>{ratingLine.status.text}</Text>
                            </View>
                        )}
                    </View>
                )}
                {stats.length > 0 && (
                    <View
                        style={[styles.statStrip, { backgroundColor: colors.paper, borderColor: colors.lineDivider }]}
                    >
                        {stats.map((cell) => (
                            <View
                                key={cell.id}
                                style={[
                                    styles.statCell,
                                    { flexBasis: layout.statsPerRow === 2 ? '50%' : `${100 / stats.length}%` },
                                ]}
                            >
                                {cell.id === 'difficulty' ? (
                                    <DifficultyBadge level={cell.level}>{cell.value}</DifficultyBadge>
                                ) : (
                                    <Text style={[styles.statValue, ink]}>{cell.value}</Text>
                                )}
                                <Text style={[styles.caption, muted]}>{cell.label}</Text>
                            </View>
                        ))}
                    </View>
                )}
                <View style={styles.actions}>
                    {headerActions}
                    <KeepAwakeToggle
                        on={screenOn.on}
                        onChange={screenOn.onChange}
                        label={detail.screenOn}
                        display="labelled"
                    />
                </View>
                {recipe.description !== '' && (
                    <View style={styles.description}>
                        <Text
                            numberOfLines={descriptionExpanded || twoColumns ? undefined : 4}
                            style={[styles.readingBody, ink]}
                        >
                            {recipe.description}
                        </Text>
                        {!twoColumns && isLongDescription(recipe.description) && (
                            <Button variant="ghost" size="sm" onPress={onToggleDescription}>
                                {descriptionExpanded ? detail.descriptionLess : detail.descriptionMore}
                            </Button>
                        )}
                    </View>
                )}
                {tags.length > 0 && <Text style={[styles.meta, muted]}>{tags.join(' · ')}</Text>}
            </View>

            {refreshNotice !== undefined && (
                <RefreshNotice
                    failed={pageRefreshFailed}
                    refreshing={refreshNotice.refreshing}
                    onRetry={refreshNotice.onRetry}
                    labels={{ failed: detail.refreshError, retry: detail.refreshRetry }}
                />
            )}

            <View style={twoColumns ? styles.twoColumns : styles.column}>
                {ingredients}
                {rest}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { gap: nativeTokens.spacing[6], paddingBottom: nativeTokens.spacing[6] },
    top: { gap: nativeTokens.spacing[3], paddingHorizontal: nativeTokens.spacing[4] },
    overline: { ...nativeTokens.type.overline },
    title: { ...nativeTokens.type.largeTitle.narrow },
    ratingLine: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
    inline: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[1] },
    meta: { ...nativeTokens.type.meta },
    caption: { ...nativeTokens.type.caption },
    readingBody: { ...nativeTokens.type.readingBody },
    figures: { fontVariant: ['tabular-nums', 'lining-nums'] },
    figureGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: nativeTokens.spacing[4] },
    statStrip: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        borderRadius: nativeTokens.radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        paddingVertical: nativeTokens.spacing[2],
        ...nativeTokens.elevation.sm,
    },
    statCell: {
        gap: nativeTokens.spacing[1],
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
    },
    statValue: { ...nativeTokens.type.figureStat },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[2] },
    description: { alignItems: 'flex-start', gap: nativeTokens.spacing[1] },
    column: { gap: nativeTokens.spacing[8], paddingHorizontal: nativeTokens.spacing[4] },
    twoColumns: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: nativeTokens.spacing[8],
        paddingHorizontal: nativeTokens.spacing[4],
    },
    ingredientsColumn: { flex: 5 },
    stepsColumn: { flex: 7, paddingHorizontal: 0 },
    section: { gap: nativeTokens.spacing[3] },
    headingRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[2],
    },
    sectionHeading: { ...nativeTokens.type.sectionTitle },
    scaleNotice: {
        alignItems: 'flex-start',
        gap: nativeTokens.spacing[1],
        borderRadius: nativeTokens.radius.md,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
    },
    caveat: { fontWeight: '600' },
    grow: { flexGrow: 1 },
    notice: {
        ...nativeTokens.type.meta,
        borderRadius: nativeTokens.radius.md,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
    },
    steps: { gap: nativeTokens.spacing[6] },
    linkTouch: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
    link: { textDecorationLine: 'underline' },
    footer: { alignItems: 'flex-start', gap: nativeTokens.spacing[1] },
});
