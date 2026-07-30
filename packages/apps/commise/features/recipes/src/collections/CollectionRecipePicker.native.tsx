/**
 * @module @commise/features-recipes — native collection recipe-picker (the ADD half of T072 / FR-009).
 *
 * The React Native leaf of {@link import('./CollectionRecipePicker.js').CollectionRecipePicker} — same
 * controlled, presentational contract: it lists the caller's OWN recipes and adds them, one at a time, to a
 * single named collection, fetching nothing. Multi-membership is expressed per row (membership scoped to THIS
 * collection); a member or in-flight row's control stays MOUNTED and focusable, carrying its inert state in its
 * accessible NAME plus the `accessibilityState` device trait — never the `disabled` prop, which would drop it out
 * of the tab order (see the ⚠️ note at the control) — with re-activation suppressed in the handler so it cannot
 * merely look inert. A successful add
 * is surfaced through a polite live region; an add failure is an alert that does not hide the rows.
 */
import { useMessages } from '@commise/i18n/react';
import { palette, tint } from '@commise/ui';
import type { FC, ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { collectionMessages } from './messages.js';
import type { CollectionRecipePickerProps } from './model.js';

export const CollectionRecipePicker: FC<CollectionRecipePickerProps> = ({
    collectionName,
    status,
    recipes,
    memberRecipeIds,
    query,
    pendingRecipeId,
    lastAddedRecipeId,
    addFailed = false,
    onQueryChange,
    onAdd,
    onRetry,
    onCreateRecipe,
    onDone,
}) => {
    const { picker } = useMessages(collectionMessages);
    const heading = fillTemplate(picker.heading, { name: collectionName });
    const addedRecipe =
        lastAddedRecipeId !== undefined ? recipes.find((recipe) => recipe.id === lastAddedRecipeId) : undefined;

    let body: ReactElement;

    if (status === 'loading') {
        body = <View accessibilityLabel={picker.loadingLabel} style={styles.stateCard} />;
    } else if (status === 'error') {
        body = (
            <View accessibilityRole="alert" style={styles.stateCard}>
                <Text style={styles.stateTitle}>{picker.errorTitle}</Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={picker.retry}
                    onPress={onRetry}
                    style={styles.textButton}
                >
                    <Text style={styles.linkLabel}>{picker.retry}</Text>
                </Pressable>
            </View>
        );
    } else if (recipes.length === 0) {
        body =
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
            );
    } else {
        body = (
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
        );
    }

    return (
        <View accessibilityLabel={heading} style={styles.container}>
            <View style={styles.headerRow}>
                <Text accessibilityRole="header" style={styles.heading}>
                    {heading}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={picker.done}
                    onPress={onDone}
                    style={styles.textButton}
                >
                    <Text style={styles.linkLabel}>{picker.done}</Text>
                </Pressable>
            </View>

            <TextInput
                accessibilityLabel={picker.searchLabel}
                placeholder={picker.searchPlaceholder}
                // Placeholder text is TEXT, so it takes `slate`, never the `mist` hairline tone — see the
                // palette JSDoc in `@commise/ui`'s `tokens/colors.ts`.
                placeholderTextColor={palette.slate}
                value={query}
                onChangeText={onQueryChange}
                style={styles.input}
            />

            {addFailed && status === 'ready' && (
                <View accessibilityRole="alert" style={styles.alert}>
                    <Text style={styles.alertLabel}>{picker.addFailed}</Text>
                </View>
            )}

            {status === 'ready' && addedRecipe !== undefined && (
                <View accessibilityLiveRegion="polite">
                    <Text style={styles.announcement}>
                        {fillTemplate(picker.addedAnnouncement, { title: addedRecipe.title })}
                    </Text>
                </View>
            )}

            <ScrollView>{body}</ScrollView>
        </View>
    );
};

const border = 'rgba(178, 190, 195, 0.3)';

const styles = StyleSheet.create({
    container: { flex: 1, gap: 12, paddingHorizontal: 16, paddingTop: 8 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: { fontSize: 24, fontWeight: '700', color: palette.charcoal, flexShrink: 1 },
    textButton: { paddingVertical: 6, paddingHorizontal: 10 },
    // `ocean-dark`, not `seafoam`: this style paints BOTH bare text controls (Done, Try again), and seafoam as
    // a text foreground is 4.02:1 on white — under the 4.5:1 body-text floor. The seafoam FILLS below stay.
    linkLabel: { color: palette['ocean-dark'], fontWeight: '600', fontSize: 14 },
    input: {
        borderRadius: 10,
        borderWidth: 1,
        borderColor: border,
        paddingVertical: 10,
        paddingHorizontal: 12,
        fontSize: 16,
        color: palette.charcoal,
    },
    // 10%-alpha tint of `palette.error` (#C05238 → rgb(192, 82, 56)) — mirrors the web leaf's `bg-error/10`;
    // RN has no alpha-suffix colour syntax, so it is spelled out here. It previously spelled out
    // `rgba(232, 145, 122, 0.1)`, which is `palette.coral` (#E8917A) — a brand ACCENT filling an alert whose
    // own text is `palette['error-dark']`. Because the literal is opaque to a `palette.coral` grep, the test asserts
    // it against a tint DERIVED from the token (`tintOf(palette.error, 0.1)`) rather than a second literal.
    alert: { backgroundColor: tint(palette.error, 0.1), borderRadius: 10, padding: 12 },
    alertLabel: { color: palette['error-dark'], fontSize: 14 },
    announcement: { color: palette.slate, fontSize: 14 },
    stateCard: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        padding: 16,
        gap: 6,
    },
    stateTitle: { fontSize: 15, fontWeight: '600', color: palette.charcoal },
    stateBody: { fontSize: 14, color: palette.slate },
    rows: { gap: 12, paddingBottom: 16 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        padding: 14,
    },
    rowTitle: { fontSize: 16, fontWeight: '600', color: palette.charcoal, flexShrink: 1 },
    addControl: { backgroundColor: palette.seafoam, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
    addLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
    inertControl: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 },
    inertLabel: { color: palette.slate, fontWeight: '500', fontSize: 14 },
    primaryButton: {
        backgroundColor: palette.seafoam,
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 18,
        alignSelf: 'flex-start',
        marginTop: 4,
    },
    primaryLabel: { color: palette.white, fontWeight: '600', fontSize: 14 },
});
