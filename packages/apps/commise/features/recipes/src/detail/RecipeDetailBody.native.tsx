'use client';

/**
 * @module @commise/features-recipes — native recipe-detail view (T066 building block; `nativeBoards/buildLists.md`, the
 * `RecipeDetailAndroid384` board).
 *
 * The React Native leaf of the recipe page, in reading order: the hero; the rating card; the cuisine eyebrow and the
 * title; the status row; the source line and byline; the fact tiles; the actions; the Screen on row; the description
 * and the tags; then the ingredients (serves in the heading, tap-to-check rows), the steps (the current step), the
 * nutrition, the review surface. From a 720 pt body the ingredients and the steps sit side by side.
 *
 * It renders the page's ONE scroller. Every section is a direct child of the scroll content, one flat list. There is no
 * section switch: the page is one scroll, and "Screen on" is a labelled row in the page, drawn once.
 *
 * Left out until their features ship (`designAnswers.md` section
 * "2026-11-02: card, Home header and Recipe detail build questions", bullets "8 comments" row and "Start cooking"):
 * the comments row and "Start cooking".
 *
 * This is the PURE render half. Its orchestration shell, `RecipeDetailView.native.tsx`, binds the session state and
 * measures the layout, because a file does ONE thing (CODING_STANDARDS §1).
 *
 * @pattern Humble Object — the pure render half of the orchestration/render split whose shell is
 *     `RecipeDetailView.native.tsx`.
 */
import { useMessages } from '@commise/i18n/react';
import { KeepAwakeToggle } from '@commise/ui/keep-awake';
import { LiveRegion } from '@commise/ui/live-region';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { scaleRecipeForServings } from '@kitchensink/recipe-core/scaling';
import type { FC, ReactElement } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@commise/ui/text';

import { recipeMessages } from '../messages.js';
import { bylineMessages } from '../byline/messages.js';
import { AmbiguityReview } from './AmbiguityReview.native.js';
import { DetailDescription } from './DetailDescription.native.js';
import { detailByline, detailEyebrow, detailStatCells, detailStatusLine } from './detailFacts.js';
import { DetailFactTiles } from './DetailFactTiles.native.js';
import { DetailStack } from './detailFrames.native.js';
import { DetailIngredientsSection } from './DetailIngredientsSection.native.js';
import { DetailInstructionsSection } from './DetailInstructionsSection.native.js';
import { DetailNutritionSection } from './DetailNutritionSection.native.js';
import { DetailStatusRow } from './DetailStatusRow.native.js';
import { detailStyles as styles } from './detailStyles.native.js';
import { detailNoticeState, type RecipeDetailBodyNativeProps } from './model.js';
import { RecipeHero } from './RecipeHero.native.js';
import { RecipeSourceLine } from './RecipeSourceLine.native.js';

/**
 * The pure `props → JSX` detail render. Everything it shows for a chosen serving count comes from
 * `scaleRecipeForServings`, so what scales is decided once, in the domain, for both platforms.
 *
 * It composes the page from its section leaves (`Detail*.native.tsx`) and keeps only what more than one of them needs:
 * the scaled recipe, the notice state and the owner's Edit actions.
 *
 * Exported for tests and for its shell; deliberately NOT on the package barrel — an app composes `RecipeDetailView`.
 */
