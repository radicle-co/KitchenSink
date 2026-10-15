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
 * It renders the page's ONE scroller. Below 720 the page is a flat list of DIRECT children of the scroll content: the
 * hero, the top block, the section switch (the sticky header), then each section in a `View` that reports its layout to
 * the scroll host. Both are forced by React Native: a sticky header sticks only a direct child of the content, and
 * `onLayout` y is relative to the parent, so a section wrapped with its siblings would report a y the spy cannot use.
 * "Screen on" is drawn once: icon-only in the switch below 720, labelled in the action row from 720. From 720 both
 * columns show, so there is no switch and nothing sticks.
 *
 * Colours are read from the theme at render; the `StyleSheet` holds layout only, so the page repaints in dark mode.
 *
 * This is the PURE render half. Its orchestration shell — `RecipeDetailView.native.tsx` — binds the session state,
 * mounts the `ScrollHost` and measures the layout, because a file does ONE thing (CODING_STANDARDS §1).
 *
 * @pattern Humble Object — the pure render half of the orchestration/render split whose shell is
 *     `RecipeDetailView.native.tsx`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { KeepAwakeToggle } from '@commise/ui/keep-awake';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { useScrollHost } from '@commise/ui/scroll-host';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { SectionSwitch } from '@commise/ui/section-switch';
