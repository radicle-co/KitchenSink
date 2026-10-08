'use client';

/**
 * @module @commise/features-recipes — native recipe-detail view (T066 building block).
 *
 * The React Native leaf of `RecipeDetailView` — same read-only
 * contract and content sections, styled to the Commise design language (@commise/ui palette): a display
 * title, seafoam/coral tag pills, a stats strip, checklist ingredients, numbered seafoam step markers, and
 * a nutrition grid. Mirrors the web `RecipeDetailView`.
 *
 * U8 brand layer: the header sits in a {@link GradientSurface} title band, the display title threads the
 * Playfair `display` family, and the stat/ingredient/step cards carry tokenized elevation — so the native
 * detail reads as branded as the web leaf.
 *
 * This is the PURE render half of the recipe detail. Its orchestration shell —
 * `RecipeDetailView.native.tsx`, which binds the session serving scale — is a separate file because a file
 * does ONE thing (CODING_STANDARDS §1) and a component per file is enforced.
 *
 * @pattern Humble Object — the pure render half of the orchestration/render split whose shell is
 *     `RecipeDetailView.native.tsx`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette, tint } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { StandIn } from '@commise/ui/stand-in';
import { StatusBadge } from '@commise/ui/status-badge';
import { GradientSurface } from '@commise/ui/surface';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import { hasCatalogNutrition, hasUserEnteredIngredients, RecipeVisibility } from '@kitchensink/recipe-core';
import { scaleRecipeForServings } from '@kitchensink/recipe-core/scaling';
import type { FC, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { AmbiguityReview } from './AmbiguityReview.native.js';
import { isStandInName, lineDisplayName, variantPartTexts } from './lineName.js';
import { fillTemplate, formatDurationMinutes } from '../list/model.js';
import { RecipeHero } from './RecipeHero.native.js';
import { RecipeSourceLine } from './RecipeSourceLine.native.js';
import { SERVING_STEPPER_MIN_WIDTH, ServingScaleControl } from './ServingScaleControl.native.js';
import {
    formatQuantity,
    isLineAmbiguous,
    isLineNeedsReview,
    isLineFoodRemoved,
    allLinesFoodRemoved,
    ingredientCheckLabel,
    removedFoodNotice,
    detailNoticeState,
    needsReviewNotice,
    rangeDerivedNotice,
    staleNutritionNotice,
    stepTimerLabel,
    type RecipeDetailBodyNativeProps,
} from './model.js';

/** One label/value cell in the stats or nutrition strip. */
const Stat: FC<{ label: string; value: ReactNode }> = ({ label, value }) => (
    <View style={styles.statCell}>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
    </View>
);

/**
 * The pure `props → JSX` detail render: one responsibility, no state, no fetching, no ref. Everything it
 * shows for a chosen serving count comes from `scaleRecipeForServings`, so what scales (and what
 * deliberately does not) is decided once, in the domain, for both platforms.
 *
 * Exported for tests and for its shell; deliberately NOT on the package barrel — an app composes
 * `RecipeDetailView`, which cannot be shipped with the serving scale un-wired.
 */