export const RecipeDetailBody: FC<RecipeDetailBodyNativeProps> = ({
    recipe,
    headerActions,
    heroControls,
    scrollFooter,
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
    visibilityNotice,
    marks,
    screenOn,
    descriptionExpanded,
    onToggleDescription,
    nutritionExpanded,
    onToggleNutrition,
    layout,
}) => {
    const { detail, duration, card } = useMessages(recipeMessages);
    const bylineCopy = useMessages(bylineMessages);
    const owner = viewerIsOwner === true;
    // A retry from the refresh notice that succeeds removes the button pressed, so the cursor goes to the title.
    const titleRef = useScreenReaderFocusOnSignal<View>(refreshNotice?.recoveries ?? 0);
    const { unreachable, pageRefreshFailed, saysRecovered } = detailNoticeState(
        recipe.ingredients,
        detail,
        refreshNotice,
        unreachableRetry,
    );
    const scaled = scaleRecipeForServings(recipe, servings);
    const eyebrow = detailEyebrow(recipe);
    const byline = detailByline(recipe, owner, detail, bylineCopy);
    const tags = [...recipe.dietaryFlags, ...recipe.tags];
    const twoColumns = layout.columns === 'two';
    const editSection = owner ? onEditSection : undefined;
    const ingredients = (
        <DetailIngredientsSection
            recipe={recipe}
            scaled={scaled}
            servings={servings}
            onServingsChange={onServingsChange}
            marks={marks}
            unreachableRetry={unreachableRetry}
            unreachable={unreachable}
            saysRecovered={saysRecovered}
            onEdit={editSection === undefined ? undefined : () => editSection('ingredients')}
            twoColumns={twoColumns}
        />
    );
    const steps = (
        <DetailInstructionsSection
            steps={recipe.steps}
            marks={marks}
            onEdit={editSection === undefined ? undefined : () => editSection('steps')}
        />
    );
    const nutrition = (
        <DetailNutritionSection
            recipe={recipe}
            expanded={nutritionExpanded}
            onToggle={onToggleNutrition}
            onOpenDataSources={onOpenDataSources}
            returnFocusSignal={dataSourcesReturnFocusSignal}
        />
    );
    const tail = <AmbiguityReview recipe={recipe} viewerIsOwner={owner} />;

    // The scroller's direct children, in page order. Built as a list because `stickyHeaderIndices` indexes the
    // children that RENDER: a conditional child that is absent would shift every index after it.
    const children: ReactElement[] = [
        // The hero IS the carousel, so the cover shows once (F2).
        <RecipeHero
            key="hero"
            title={recipe.title}
            photos={recipe.photos}
            {...(heroControls === undefined ? {} : { overlay: heroControls })}
        />,
        <View key="top" style={styles.top}>
            {/* The rating card leads the top block: the whole rating, summary and input, lives in it (D3). */}
            {rating}
            {eyebrow !== undefined && (
                <Text typeRole="label" color="$inkMuted">
                    {eyebrow}
                </Text>
            )}
            {/* The heading is a View, for the screen-reader cursor: the focus hook takes a native view, and a design-system Text
                inside it sets the title in the large-title role, which caps its growth with the system text scale. */}
            <View ref={titleRef} accessible accessibilityRole="header" aria-level={1}>
                <Text typeRole="largeTitle">{recipe.title}</Text>
            </View>
            <DetailStatusRow
                status={detailStatusLine(recipe, owner, { detail, card })}
                onViewVersions={onViewVersions}
            />
            {/* The owner's visibility notice (§6.4): assertive, mounted empty and filled one render later by the host. */}
            {owner && (
                <LiveRegion politeness="assertive" typeRole="meta" tone="dangerText">
                    {visibilityNotice ?? ''}
                </LiveRegion>
            )}
            <RecipeSourceLine
                {...(recipe.sourceUrl === undefined ? {} : { sourceUrl: recipe.sourceUrl })}
                {...(recipe.sourceAttribution === undefined ? {} : { sourceAttribution: recipe.sourceAttribution })}
            />
            {byline !== undefined && (
                <Text typeRole="meta" color="$inkMuted">
                    {byline}
                </Text>
            )}
            <DetailFactTiles
                tiles={detailStatCells(scaled, recipe.difficulty, { detail, duration, card })}
                layout={layout}
            />
            {/* The action row: the host's text action (Edit recipe, Save a copy), then Screen on, a quiet action with the sun glyph. */}
            <View style={styles.actions}>
                {headerActions}
                <KeepAwakeToggle
                    on={screenOn.on}
                    onChange={screenOn.onChange}
                    label={detail.screenOn}
                    hint={detail.screenOnHint}
                />
            </View>
            <DetailDescription
                description={recipe.description}
                expanded={descriptionExpanded}
                twoColumns={twoColumns}
                onToggle={onToggleDescription}
            />
            {tags.length > 0 && (
                <Text typeRole="meta" color="$inkMuted">
                    {tags.join(' · ')}
                </Text>
            )}
        </View>,
    ];

    if (refreshNotice !== undefined) {
        children.push(
            <RefreshNotice
                key="refresh"
                failed={pageRefreshFailed}
                refreshing={refreshNotice.refreshing}
                onRetry={refreshNotice.onRetry}
                labels={{ failed: detail.refreshError, retry: detail.refreshRetry }}
            />,
        );
    }

    // The Nutrition row comes before the columns (`RecipeDetailAndroid384`, item 12), in a block of its own.
    children.push(
        <View key="nutrition" style={styles.sectionBlock}>
            {nutrition}
        </View>,
    );

    if (twoColumns) {
        children.push(
            <View key="columns" style={styles.twoColumns}>
                {ingredients}
                <DetailStack column="steps">
                    {steps}
                    {tail}
                </DetailStack>
            </View>,
        );
    } else {
        // The review block rides inside the steps block, not as a child of its own: an empty child of the content still
        // costs the content's gap and its margin, which left the last content 128 above the tab bar instead of 48.
        children.push(
            <View key="ingredients" style={styles.sectionBlock}>
                {ingredients}
            </View>,
            <View key="steps" style={styles.sectionBlock}>
                <DetailStack>
                    {steps}
                    {tail}
                </DetailStack>
            </View>,
        );
    }

    return (
        <>
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.container}
                keyboardShouldPersistTaps="handled"
            >
                {children}
            </ScrollView>
            {/* The owner dialogs draw over the page, so they take no room in it. */}
            {scrollFooter}
        </>
    );
};
