/**
 * @module @commise/features-recipes — the native recipe-picker's settled body: the add outcome (a polite live region,
 * or an alert that does not hide the rows), then no recipes, no matches, or one row per candidate. A member or
 * in-flight row's control stays MOUNTED, carrying its inert state in its accessible NAME plus the `accessibilityState`
 * device trait (see the ⚠️ note at the control), with re-activation suppressed in the handler.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { styles } from './collectionRecipePickerStyles.native.js';
import { collectionMessages } from './messages.js';
import type { CollectionRecipePickerCandidatesProps } from './model.js';

/** The presentational settled picker body: the add outcome, then no recipes, no matches, or the candidate rows. */
export const CollectionRecipePickerCandidates: FC<CollectionRecipePickerCandidatesProps> = ({
    recipes,
    memberRecipeIds,
    query,
    pendingRecipeId,
    lastAddedRecipeId,
    addFailed = false,
    onAdd,
    onCreateRecipe,
}) => {
    const { picker } = useMessages(collectionMessages);
    const addedRecipe =
        lastAddedRecipeId !== undefined ? recipes.find((recipe) => recipe.id === lastAddedRecipeId) : undefined;

    return (
        <>
            {addFailed && (
                <View accessibilityRole="alert" style={styles.alert}>
                    <Text style={styles.alertLabel}>{picker.addFailed}</Text>
                </View>
            )}

            {addedRecipe !== undefined && (
                <View accessibilityLiveRegion="polite">
                    <Text style={styles.announcement}>
                        {fillTemplate(picker.addedAnnouncement, { title: addedRecipe.title })}
                    </Text>
                </View>
            )}

            <ScrollView>
                {recipes.length === 0 ? (
                    query.trim().length > 0 ? (
                        <View style={styles.stateCard}>
                            <Text style={styles.stateTitle}>{picker.noMatchesTitle}</Text>
                        </View>
                    ) : (
                        <View style={styles.stateCard}>
                            <Text style={styles.stateTitle}>{picker.emptyTitle}</Text>
                            <Text style={styles.stateBody}>{picker.emptyBody}</Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={picker.createRecipe}
                                onPress={onCreateRecipe}
                                style={styles.primaryButton}
                            >
                                <Text style={styles.primaryLabel}>{picker.createRecipe}</Text>
                            </Pressable>
                        </View>
                    )
                ) : (
                    <View style={styles.rows}>
                        {recipes.map((recipe) => {
                            const isMember = memberRecipeIds.includes(recipe.id);
                            const isPending = pendingRecipeId === recipe.id;
                            const inert = isMember || isPending;
                            const controlLabel = isMember
                                ? fillTemplate(picker.memberControlLabel, { title: recipe.title })
                                : fillTemplate(picker.addRecipe, { title: recipe.title });
                            const controlText = isMember ? picker.memberBadge : isPending ? picker.adding : picker.add;

                            return (
                                <View key={recipe.id} style={styles.row}>
                                    <Text style={styles.rowTitle}>{recipe.title}</Text>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={controlLabel}
                                        // ⚠️ DELIBERATE, and the ONE site in the #123 sweep that could NOT take an ARIA
                                        // sibling. Do not "fix" it with either obvious prop — both were tried and
                                        // measured against the installed react-native-web (0.20.0):
                                        //
                                        //   • `aria-disabled` is DISCARDED here. RNW's `Pressable` renders
                                        //     `<View {...rest} aria-disabled={disabled}>` — its own `disabled` prop
                                        //     OVERWRITES whatever the caller passed, and this control passes none, so
                                        //     the attribute never reaches the DOM. Measured: `<Pressable aria-disabled>`
                                        //     renders `<button role="button" tabindex="0">`, unmarked. A dead prop is
                                        //     worse than none — it reads as fixed.
                                        //   • the `disabled` PROP does reach the DOM, but RNW emits `aria-disabled` AND
                                        //     the native `disabled` attribute AND `tabIndex={-1}` together (measured),
                                        //     which is exactly what the web leaf REFUSES: a `disabled` button leaves the
                                        //     tab order, so a keyboard user who just added this recipe would be blurred
                                        //     and lose their place. RNW offers no focusable-but-inert button at all.
                                        //
                                        // So the web leaf's semantics are inexpressible here, and the state is carried
                                        // the one way that works on BOTH platforms: in the accessible NAME
                                        // (`memberControlLabel` — "{title} is in this collection"), plus the
                                        // `accessibilityState` device trait below, which RN itself honours even though
                                        // RNW drops it. Re-activation is suppressed in the handler, so the control
                                        // cannot merely LOOK inert. Residual, tracked: the PENDING row's name does not
                                        // say it is in flight ("Adding…" is sighted-only, since this label overrides the
                                        // text content) — closing that needs a new localized label on both leaves.
                                        accessibilityState={inert ? { disabled: true } : undefined}
                                        onPress={() => {
                                            if (!inert) {
                                                onAdd(recipe.id);
                                            }
                                        }}
                                        style={inert ? styles.inertControl : styles.addControl}
                                    >
                                        <Text style={inert ? styles.inertLabel : styles.addLabel}>{controlText}</Text>
                                    </Pressable>
                                </View>
                            );
                        })}
                    </View>
                )}
            </ScrollView>
        </>
    );
};
