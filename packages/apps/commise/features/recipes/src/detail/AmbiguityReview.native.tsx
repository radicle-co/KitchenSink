/**
 * The U13 batched AMBIGUITY REVIEW surface (native) — the web `AmbiguityReview.tsx`'s sibling, per the
 * cross-platform mandate. Same shared pure models, same correction controller, same live-suggest
 * re-derivation (gap 19), same per-row failure isolation; only the markup differs. See the web leaf's
 * module doc for the surface's whole rationale.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { useSuggestIngredients } from '@kitchensink/recipe-service-client/hooks';
import { useState, type FC, type JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useIngredientCorrection } from '../hooks/useIngredientCorrection.js';
import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import { ambiguityReviewGroups, ambiguousNotice, cloneUnboundBannerText } from './model.js';
import type { AmbiguityReviewGroup } from './model.js';
import type { AmbiguityReviewProps } from './AmbiguityReview.js';

/** One review row: a distinct ambiguous phrase, its fresh shortlist, and its own pick lifecycle. */
const AmbiguityReviewRow: FC<{ readonly group: AmbiguityReviewGroup }> = ({ group }): JSX.Element => {
    const { detail } = useMessages(recipeMessages);
    const search = useSuggestIngredients(group.phrase, undefined, { enabled: true });
    const correction = useIngredientCorrection('recipe_line');
    const [refreshed, setRefreshed] = useState(false);

    const foodBacked = (search.data?.suggestions ?? []).flatMap((suggestion) => {
        if (suggestion.provenance === 'catalog') {
            return [{ foodId: suggestion.foodId, name: suggestion.name }];
        }

        const foodId = suggestion.ingredient.foodId;

        return foodId === undefined ? [] : [{ foodId, name: suggestion.ingredient.name }];
    });

    const settled = correction.viewState.kind === 'saved' || correction.viewState.kind === 'unchanged';

    return (
        <View style={styles.row}>
            <View style={styles.rowHead}>
                <Text style={styles.rowPhrase}>{group.phrase}</Text>
                {group.lineCount > 1 && (
                    <Text style={styles.muted}>
                        {fillTemplate(detail.ambiguousReviewBindsMany, { count: group.lineCount })}
                    </Text>
                )}
            </View>

            {search.isLoading && <Text style={styles.muted}>{detail.ambiguousReviewLoading}</Text>}
            {refreshed && <Text style={styles.muted}>{detail.ambiguousReviewRefreshed}</Text>}

            {settled ? (
                <Text style={styles.saved}>{detail.ambiguousReviewSaved}</Text>
            ) : (
                <View style={styles.candidates}>
                    {foodBacked.map((candidate) => (
                        <Pressable
                            key={candidate.foodId}
                            accessibilityRole="button"
                            accessibilityLabel={candidate.name}
                            disabled={correction.isSaving}
                            onPress={() => {
                                setRefreshed(false);
                                correction.correct(group.phrase, candidate.foodId);
                            }}
                            style={[styles.candidate, correction.isSaving && styles.disabled]}
                        >
                            <Text style={styles.candidateLabel}>{candidate.name}</Text>
                        </Pressable>
                    ))}
                </View>
            )}

            {correction.viewState.kind === 'failed' && (
                <View style={styles.failedRow}>
                    {/* ⛔ Row-scoped: a failed write disturbs THIS row alone — the batch's other picks stand. */}
                    <Text accessibilityRole="alert" style={styles.error}>
                        {detail.ambiguousReviewFailed}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={detail.ambiguousReviewRetry}
                        onPress={() => {
                            setRefreshed(true);
                            void search.refetch();
                        }}
                        style={styles.candidate}
                    >
                        <Text style={styles.candidateLabel}>{detail.ambiguousReviewRetry}</Text>
                    </Pressable>
                </View>
            )}
        </View>
    );
};

export function AmbiguityReview({ ingredients, cloneUnboundLineCount }: AmbiguityReviewProps): JSX.Element | null {
    const { detail } = useMessages(recipeMessages);
    const [open, setOpen] = useState(false);
    const [bannerDismissed, setBannerDismissed] = useState(false);
    const groups = ambiguityReviewGroups(ingredients);
    const notice = ambiguousNotice(ingredients, detail);
    const banner = cloneUnboundBannerText(cloneUnboundLineCount, detail);

    if (notice === undefined && banner === undefined) {
        return null;
    }

    return (
        <View accessibilityLabel={detail.ambiguousReviewHeading} style={styles.section}>
            {banner !== undefined && !bannerDismissed && (
                <View style={styles.banner}>
                    <Text style={styles.bannerText}>{banner}</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={detail.cloneUnboundDismiss}
                        onPress={() => setBannerDismissed(true)}
                        style={styles.candidate}
                    >
                        <Text style={styles.candidateLabel}>{detail.cloneUnboundDismiss}</Text>
                    </Pressable>
                </View>
            )}

            {notice !== undefined && (
                <>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={detail.ambiguousReviewToggle}
                        onPress={() => setOpen((value) => !value)}
                        style={styles.entry}
                    >
                        <Text style={styles.entryText}>{notice}</Text>
                        <View style={styles.entryBadge}>
                            <Text style={styles.entryBadgeLabel}>{detail.ambiguousReviewToggle}</Text>
                        </View>
                    </Pressable>

                    {open && groups.map((group) => <AmbiguityReviewRow key={group.phrase} group={group} />)}
                </>
            )}
        </View>
    );
}

const border = 'rgba(178, 190, 195, 0.3)';

const styles = StyleSheet.create({
    section: { gap: 10 },
    banner: {
        backgroundColor: 'rgba(245, 176, 65, 0.15)',
        borderRadius: 12,
        flexDirection: 'row',
        gap: 10,
        padding: 12,
    },
    bannerText: { color: palette.charcoal, flex: 1, fontSize: 13 },
    entry: {
        alignItems: 'center',
        backgroundColor: palette.white,
        borderColor: border,
        borderRadius: 12,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 8,
        padding: 12,
    },
    entryText: { color: palette.charcoal, flex: 1, fontSize: 13, fontWeight: '500' },
    entryBadge: {
        backgroundColor: 'rgba(129, 236, 236, 0.12)',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    entryBadgeLabel: { color: palette['ocean-dark'], fontSize: 12, fontWeight: '600' },
    row: {
        backgroundColor: palette.white,
        borderColor: border,
        borderRadius: 10,
        borderWidth: 1,
        gap: 8,
        padding: 10,
    },
    rowHead: { alignItems: 'baseline', flexDirection: 'row', gap: 8 },
    rowPhrase: { color: palette.charcoal, fontSize: 13, fontWeight: '600' },
    candidates: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    candidate: {
        backgroundColor: 'rgba(129, 236, 236, 0.12)',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    candidateLabel: { color: palette['ocean-dark'], fontSize: 13 },
    disabled: { opacity: 0.6 },
    failedRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    muted: { color: palette.slate, fontSize: 12 },
    saved: { color: palette['ocean-dark'], fontSize: 13 },
    error: { color: palette['error-dark'], fontSize: 13 },
});
