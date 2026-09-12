/**
 * The U13 AMBIGUITY REVIEW surface (native) — the web `AmbiguityReview.tsx`'s sibling, per the cross-platform mandate.
 * Same shared pure models, same pick controller (`useAmbiguityPick`), same row hook (`useAmbiguityReviewRow`), same
 * owner gate; only the markup differs: a source's chips sit under header text naming it (P10), and a taken pick moves
 * the screen-reader cursor rather than keyboard focus.
 *
 * ORCHESTRATION: the exported component selects the owner's review or the banner alone, by `viewerIsOwner`.
 *
 * @pattern Command — each pick is one rebind (`useAmbiguityPick`), serialised across rows because every pick edits the
 *     same recipe version
 */
import { useMessages } from '@commise/i18n/react';
import { palette, tint } from '@commise/ui';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { useState, type FC, type JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAmbiguityPick, type AmbiguityPickController } from '../hooks/useAmbiguityPick.js';
import { recipeMessages } from '../messages.js';
import {
    ambiguityReviewLines,
    ambiguousNotice,
    clonePrivateFoodsBannerText,
    type AmbiguityReviewLine,
} from './model.js';
import type { AmbiguityReviewProps } from './AmbiguityReview.js';
import { useAmbiguityReviewRow } from './useAmbiguityReviewRow.js';

/** The clone notice: its own sentence, because a private food is not ambiguity and has no pick here. */
const ClonePrivateFoodsBanner: FC<{ readonly text: string }> = ({ text }): JSX.Element | null => {
    const { detail } = useMessages(recipeMessages);
    // One-time: dismissal is local and final for this view.
    const [dismissed, setDismissed] = useState(false);

    if (dismissed) {
        return null;
    }

    return (
        <View style={styles.banner}>
            <Text style={styles.bannerText}>{text}</Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={detail.clonePrivateFoodsDismiss}
                onPress={() => setDismissed(true)}
                style={styles.candidate}
            >
                <Text style={styles.candidateLabel}>{detail.clonePrivateFoodsDismiss}</Text>
            </Pressable>
        </View>
    );
};

/** One review row: one ambiguous line, its fresh shortlist (`useAmbiguityReviewRow`), and its pick's failure. */
const AmbiguityReviewRow: FC<{ readonly review: AmbiguityReviewLine; readonly picker: AmbiguityPickController }> = ({
    review,
    picker,
}): JSX.Element => {
    const { detail } = useMessages(recipeMessages);
    const row = useAmbiguityReviewRow(review, picker);

    return (
        // Named by the line's summary, its header (`AmbiguityReviewRowModel.summary`; `nativeContainerNames.md` N1).
        <View style={styles.row}>
            <Text accessibilityRole="header" style={styles.rowPhrase}>
                {row.summary}
            </Text>

            {row.groups.map((group) => (
                <View key={group.key}>
                    {group.label !== undefined && (
                        <Text accessibilityRole="header" style={styles.muted}>
                            {group.label}
                        </Text>
                    )}
                    <View style={styles.candidates}>
                        {group.candidates.map((candidate) => (
                            <Pressable
                                key={candidate.key}
                                accessibilityRole="button"
                                accessibilityLabel={candidate.accessibleName ?? candidate.name}
                                disabled={picker.picking}
                                onPress={() => row.onPick(candidate.pick)}
                                style={[styles.candidate, picker.picking && styles.disabled]}
                            >
                                <Text style={styles.candidateLabel}>{candidate.name}</Text>
                            </Pressable>
                        ))}
                    </View>
                </View>
            ))}

            {/* Shown, not live: the busy chips say it to the screen reader (V3-9). */}
            {row.adding !== undefined && <Text style={styles.muted}>{row.adding}</Text>}

            {/* Mounted while empty, so each change of the sentence is spoken (`LiveRegion`, WCAG 4.1.3); after the
                chips, so a sentence that empties at the end moves none of them (P12). */}
            <LiveRegion politeness="polite" style={styles.muted}>
                {row.status}
            </LiveRegion>
            {row.refreshed && <Text style={styles.muted}>{detail.ambiguousReviewRefreshed}</Text>}

            {/* ⛔ Row-scoped: a refused pick disturbs THIS row alone. Said again at each press the limit refuses (R8). */}
            <LiveRegion politeness="assertive" occurrence={picker.limitRefusals} style={styles.error}>
                {row.alert}
            </LiveRegion>

            {row.offersRetry && (
                <View style={styles.failedRow}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={row.retryLabel}
                        onPress={row.onRetry}
                        style={styles.candidate}
                    >
                        <Text style={styles.candidateLabel}>{detail.ambiguousReviewRetry}</Text>
                    </Pressable>
                </View>
            )}
        </View>
    );
};