export const RecipeDetailBody: FC<RecipeDetailBodyNativeProps> = ({
    recipe,
    checkedIngredients,
    onToggleIngredient,
    checkedSteps,
    onToggleStep,
    onFilterByTag,
    footerActions,
    headerActions,
    servings,
    onServingsChange,
    refreshNotice,
    unreachableRetry,
    onOpenDataSources,
    dataSourcesReturnFocusSignal,
    viewerIsOwner,
}) => {
    const { list, detail, duration, ingredientLineName, ingredientDetails } = useMessages(recipeMessages);
    // A retry from the refresh notice that succeeds removes the button the viewer pressed, so the screen-reader cursor
    // goes to the title.
    const titleRef = useScreenReaderFocusOnSignal<Text>(refreshNotice?.recoveries ?? 0);
    // Plan 002 R2 — the web leaf's unreachable notice, mirrored. Its `recoveries` counts only retries that loaded
    // EVERY name: React Native cannot tell whether the cursor moved on, so a partial recovery or a background refetch
    // must not move it off a button that is still there.
    const { unreachable, pageRefreshFailed, saysRecovered } = detailNoticeState(
        recipe.ingredients,
        detail,
        refreshNotice,
        unreachableRetry,
    );
    const ingredientsHeadingRef = useScreenReaderFocusOnSignal<Text>(unreachableRetry.recoveries);
    // The Data sources sheet returns the reading cursor to the link that opened it (§S16).
    const sourcesLinkRef = useScreenReaderFocusOnSignal<View>(dataSourcesReturnFocusSignal);
    const locale = useLocale();
    // Cuisine + dietary flags are descriptive pills; only `tags` are the search-filter chips (D6).
    const staticBadges = [...(recipe.cuisine ? [recipe.cuisine] : []), ...recipe.dietaryFlags];
    // R38 — see the web leaf: read from the STORED figure, not the scaled projection.
    const rangeNotice = rangeDerivedNotice(recipe.nutrition, {
        low: detail.nutritionRangeDerivedLow,
        high: detail.nutritionRangeDerivedHigh,
    });
    // KTD-3b — see the web leaf: a fact about the read, so from the stored figure.
    const staleNotice = staleNutritionNotice(recipe.nutrition, detail.nutritionStale);
    // ONE derivation, shared with the web leaf: quantities + prep scale, cook time and step timers do not.
    const scaled = scaleRecipeForServings(recipe, servings);
    // U14 — read from the STORED lines rather than the scaled projection, for the same reason `rangeNotice`
    // is: which lines the gate doubted is a fact about the recipe, not about the serving count on screen.
    const reviewNotice = needsReviewNotice(recipe.ingredients, detail);

    return (
        <View style={styles.container}>
            {/* The mockup LEADS the detail with its photos, before any type. The hero IS the carousel, so the cover
                shows once (F2); a recipe with no photo gets its deliberate placeholder — see `RecipeHero.native`,
                which paints it COMPACT on a phone (its module doc carries the PLATFORM-FORK rationale). */}
            <RecipeHero title={recipe.title} photos={recipe.photos} />

            {/* U8: the header rides a beach-glow gradient title band (mockup recipe-detail). */}
            <GradientSurface gradient="hero" style={styles.titleBand}>
                <Text ref={titleRef} accessibilityRole="header" style={styles.title}>
                    {recipe.title}
                </Text>
                {/* ⛔ ALWAYS STACKED UNDER THE TITLE, with no width branch — deliberately unlike the web leaf,
                    which goes side-by-side from `sm`. The web breakpoint exists because a desktop viewport
                    has the horizontal room; a phone never does, and putting the pair beside an unbounded
                    user-authored title at 375pt is the squeeze this whole move is meant to avoid.
                    ⚠️ A TABLET could afford the row, and this leaf deliberately does NOT reach for
                    `isTabletWidth` to get it: that would put `useWindowDimensions` inside a pure
                    `props → JSX` render for a purely cosmetic gain, when stacked-above-the-body already
                    satisfies the requirement at every width. */}
                {headerActions !== undefined && <View style={styles.headerActions}>{headerActions}</View>}
                {(staticBadges.length > 0 || recipe.tags.length > 0) && (
                    <View style={styles.badgeRow}>
                        {staticBadges.map((badge, index) => (
                            <Text
                                key={badge}
                                style={[styles.badge, index % 2 === 0 ? styles.badgeSeafoam : styles.badgeCoral]}
                            >
                                {badge}
                            </Text>
                        ))}
                        {recipe.tags.map((tag) => (
                            <Pressable
                                key={tag}
                                accessibilityRole="button"
                                accessibilityLabel={fillTemplate(detail.tagFilterLabel, { tag })}
                                onPress={() => onFilterByTag?.(tag)}
                            >
                                <Text style={[styles.badge, styles.badgeCoral]}>{tag}</Text>
                            </Pressable>
                        ))}
                    </View>
                )}
                <Text style={styles.description}>{recipe.description}</Text>
            </GradientSurface>

            {refreshNotice !== undefined && (
                <RefreshNotice
                    failed={pageRefreshFailed}
                    refreshing={refreshNotice.refreshing}
                    onRetry={refreshNotice.onRetry}
                    labels={{ failed: detail.refreshError, retry: detail.refreshRetry }}
                />
            )}

            {/* Provenance renders for EVERY viewer, owner or not — it is a property of the recipe, not of
                who is looking. Absent source renders nothing at all. */}
            <RecipeSourceLine
                {...(recipe.sourceUrl === undefined ? {} : { sourceUrl: recipe.sourceUrl })}
                {...(recipe.sourceAttribution === undefined ? {} : { sourceAttribution: recipe.sourceAttribution })}
            />

            {/* C2 wireframe parity: Serves leads the strip, then Prep, Cook, Total. */}
            <View style={styles.statStrip}>
                {/* Rendered inline rather than through `Stat`: the serving cell's value is a CONTROL, and
                    `Stat` wraps its value in a `<Text>` — nesting a `View` inside a `Text` is invalid in
                    React Native. Giving `Stat` a "is this a string?" branch would have hidden that. */}
                <View style={[styles.statCell, styles.statCellServings]}>
                    <ServingScaleControl
                        servings={servings}
                        baseServings={recipe.servings}
                        onServingsChange={onServingsChange}
                    />
                    <Text style={styles.statLabel}>{detail.servingsLabel}</Text>
                </View>
                <Stat
                    label={detail.prepLabel}
                    value={formatDurationMinutes(scaled.prepTimeMinutes, list.durationMinutes)}
                />
                <Stat
                    label={detail.cookLabel}
                    // NOT scaled by accident — `ScaledRecipe.cookTimeMinutes` IS the stored value.
                    value={formatDurationMinutes(scaled.cookTimeMinutes, list.durationMinutes)}
                />
                <Stat
                    label={detail.totalLabel}
                    value={formatDurationMinutes(scaled.totalTimeMinutes, list.durationMinutes)}
                />
            </View>

            {/* The disclosure is part of the feature: doubled quantities beside an unchanged cook time must
                say so. `accessibilityLiveRegion` announces it when it appears rather than leaving it to
                sighted scanning. */}
            {scaled.scaling.isScaled && (
                <View accessibilityLiveRegion="polite" style={styles.scaleNotice}>
                    <Text style={styles.scaleNoticeText}>
                        {fillTemplate(detail.scaledNotice, { original: recipe.servings })}
                    </Text>
                    <Text style={[styles.scaleNoticeText, styles.scaleNoticeCaveat]}>{detail.scaledTimingCaveat}</Text>
                </View>
            )}

            {/* The recovery is the heading's HINT, read when the cursor lands there — not a live region, which would
                speak again on a background refetch the cook did not ask for. */}
            <Text
                ref={ingredientsHeadingRef}
                accessibilityRole="header"
                {...(saysRecovered ? { accessibilityHint: detail.unreachableResolved } : {})}
                style={styles.sectionHeading}
            >
                {detail.ingredientsHeading}
            </Text>
            {/* Plan 002 R2 — lines food could not be asked about. ALWAYS MOUNTED and hidden through `failed`, and it
                takes precedence over the page-level notice; the web leaf records why. */}
            <RefreshNotice
                failed={unreachable !== undefined}
                refreshing={unreachableRetry.refreshing}
                onRetry={unreachableRetry.onRetry}
                labels={{ failed: unreachable ?? '', retry: detail.refreshRetry }}
            />
            {/* The withdrawn-food tile (owner ruling 4) — head of the Ingredients section, mirroring the web
                leaf, and full-bleed within the section on this narrow viewport.

                ⚠️ `role`, NOT `accessibilityRole` — but not for the reason a first reading suggests, and
                the difference matters because the wrong reason has already been written down twice. RN's
                `AccessibilityRole` union has no `note` member so `accessibilityRole="note"` does not
                type-check; the ARIA-shaped `role` prop DOES accept it. What it does NOT do is reach either
                platform: `ReactAccessibilityDelegate.kt`'s `fromRole` has no `Role.NOTE` case and falls
                through to `null`, and iOS has no `note` trait at all (`RCTViewComponentView.mm` special-
                cases only checkbox/radio). So on a real device this prop is INERT, and the sentence is
                announced correctly because an RN `<Text>` is already its own accessibility node.

                It is kept because it states the intent, costs nothing, and is what lets the mirror test
                assert placement — that suite renders through react-native-web under jsdom, which forwards
                the literal `role` to the DOM. ⛔ Do not read the test's `getByRole('note')` as evidence
                about the native accessibility tree; it measures the web build of RN.

                ⛔ Warning TINT with a charcoal label, never `warning` as a text colour (`colors.ts`). */}
            {removedFoodNotice(recipe.ingredients, detail) !== undefined && (
                <Text role="note" style={styles.removedFoodNotice}>
                    {removedFoodNotice(recipe.ingredients, detail)}
                </Text>
            )}
            <View style={styles.card}>
                {scaled.ingredients.map((ingredient) => {
                    const qty = formatQuantity(ingredient.quantity, locale, ingredient.unit);
                    const checked = checkedIngredients?.has(ingredient.ingredientId) ?? false;
                    const parts = variantPartTexts(ingredient.variant?.parts);

                    return (
                        <View key={ingredient.ingredientId} style={styles.ingredientRow}>
                            {/* The tap target is a 44pt wrapper (RC-3); the visible checkbox stays a compact
                                18px box centered inside it, so the checklist reads tight but taps large. */}
                            <Pressable
                                accessibilityRole="checkbox"
                                // Both state forms are load-bearing, neither is redundant (#123).
                                // `accessibilityState.checked` is the DEVICE trait VoiceOver/TalkBack read;
                                // `aria-checked` is the only one that reaches the DOM — react-native-web
                                // forwards literal `aria-*` props and projects `accessibilityState` for
                                // NOTHING, so the object form alone left this `role="checkbox"` with no state
                                // attribute at all on the web build (the ✓ is sighted-only), which is also the
                                // parity the web leaf already had. `aria-checked` — not `aria-selected` (ARIA
                                // allows it only on `option`/`tab`/`row`/`gridcell`-family roles) and not
                                // `aria-pressed` (a toggle-BUTTON attribute). Keep both: RN reverse-maps
                                // `aria-checked` into `accessibilityState.checked`.
                                accessibilityState={{ checked }}
                                aria-checked={checked}
                                accessibilityLabel={ingredientCheckLabel(
                                    ingredient,
                                    locale,
                                    ingredientLineName,
                                    ingredientDetails.checkLabelWithDetails,
                                )}
                                onPress={() => onToggleIngredient?.(ingredient.ingredientId)}
                                style={styles.checkboxTouch}
                            >
                                <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                                    {checked && <Text style={styles.checkMark}>✓</Text>}
                                </View>
                            </Pressable>
                            {/* The quantity, the name, the preparation, the notes AND the status badges wrap as
                                ONE block, the web leaf's flowing text (`namelessLineCopy.md` §2c, E2 I1). A
                                `flexShrink: 0` badge beside the 44 dp checkbox left the name 0 px at a large font
                                scale; inside the block a badge wraps under the name instead. The quantity and the
                                name are ONE paragraph (mockup frame 1), so a long name wraps under the quantity
                                rather than taking a row of its own below it. A nameless line shows its stand-in AS
                                the name (plan 002 R9) — a `View`, because nested `Text` takes no border, so there
                                the quantity stays a `Text` of its own. */}
                            <View style={styles.ingredientText}>
                                {isStandInName(ingredient) ? (
                                    <>
                                        {qty !== '' && (
                                            <Text style={[styles.ingredientLine, styles.ingredientQty]}>{qty}</Text>
                                        )}
                                        <StandIn tone={isLineFoodRemoved(ingredient) ? 'caution' : 'neutral'}>
                                            {lineDisplayName(ingredient, ingredientLineName)}
                                        </StandIn>
                                    </>
                                ) : (
                                    <Text style={styles.ingredientLine}>
                                        {qty !== '' && (
                                            <>
                                                <Text style={styles.ingredientQty}>{qty}</Text>{' '}
                                            </>
                                        )}
                                        <Text>{lineDisplayName(ingredient, ingredientLineName)}</Text>
                                    </Text>
                                )}
                                {/* Curated U15 — see the web leaf: the dotted line under the name, before the cook's
                                    own words, on a row of its own in this wrapping block. */}
                                {parts !== undefined && (
                                    <View style={styles.variantParts}>
                                        <VariantPartsLine parts={parts} tone="secondary" />
                                    </View>
                                )}
                                {/* U26 — the PREPARATION, its own element after the name and never folded
                                    into it. Mirrors the web leaf: without it a saved preparation would be
                                    invisible on the surface a cook actually cooks from. */}
                                {ingredient.preparation !== undefined && ingredient.preparation.length > 0 && (
                                    <Text style={styles.ingredientNotes}>{ingredient.preparation}</Text>
                                )}
                                {ingredient.notes !== undefined && ingredient.notes.length > 0 && (
                                    <Text style={styles.ingredientNotes}>{ingredient.notes}</Text>
                                )}
                                {ingredient.isUserEntered && (
                                    <StatusBadge tone="neutral">{detail.userEnteredBadge}</StatusBadge>
                                )}
                                {/* U14 — the LINE the verification gate contradicted. Mirrors the web leaf: the
                                    caution tone, and no accessibility role — the text is content of the row and is
                                    announced with it. */}
                                {isLineNeedsReview(ingredient) && (
                                    <StatusBadge tone="caution">{detail.needsReviewBadge}</StatusBadge>
                                )}
                                {/* U13 (D7/R9) — the same caution tone as needs-review; the pick lives in the
                                    batched review surface below (the figure still counts, R23). */}
                                {isLineAmbiguous(ingredient) && (
                                    <StatusBadge tone="caution">{detail.ambiguousBadge}</StatusBadge>
                                )}
                                {/* The food's author withdrew it. Caution tone like needs-review — the cook can act
                                    (re-match the line in the editor). Suppressed when every line is removed (a
                                    badge on every row is wallpaper, and the tile already says it) and on a line
                                    whose stand-in already says "removed". */}
                                {isLineFoodRemoved(ingredient) &&
                                    !isStandInName(ingredient) &&
                                    !allLinesFoodRemoved(recipe.ingredients) && (
                                        <StatusBadge tone="caution">{detail.removedFoodBadge}</StatusBadge>
                                    )}
                            </View>
                        </View>
                    );
                })}
            </View>

            <Text accessibilityRole="header" style={styles.sectionHeading}>
                {detail.instructionsHeading}
            </Text>
            <View style={styles.stepList}>
                {recipe.steps.map((step) => {
                    const done = checkedSteps?.has(step.stepNumber) ?? false;
                    const timer = stepTimerLabel(step.timerSeconds, detail.stepTimer, duration);

                    return (
                        <View key={step.stepNumber} style={styles.stepRow}>
                            {/* 44pt tap target (RC-3) wrapping the compact 32px numbered marker circle. */}
                            <Pressable
                                accessibilityRole="checkbox"
                                // Device trait + the DOM-observable checked state — see the ingredient
                                // checkbox above (#123). The numbered-marker/✓ swap and the struck-through
                                // step text are SIGHTED affordances; `aria-checked` is the announced one.
                                accessibilityState={{ checked: done }}
                                aria-checked={done}
                                accessibilityLabel={fillTemplate(detail.stepToggleLabel, { step: step.stepNumber })}
                                onPress={() => onToggleStep?.(step.stepNumber)}
                                style={styles.stepMarkerTouch}
                            >
                                <View style={[styles.stepMarker, done && styles.stepMarkerDone]}>
                                    <Text style={[styles.stepMarkerLabel, done && styles.stepMarkerLabelDone]}>
                                        {done ? '✓' : step.stepNumber}
                                    </Text>
                                </View>
                            </Pressable>
                            <View style={styles.stepBody}>
                                <Text style={[styles.stepText, done && styles.stepTextDone]}>{step.instruction}</Text>
                                {timer !== undefined && (
                                    <View style={styles.stepTimerRow}>
                                        {/* The duration alone does not say it is a timer; the glyph does, so it
                                            carries that as its accessible name. */}
                                        <Text role="img" accessibilityLabel={detail.stepTimerIcon}>
                                            ⏱
                                        </Text>
                                        <Text style={styles.stepTimer}>{timer}</Text>
                                    </View>
                                )}
                            </View>
                        </View>
                    );
                })}
            </View>

            <Text accessibilityRole="header" style={styles.sectionHeading}>
                {detail.nutritionHeading}
            </Text>
            <View style={styles.statStrip}>
                <Stat label={detail.caloriesLabel} value={String(recipe.nutrition.calories)} />
                <Stat
                    label={detail.proteinLabel}
                    value={fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.proteinG })}
                />
                <Stat
                    label={detail.carbsLabel}
                    value={fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.carbsG })}
                />
                <Stat
                    label={detail.fatLabel}
                    value={fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.fatG })}
                />
            </View>
            {!recipe.nutrition.isComplete && <Text style={styles.description}>{detail.nutritionPartial}</Text>}
            {/* R38 — see the web leaf: a different admission from the partial notice, and both can be true. */}
            {rangeNotice !== undefined && <Text style={styles.description}>{rangeNotice}</Text>}
            {/* KTD-3b — see the web leaf: a neutral disclosure, after the range notice. */}
            {staleNotice !== undefined && <Text style={styles.description}>{staleNotice}</Text>}
            {/* U14 — see the web leaf: a THIRD admission, and the only one that is our own doubt rather than a
                gap in the data.

                ⚠️ `role`, NOT `accessibilityRole` — see the withdrawn-food tile above for the full account.
                The prop is inert on both platforms (Android's `fromRole` has no `Role.NOTE` case and iOS has no
                `note` trait), so nothing may rely on RN mapping it to a platform role. Keep it — it states
                intent and costs nothing — and do not "fix" it into `accessibilityRole`, which does not
                type-check. */}
            {reviewNotice !== undefined && (
                <Text role="note" style={styles.reviewNotice}>
                    {reviewNotice}
                </Text>
            )}
            {/* §S15: two sentences, each with its own condition. A link inside a sentence is too small to tap, so on
                native the link is its own 48 dp row between them, and it opens the Data sources sheet (§S18). */}
            {hasCatalogNutrition(recipe.ingredients) && (
                <View>
                    <Text style={styles.sourceNote}>{detail.nutritionSourceNote}</Text>
                    <Pressable
                        ref={sourcesLinkRef}
                        accessibilityRole="link"
                        onPress={onOpenDataSources}
                        style={styles.sourcesLinkTouch}
                    >
                        <Text style={styles.sourcesLink}>{detail.nutritionSourcesLink}</Text>
                    </Pressable>
                </View>
            )}
            {hasUserEnteredIngredients(recipe.ingredients) && (
                <Text style={styles.sourceNote}>{detail.nutritionCustomNote}</Text>
            )}

            {/* U13 — the ambiguity review surface + the one-time clone banner (stored lines). */}
            <AmbiguityReview recipe={recipe} viewerIsOwner={viewerIsOwner === true} />

            {/* C3 wireframe parity: the clone action (caller-supplied) + version + visibility badges are ONE
                grouped footer row — `[Clone to My Recipes] [v12] [Public]` — rather than three loose pieces. */}
            <View collapsable={false} accessibilityLabel={detail.badgesLabel} style={styles.badgeRow}>
                {footerActions}
                {recipe.currentVersion > 1 && (
                    <Text
                        accessibilityLabel={fillTemplate(detail.versionLabel, { version: recipe.currentVersion })}
                        style={[styles.badge, styles.badgeNeutral]}
                    >
                        {fillTemplate(detail.versionBadge, { version: recipe.currentVersion })}
                    </Text>
                )}
                <Text style={[styles.badge, styles.badgeSeafoam]}>
                    {recipe.visibility === RecipeVisibility.PUBLIC ? detail.visibilityPublic : detail.visibilityPrivate}
                </Text>
            </View>
        </View>
    );
};

