/**
 * @module @commise/features-recipes — native recipe-detail view (T066 building block).
 *
 * The React Native leaf of {@link import('./RecipeDetailView.js').RecipeDetailView} — same read-only
 * contract and content sections, styled to the Commise design language (@commise/ui palette): a display
 * title, seafoam/coral tag pills, a stats strip, checklist ingredients, numbered seafoam step markers, and
 * a nutrition grid. Mirrors the web `RecipeDetailView`.
 *
 * U8 brand layer: the header sits in a {@link GradientSurface} title band, the display title threads the
 * Playfair `display` family, and the stat/ingredient/step cards carry tokenized elevation — so the native
 * detail reads as branded as the web leaf.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette, tint } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { GradientSurface } from '@commise/ui/surface';
import { hasUserEnteredIngredients, RecipeVisibility } from '@kitchensink/recipe-core';
import type { FC, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { fillTemplate, formatDurationMinutes } from '../list/model.js';
import { PhotoCarousel } from './PhotoCarousel.native.js';
import { RecipeHero } from './RecipeHero.native.js';
import { formatQuantity, type RecipeDetailViewProps } from './model.js';

/** One label/value cell in the stats or nutrition strip. */
const Stat: FC<{ label: string; value: ReactNode }> = ({ label, value }) => (
    <View style={styles.statCell}>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
    </View>
);

export const RecipeDetailView: FC<RecipeDetailViewProps> = ({
    recipe,
    checkedIngredients,
    onToggleIngredient,
    checkedSteps,
    onToggleStep,
    onFilterByTag,
    footerActions,
}) => {
    const { list, detail } = useMessages(recipeMessages);
    const locale = useLocale();
    // Cuisine + dietary flags are descriptive pills; only `tags` are the search-filter chips (D6).
    const staticBadges = [...(recipe.cuisine ? [recipe.cuisine] : []), ...recipe.dietaryFlags];

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

            {/* C2 wireframe parity: Serves leads the strip, then Prep, Cook, Total. */}
            <View style={styles.statStrip}>
                <Stat label={detail.servingsLabel} value={String(recipe.servings)} />
                <Stat
                    label={detail.prepLabel}
                    value={formatDurationMinutes(recipe.prepTimeMinutes, list.durationMinutes)}
                />
                <Stat
                    label={detail.cookLabel}
                    value={formatDurationMinutes(recipe.cookTimeMinutes, list.durationMinutes)}
                />
                <Stat
                    label={detail.totalLabel}
                    value={formatDurationMinutes(recipe.totalTimeMinutes, list.durationMinutes)}
                />
            </View>

            <PhotoCarousel photos={recipe.photos} title={recipe.title} />

            <Text accessibilityRole="header" style={styles.sectionHeading}>
                {detail.ingredientsHeading}
            </Text>
            <View style={styles.card}>
                {recipe.ingredients.map((ingredient) => {
                    const qty = formatQuantity(ingredient.quantity, locale, ingredient.unit);
                    const checked = checkedIngredients?.has(ingredient.ingredientId) ?? false;

                    return (
                        <View key={ingredient.ingredientId} style={styles.ingredientRow}>
                            {/* The tap target is a 44pt wrapper (RC-3); the visible checkbox stays a compact
                                18px box centered inside it, so the checklist reads tight but taps large. */}
                            <Pressable
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked }}
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
                                accessibilityState={{ checked: done }}
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
    statStrip: {
        flexDirection: 'row',
        backgroundColor: palette.white,
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        paddingVertical: nativeTokens.spacing[4],
        // U8 brand leaf: tokenized card elevation (was flat, border-only).
        ...nativeTokens.elevation.sm,
    },
    statCell: { flex: 1, alignItems: 'center', gap: nativeTokens.spacing[1] },
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