/** The owner's review: the entry, a row per ambiguous line, the pick command, and the banner when there is one. */
const OwnerAmbiguityReview: FC<Pick<AmbiguityReviewProps, 'recipe'>> = ({ recipe }): JSX.Element | null => {
    const { detail } = useMessages(recipeMessages);
    const picker = useAmbiguityPick(recipe);
    const [open, setOpen] = useState(false);
    const lines = ambiguityReviewLines(recipe.ingredients);
    // Every taken pick sends the reading cursor to the saved sentence: React Native cannot tell whether the cursor was
    // on the row that went, so it does not wait for the row as the web leaf does (`reviewRowsGone`).
    const savedRef = useScreenReaderFocusOnSignal<Text>(picker.saves);
    const notice = ambiguousNotice(recipe.ingredients, detail);
    const banner = clonePrivateFoodsBannerText(recipe.clonePrivateFoodLineCount, detail);
    // A pick in flight or taken keeps the review, so its sentence, and the cursor it takes, outlive the last row.
    const reviewing = notice !== undefined || picker.picking || picker.takenAt !== undefined;

    if (!reviewing && banner === undefined) {
        return null;
    }

    return (
        <View style={styles.section}>
            {banner !== undefined && <ClonePrivateFoodsBanner text={banner} />}

            {notice !== undefined && (
                <>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={detail.ambiguousReviewToggle}
                        accessibilityState={{ expanded: open }}
                        aria-expanded={open}
                        onPress={() => setOpen((value) => !value)}
                        style={styles.entry}
                    >
                        <Text style={styles.entryText}>{notice}</Text>
                        <View style={styles.entryBadge}>
                            <Text style={styles.entryBadgeLabel}>{detail.ambiguousReviewToggle}</Text>
                        </View>
                    </Pressable>

                    {open &&
                        lines.map((review) => (
                            <AmbiguityReviewRow key={review.position} review={review} picker={picker} />
                        ))}
                </>
            )}

            {/* The reading cursor is sent here each time a pick is taken, which reads it; a live region as well would
                say it twice. */}
            {picker.takenAt !== undefined && (
                <Text ref={savedRef} style={styles.saved}>
                    {detail.ambiguousReviewSaved}
                </Text>
            )}
        </View>
    );
};

/** The ambiguity review and the clone banner for the recipe's owner; the clone banner alone for anyone else. */
export function AmbiguityReview({ recipe, viewerIsOwner }: AmbiguityReviewProps): JSX.Element | null {
    const { detail } = useMessages(recipeMessages);

    if (viewerIsOwner) {
        return <OwnerAmbiguityReview recipe={recipe} />;
    }

    const banner = clonePrivateFoodsBannerText(recipe.clonePrivateFoodLineCount, detail);

    return banner === undefined ? null : (
        <View style={styles.section}>
            <ClonePrivateFoodsBanner text={banner} />
        </View>
    );
}

const border = 'rgba(178, 190, 195, 0.3)';

/** The native target floor the spec sets (2.5.8: 48 × 48 dp), as `@commise/ui`'s own controls take it. */
const TARGET_DP = 48;

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
        backgroundColor: tint(palette.seafoam, 0.1),
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
    rowPhrase: { color: palette.charcoal, fontSize: 13, fontWeight: '600' },
    candidates: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    candidate: {
        backgroundColor: tint(palette.seafoam, 0.1),
        borderRadius: nativeTokens.radius.full,
        justifyContent: 'center',
        minHeight: TARGET_DP,
        paddingHorizontal: nativeTokens.spacing[3],
    },
    candidateLabel: { color: palette['ocean-dark'], fontSize: nativeTokens.fontSize.bodySm },
    disabled: { opacity: 0.6 },
    failedRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    muted: { color: palette.slate, fontSize: 12 },
    saved: { color: palette['ocean-dark'], fontSize: 13 },
    error: { color: palette['error-dark'], fontSize: 13 },
});
