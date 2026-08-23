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
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette, tint } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { GradientSurface } from '@commise/ui/surface';
import { hasUserEnteredIngredients, RecipeVisibility } from '@kitchensink/recipe-core';
import { scaleRecipeForServings } from '@kitchensink/recipe-core/scaling';
import type { FC, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { fillTemplate, formatDurationMinutes } from '../list/model.js';
import { PhotoCarousel } from './PhotoCarousel.native.js';
import { RecipeHero } from './RecipeHero.native.js';
import { RecipeSourceLine } from './RecipeSourceLine.native.js';
import { SERVING_STEPPER_MIN_WIDTH, ServingScaleControl } from './ServingScaleControl.native.js';
import {
    formatQuantity,
    isLineNeedsReview,
    needsReviewNotice,
    rangeDerivedNotice,
    type RecipeDetailBodyProps,
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
export const RecipeDetailBody: FC<RecipeDetailBodyProps> = ({
    recipe,
    checkedIngredients,
    onToggleIngredient,
    checkedSteps,
    onToggleStep,
    onFilterByTag,
    footerActions,
    servings,
    onServingsChange,
}) => {
    const { list, detail } = useMessages(recipeMessages);
    const locale = useLocale();
    // Cuisine + dietary flags are descriptive pills; only `tags` are the search-filter chips (D6).
    const staticBadges = [...(recipe.cuisine ? [recipe.cuisine] : []), ...recipe.dietaryFlags];
    // R38 — see the web leaf: read from the STORED figure, not the scaled projection.
    const rangeNotice = rangeDerivedNotice(recipe.nutrition, {
        low: detail.nutritionRangeDerivedLow,
        high: detail.nutritionRangeDerivedHigh,
    });
    // ONE derivation, shared with the web leaf: quantities + prep scale, cook time and step timers do not.
    const scaled = scaleRecipeForServings(recipe, servings);
    // U14 — read from the STORED lines rather than the scaled projection, for the same reason `rangeNotice`
    // is: which lines the gate doubted is a fact about the recipe, not about the serving count on screen.
    const reviewNotice = needsReviewNotice(recipe.ingredients, detail);

    return (
        <View accessibilityLabel={recipe.title} style={styles.container}>
            {/* The mockup LEADS the detail with the cover hero, before any type. A recipe with no cover gets the
                hero's deliberate branded placeholder rather than nothing — see `RecipeHero.native`, which paints
                that placeholder COMPACT on a phone (its module doc carries the PLATFORM-FORK rationale). */}
            <RecipeHero title={recipe.title} coverPhotoUrl={recipe.coverPhotoUrl} />

            {/* U8: the header rides a beach-glow gradient title band (mockup recipe-detail). */}
            <GradientSurface gradient="hero" style={styles.titleBand}>
                <Text accessibilityRole="header" style={styles.title}>
                    {recipe.title}
                </Text>
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

            <PhotoCarousel photos={recipe.photos} title={recipe.title} />

            <Text accessibilityRole="header" style={styles.sectionHeading}>
                {detail.ingredientsHeading}
            </Text>
            <View style={styles.card}>
                {scaled.ingredients.map((ingredient) => {
                    const qty = formatQuantity(ingredient.quantity, locale, ingredient.unit);
                    const checked = checkedIngredients?.has(ingredient.ingredientId) ?? false;

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
                                accessibilityLabel={`${qty} ${ingredient.name}`.trim()}
                                onPress={() => onToggleIngredient?.(ingredient.ingredientId)}
                                style={styles.checkboxTouch}
                            >
                                <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                                    {checked && <Text style={styles.checkMark}>✓</Text>}
                                </View>
                            </Pressable>
                            <Text style={styles.ingredientQty}>{qty}</Text>
                            <Text style={styles.ingredientName}>{ingredient.name}</Text>
                            {ingredient.notes !== undefined && ingredient.notes.length > 0 && (
                                <Text style={styles.ingredientNotes}>{ingredient.notes}</Text>
                            )}
                            {ingredient.isUserEntered && (
                                <Text style={styles.userBadge}>{detail.userEnteredBadge}</Text>
                            )}
                            {/* U14 — the LINE the verification gate contradicted. Mirrors the web leaf: the
                                trailing slot, a WARNING tone rather than the neutral badge above, and no
                                accessibility role — the text is content of the row and is announced with it. */}
                            {isLineNeedsReview(ingredient) && (
                                <Text style={styles.needsReviewBadge}>{detail.needsReviewBadge}</Text>
                            )}
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
                                {step.timerSeconds !== undefined && (
                                    <Text style={styles.stepTimer}>
                                        {fillTemplate(detail.stepTimer, { seconds: step.timerSeconds })}
                                    </Text>
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
            {/* U14 — see the web leaf: a THIRD admission, and the only one that is our own doubt rather than a
                gap in the data.

                ⚠️ `role`, NOT `accessibilityRole`. React Native's `AccessibilityRole` union predates ARIA and
                has no `note` member, so `accessibilityRole="note"` does not type-check; the newer ARIA-shaped
                `role` prop does carry it, and RN maps it onto the platform role on device exactly as
                `accessibilityRole` would. Do not "fix" this back. */}
            {reviewNotice !== undefined && (
                <Text role="note" style={styles.reviewNotice}>
                    {reviewNotice}
                </Text>
            )}
            {hasUserEnteredIngredients(recipe.ingredients) && (
                <Text style={styles.sourceNote}>{detail.nutritionSourceNote}</Text>
            )}

            {/* C3 wireframe parity: the clone action (caller-supplied) + version + visibility badges are ONE
                grouped footer row — `[Clone to My Recipes] [v12] [Public]` — rather than three loose pieces. */}
            <View accessibilityLabel={detail.badgesLabel} style={styles.badgeRow}>
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
    sourceNote: { fontSize: nativeTokens.fontSize.overline, lineHeight: 16, color: palette.slate },
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
    ingredientRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: nativeTokens.spacing[1],
        paddingHorizontal: nativeTokens.spacing[2],
    },
    // 44pt tap target (RC-3) around the compact visible checkbox. `flexShrink: 0` protects that floor from
    // the row's own overflow: RN would otherwise be free to squeeze the target, not the text beside it.
    checkboxTouch: { flexShrink: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
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
    ingredientQty: { fontWeight: '600', color: palette.charcoal },
    // RN defaults `flexShrink` to 0, so without these the two USER-SUPPLIED values in this row took their full
    // intrinsic width and pushed the `Custom` badge (and the notes) past the card and screen edge — the same
    // failure that clipped `CollectionHeader.native.tsx`'s Rename and dropped its Delete out of the hierarchy.
    // The web leaf spells the pair `min-w-0 break-words` / `shrink-0`.
    ingredientName: { flexShrink: 1, color: palette.charcoal },
    ingredientNotes: { flexShrink: 1, fontSize: 13, color: palette.slate },
    userBadge: {
        flexShrink: 0,
        marginLeft: 'auto',
        fontSize: nativeTokens.fontSize.overline,
        color: palette.slate,
    },
    // U14 — the doubted line's badge. Same geometry as `userBadge` (both are trailing chips on the same row),
    // deliberately NOT merged with it: they are two different facts, and a shared style would make a tone
    // change to one silently change the other.
    //
    // ⛔ CHARCOAL on a `warning` TINT, never `warning` as the text colour. `colors.ts` is explicit that
    // `warning` (#F5B041) is a light fill that takes a charcoal label — as a foreground on a near-white
    // surface it is far under the 4.5:1 floor. The tint carries the caution; charcoal (10.31:1) carries the
    // words. The web leaf paints the identical pair.
    needsReviewBadge: {
        flexShrink: 0,
        marginLeft: 'auto',
        paddingHorizontal: nativeTokens.spacing[2],
        paddingVertical: 2,
        borderRadius: nativeTokens.radius.full,
        backgroundColor: tint(palette.warning, 0.25),
        fontSize: nativeTokens.fontSize.overline,
        fontWeight: '600',
        color: palette.charcoal,
    },
    // The recipe-level disclosure. `description`'s size, but charcoal and weighted rather than slate, so it
    // is distinguishable at a glance from the two neutral caveats above it — it is an admission a cook can
    // ACT on (re-pick the food), not a note that the data is thin.
    reviewNotice: {
        fontSize: nativeTokens.fontSize.bodySm,
        fontWeight: '600',
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
    stepTimer: { fontSize: 13, fontWeight: '500', color: palette['ocean-dark'] },
});
