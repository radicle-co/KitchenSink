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
import { KeepAwakeToggle } from '@commise/ui/keep-awake';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { useTheme } from '@commise/ui/theme';
import { scaleRecipeForServings } from '@kitchensink/recipe-core/scaling';
import type { FC } from 'react';
import { Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
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
    const scaled = scaleRecipeForServings(recipe, servings);
    const meta = detailMetaItems(recipe, owner, detail);
    const tags = [...recipe.dietaryFlags, ...recipe.tags];
    const twoColumns = layout.columns === 'two';
    const muted = { color: colors.inkMuted };
    const editSection = owner ? onEditSection : undefined;

    return (
        <View style={styles.container}>
            {/* The hero IS the carousel, so the cover shows once (F2). */}
            <RecipeHero title={recipe.title} photos={recipe.photos} />

            <View style={styles.top}>
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
                    <KeepAwakeToggle
                        on={screenOn.on}
                        onChange={screenOn.onChange}
                        label={detail.screenOn}
                        display="labelled"
                    />
                </View>
                <DetailDescription
                    description={recipe.description}
                    expanded={descriptionExpanded}
                    twoColumns={twoColumns}
                    onToggle={onToggleDescription}
                />
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
                <View style={[styles.column, twoColumns ? styles.stepsColumn : null]}>
                    <DetailInstructionsSection
                        steps={recipe.steps}
                        marks={marks}
                        onEdit={editSection === undefined ? undefined : () => editSection('steps')}
                    />
                    <DetailNutritionSection
                        recipe={recipe}
                        onOpenDataSources={onOpenDataSources}
                        returnFocusSignal={dataSourcesReturnFocusSignal}
                    />
                    {rating}
                    <AmbiguityReview recipe={recipe} viewerIsOwner={owner} />
                    <DetailFooter recipe={recipe} onViewVersions={onViewVersions} />
                </View>
            </View>
        </View>
    );
};