/**
 * Width the Serves cell reserves, so its stepper is never clipped. Taken FROM the control rather than
 * restated, so raising the 44pt touch floor moves this with it.
 */
export const STAT_CELL_SERVINGS_MIN_WIDTH = SERVING_STEPPER_MIN_WIDTH;

/** The strip wraps rather than clipping when its cells cannot fit one line. Published for the guard test. */
export const STAT_STRIP_WRAPS = 'wrap' as const;

/** The ingredient tick's tap target, in dp (RC-3). */
const CHECKBOX_TARGET = 44;

/** The leading of an ingredient line, in dp: `bodySm` at the body ratio, the leading of the dotted line under it. */
const INGREDIENT_LINE_HEIGHT = nativeTokens.fontSize.bodySm * nativeTokens.lineHeight.body;

/**
 * How far the text block sits below the row's top, so its first line's middle meets the tick target's middle. At a
 * larger font scale the line grows and the target does not, so the tick stays at the top of that first line.
 */
const FIRST_LINE_OFFSET = (CHECKBOX_TARGET - INGREDIENT_LINE_HEIGHT) / 2;

const styles = StyleSheet.create({
    container: {
        gap: nativeTokens.spacing[4],
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[4],
    },
    // U8: the beach-glow gradient title band the header sits in.
    titleBand: {
        gap: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.lg,
        padding: nativeTokens.spacing[4],
    },
    // The owner's `[Edit] [More]` pair, under the title inside the band (C4 wireframe parity). `flex-start`
    // keeps the pills at their intrinsic width rather than stretching them across the band.
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: nativeTokens.spacing[2],
    },
    // U8 brand leaf: the display title threads the REGISTERED bold Playfair face. React Native resolves
    // `fontFamily` to one registered face name — the web CSS stack would fall back to the system serif with
    // no error at all, so the face token is the only value that actually renders the brand type.
    title: {
        fontFamily: nativeTokens.fontFace.display.bold,
        fontSize: nativeTokens.fontSize.displayMd,
        fontWeight: '700',
        color: palette.charcoal,
    },
    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[2] },
    badge: {
        borderRadius: nativeTokens.radius.full,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[1],
        fontSize: 13,
        fontWeight: '500',
        overflow: 'hidden',
    },
    // Contrast (WCAG AA): a tint-on-tint badge labels itself in a DARKENED relative of its own hue, never the
    // hue itself. Seafoam-on-seafoam/10 is 3.57:1 — the U4 pass demoted only the coral half and left this one
    // under the 4.5:1 floor; `ocean-dark` is 5.51:1 and keeps the badge in its hue family.
    badgeSeafoam: { backgroundColor: tint(palette.seafoam, 0.1), color: palette['ocean-dark'] },
    // Coral-as-text on the coral tint is 2.06:1 — demote the tag text to slate (4.67:1) while keeping the
    // warm tint background. The brand coral-on-darker-coral treatment is U8's.
    badgeCoral: { backgroundColor: tint(palette.coral, 0.15), color: palette.slate },
    badgeNeutral: { backgroundColor: palette.pearl, color: palette.slate },
    description: { fontSize: nativeTokens.fontSize.bodyMd, lineHeight: 24, color: palette.slate },
    sourceNote: { fontSize: nativeTokens.fontSize.caption, lineHeight: 16, color: palette.slate },
    // 48 dp: the link is its own row, never a target too small to tap (§S15).
    sourcesLinkTouch: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
    // `ocean-dark` is 6.20:1 on the page surface, and the underline keeps the affordance off colour alone.
    sourcesLink: {
        fontSize: nativeTokens.fontSize.caption,
        lineHeight: 16,
        fontWeight: '500',
        color: palette['ocean-dark'],
        textDecorationLine: 'underline',
    },
    scaleNotice: {
        gap: nativeTokens.spacing[1],
        backgroundColor: palette.pearl,
        borderRadius: nativeTokens.radius.lg,
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[3],
    },
    scaleNoticeText: { fontSize: nativeTokens.fontSize.bodySm, lineHeight: 20, color: palette.charcoal },
    scaleNoticeCaveat: { fontWeight: '600' },
    statStrip: {
        flexDirection: 'row',
        // Belt to the reservation's braces: on a narrower device, or after a copy change, a second line is
        // legible where a sliced-in-half control is not.
        flexWrap: STAT_STRIP_WRAPS,
        backgroundColor: palette.white,
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        paddingVertical: nativeTokens.spacing[4],
        // U8 brand leaf: tokenized card elevation (was flat, border-only).
        ...nativeTokens.elevation.sm,
    },
    statCell: { flex: 1, alignItems: 'center', gap: nativeTokens.spacing[1] },
    // ⛔ The Serves cell is NOT an equal quarter. Its value is a CONTROL with a fixed intrinsic width (two
    // 44pt touch targets and a value box); an equal share is ~85dp on a 375dp phone, so it overflowed and
    // the emulator rendered the `−` cut in half by the screen edge. The figure comes FROM the control.
    statCellServings: { minWidth: STAT_CELL_SERVINGS_MIN_WIDTH },
    statValue: { fontSize: nativeTokens.fontSize.bodyLg, fontWeight: '700', color: palette.charcoal },
    statLabel: {
        fontSize: nativeTokens.fontSize.overline,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: palette.slate,
    },
    sectionHeading: { fontSize: nativeTokens.fontSize.headingMd, fontWeight: '600', color: palette.charcoal },
    card: {
        backgroundColor: palette.white,
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        padding: nativeTokens.spacing[2],
        // U8 brand leaf: tokenized card elevation (was flat, border-only).
        ...nativeTokens.elevation.sm,
    },
    // Top-aligned, so a row of two lines or more keeps its tick by the first line (mockup frame 1).
    ingredientRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingVertical: nativeTokens.spacing[1],
        paddingHorizontal: nativeTokens.spacing[2],
    },
    // 44pt tap target (RC-3) around the compact visible checkbox. `flexShrink: 0` protects that floor from
    // the row's own overflow: RN would otherwise be free to squeeze the target, not the text beside it.
    checkboxTouch: {
        flexShrink: 0,
        width: CHECKBOX_TARGET,
        height: CHECKBOX_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkbox: {
        width: 18,
        height: 18,
        borderRadius: 4,
        borderWidth: 2,
        // Contrast (U4): mist border on white is 1.9:1 — a checkbox is a UI component (3:1 minimum); slate is 5:1.
        borderColor: palette.slate,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxChecked: { backgroundColor: palette.seafoam, borderColor: palette.seafoam },
    checkMark: { fontSize: nativeTokens.fontSize.caption, color: palette.white },
    ingredientQty: { fontWeight: '600' },
    // RN defaults `flexShrink` to 0, so without these the two USER-SUPPLIED values in this row took their full
    // intrinsic width and pushed the row past the card and screen edge — the same failure that clipped
    // `CollectionHeader.native.tsx`'s Rename and dropped its Delete out of the hierarchy. The web leaf spells it
    // `min-w-0 break-words`.
    // The flowing text block: the name (or its stand-in), the preparation, the notes and the status badges wrap
    // together and take the whole width the tick and the amount leave (E2 I1).
    ingredientText: {
        flexShrink: 1,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: nativeTokens.spacing[1],
        paddingTop: FIRST_LINE_OFFSET,
    },
    // The quantity and the name's paragraph. Its leading is fixed so the block's offset can centre its first line.
    ingredientLine: {
        flexShrink: 1,
        fontSize: nativeTokens.fontSize.bodySm,
        lineHeight: INGREDIENT_LINE_HEIGHT,
        color: palette.charcoal,
    },
    // A row of its own in the wrapping block: the dotted line sits under the name (§S5), 4 dp below it (§S4a).
    variantParts: { flexBasis: '100%', marginTop: nativeTokens.spacing[1] },
    ingredientNotes: { flexShrink: 1, fontSize: 13, color: palette.slate },
    // The recipe-level disclosure. `description`'s size, but charcoal and weighted rather than slate, so it
    // is distinguishable at a glance from the two neutral caveats above it — it is an admission a cook can
    // ACT on (re-pick the food), not a note that the data is thin.
    reviewNotice: {
        fontSize: nativeTokens.fontSize.bodySm,
        fontWeight: '600',
        color: palette.charcoal,
    },
    // The withdrawn-food tile. Its own style rather than `reviewNotice`'s: that one is a bare sentence in
    // the Nutrition section, this is a filled tile at the head of a list, and sharing a style would make a
    // tone change to one silently change the other.
    removedFoodNotice: {
        backgroundColor: tint(palette.warning, 0.25),
        borderRadius: nativeTokens.radius.lg,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
        fontSize: nativeTokens.fontSize.bodySm,
        color: palette.charcoal,
    },
    stepList: { gap: 14 },
    stepRow: { flexDirection: 'row', gap: nativeTokens.spacing[3], alignItems: 'flex-start' },
    // 44pt tap target (RC-3) around the compact 32px numbered marker circle.
    stepMarkerTouch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    // PENDING is an outline, DONE is a filled disc — the same two states the web leaf paints as
    // `border-2 border-seafoam text-ocean-dark` / `bg-seafoam text-white`.
    //
    // This base style used to paint `backgroundColor: palette.seafoam`, which made `stepMarkerDone`'s identical
    // override a NO-OP: both states rendered the same filled seafoam disc, so a completed step was tellable
    // from a pending one only by the glyph inside it — and that glyph was white on a fill it could not be read
    // against. Web and native therefore disagreed about what a pending step even looks like (#113).
    stepMarker: {
        width: 32,
        height: 32,
        borderRadius: nativeTokens.radius.full,
        backgroundColor: palette.white,
        borderWidth: 2,
        borderColor: palette.seafoam,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    stepMarkerDone: { backgroundColor: palette.seafoam, borderColor: palette.seafoam },
    // Pending, the numeral is the only thing in the circle and a reader reads it, so it takes `ocean-dark`
    // (6.20:1 on the white disc); the seafoam ring is a non-text boundary and clears the 3:1 of SC 1.4.11.
    stepMarkerLabel: { color: palette['ocean-dark'], fontWeight: '600' },
    stepMarkerLabelDone: { color: palette.white },
    stepBody: { flex: 1, gap: 2, paddingTop: nativeTokens.spacing[1] },
    stepText: { fontSize: 15, lineHeight: 22, color: palette.charcoal },
    stepTextDone: { textDecorationLine: 'line-through', opacity: 0.6 },
    // Contrast (WCAG 2.1 AA): a label a reader READS takes `ocean-dark` (6.20:1) rather than seafoam (4.02:1).
    // Mirrors the web leaf's `text-ocean-dark`; the seafoam step-marker FILL above is a non-text accent.
    stepTimerRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    stepTimer: { fontSize: 13, fontWeight: '500', color: palette['ocean-dark'] },
});