import { useTheme } from '@commise/ui/theme';
import { scaleRecipeForServings } from '@kitchensink/recipe-core/scaling';
import type { FC, ReactElement } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { bylineMessages } from '../byline/messages.js';
import { AmbiguityReview } from './AmbiguityReview.native.js';
import { DetailDescription } from './DetailDescription.native.js';
import { detailMetaItems, detailRatingLine, detailStatCells } from './detailFacts.js';
import { DetailFooter } from './DetailFooter.native.js';
import { DetailIngredientsSection } from './DetailIngredientsSection.native.js';
import { DetailInstructionsSection } from './DetailInstructionsSection.native.js';
import { DetailNutritionSection } from './DetailNutritionSection.native.js';
import { DetailRatingLine } from './DetailRatingLine.native.js';
import { DetailStatStrip } from './DetailStatStrip.native.js';
import { detailStyles as styles } from './detailStyles.native.js';
import { detailNoticeState, type RecipeDetailBodyNativeProps } from './model.js';
import { RecipeHero } from './RecipeHero.native.js';

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
    marks,
    screenOn,
    descriptionExpanded,
    onToggleDescription,
    layout,
    bind,
}) => {
    const { detail, duration, card } = useMessages(recipeMessages);
    const bylineCopy = useMessages(bylineMessages);
    const locale = useLocale();
    const { colors } = useTheme();
    const host = useScrollHost();
    const owner = viewerIsOwner === true;
    // A retry from the refresh notice that succeeds removes the button pressed, so the cursor goes to the title.
    const titleRef = useScreenReaderFocusOnSignal<Text>(refreshNotice?.recoveries ?? 0);
    const { unreachable, pageRefreshFailed, saysRecovered } = detailNoticeState(
        recipe.ingredients,
        detail,
        refreshNotice,
        unreachableRetry,
    );
    const scaled = scaleRecipeForServings(recipe, servings);
    const meta = detailMetaItems(recipe, owner, detail, bylineCopy);
    const tags = [...recipe.dietaryFlags, ...recipe.tags];
    const twoColumns = layout.columns === 'two';
    const muted = { color: colors.inkMuted };
    const editSection = owner ? onEditSection : undefined;
    const hint =
        screenOn.hint === undefined ? null : <Text style={[styles.caption, styles.hint, muted]}>{screenOn.hint}</Text>;

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
            onOpenDataSources={onOpenDataSources}
            returnFocusSignal={dataSourcesReturnFocusSignal}
        />
    );
    const tail = (
        <>
            {rating}
            <AmbiguityReview recipe={recipe} viewerIsOwner={owner} />
            <DetailFooter recipe={recipe} onViewVersions={onViewVersions} />
        </>
    );

    // The scroller's direct children, in page order. Built as a list because `stickyHeaderIndices` indexes the
    // children that RENDER: a conditional child that is absent would shift every index after it.
    const children: ReactElement[] = [
        // The hero IS the carousel, so the cover shows once (F2).
        <RecipeHero
            key="hero"
            recipeId={recipe.id}
            title={recipe.title}
            {...(recipe.cuisine === undefined ? {} : { cuisine: recipe.cuisine })}
            photos={recipe.photos}
            {...(heroControls === undefined ? {} : { overlay: heroControls })}
        />,
        <View key="top" style={styles.top}>
            {meta.length > 0 && <Text style={[styles.overline, muted]}>{meta.join(' · ')}</Text>}
            <Text
                ref={titleRef}
                accessibilityRole="header"
                numberOfLines={3}
                style={[styles.title, { color: colors.ink }]}
            >
                {recipe.title}
            </Text>
            <DetailRatingLine ratingLine={detailRatingLine(recipe, owner, locale, { detail, card })} />
            <DetailStatStrip
                stats={detailStatCells(scaled, recipe.difficulty, { detail, duration, card })}
                statsPerRow={layout.statsPerRow}
            />
            <View style={styles.actions}>
                {headerActions}
                {twoColumns ? (
                    <KeepAwakeToggle
                        on={screenOn.on}
                        onChange={screenOn.onChange}
                        label={detail.screenOn}
                        display="labelled"
                    />
                ) : null}
            </View>
            {twoColumns ? hint : null}
            <DetailDescription
                description={recipe.description}
                expanded={descriptionExpanded}
                twoColumns={twoColumns}
                onToggle={onToggleDescription}
            />
            {tags.length > 0 && <Text style={[styles.meta, muted]}>{tags.join(' · ')}</Text>}
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

    let stickyHeaderIndices: number[] | undefined;

    if (twoColumns) {
        children.push(
            <View key="columns" style={styles.twoColumns}>
                {ingredients}
                <View style={[styles.stack, styles.stepsColumn]}>
                    {steps}
                    {nutrition}
                    {tail}
                </View>
            </View>,
        );
    } else {
        // The section switch sticks, so it is a child of its own; Screen on lives in it, icon-only.
        stickyHeaderIndices = [children.length];
        children.push(
            <SectionSwitch
                key="switch"
                label={detail.sectionsLabel}
                {...(host.current === undefined ? {} : { currentId: host.current })}
                sections={[
                    { id: 'ingredients', label: detail.ingredientsHeading },
                    { id: 'steps', label: detail.instructionsHeading },
                    { id: 'nutrition', label: detail.nutritionLink },
                ]}
                trailing={
                    <KeepAwakeToggle
                        on={screenOn.on}
                        onChange={screenOn.onChange}
                        label={detail.screenOn}
                        display="icon"
                    />
                }
            />,
        );

        if (hint !== null) {
            children.push(
                <View key="hint" style={styles.sectionBlock}>
                    {hint}
                </View>,
            );
        }

        // ⛔ Each section a DIRECT child of the content: `onLayout` y is relative to the parent (blueprint A7).
        children.push(
            <View key="ingredients" onLayout={host.sectionLayout('ingredients')} style={styles.sectionBlock}>
                {ingredients}
            </View>,
            <View key="steps" onLayout={host.sectionLayout('steps')} style={styles.sectionBlock}>
                {steps}
            </View>,
            <View key="nutrition" onLayout={host.sectionLayout('nutrition')} style={styles.sectionBlock}>
                {nutrition}
            </View>,
            <View key="tail" style={[styles.stack, styles.sectionBlock]}>
                {tail}
            </View>,
        );
    }

    if (scrollFooter !== undefined) {
        children.push(
            <View key="footer" style={styles.sectionBlock}>
                {scrollFooter}
            </View>,
        );
    }

    return (
        <ScrollView
            {...bind}
            style={styles.scroll}
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
            {...(stickyHeaderIndices === undefined ? {} : { stickyHeaderIndices })}
        >
            {children}
        </ScrollView>
    );
};
