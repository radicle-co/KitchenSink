'use client';

/**
 * The U13 batched AMBIGUITY REVIEW surface (web) — D7/R9's author affordance on recipe detail.
 *
 * ENTRY is the count notice + a disclosure toggle; DISMISSAL (closing it) is always safe because every
 * pick persists individually the moment it lands. One row per distinct PHRASE
 * ({@link ambiguityReviewGroups} — ⛔ one pick writes ONE correction and binds every sibling line, gap
 * 18); each row's shortlist is RE-DERIVED AT RENDER through the live blended suggest (gap 19) — never
 * the verdict's stored snapshot, so a stale pick against a dead id is structurally rare, and the one
 * that still fails server-side surfaces a per-row retryable error with the list refreshed underneath it
 * (the rest of the batch is untouched). The CLONE banner rides the same surface: a one-time,
 * dismissable sentence distinguishing "the original used the author's own foods" from ordinary
 * ambiguity — its lines are re-matched in the editor, not picked here.
 *
 * DESIGN PATTERN: platform leaf over shared pure models (`ambiguityReviewGroups`, `ambiguousNotice`,
 * `cloneUnboundBannerText`) + the shared correction controller — the `RecipeDetailBody` /
 * `needsReviewSurface` composition, extended.
 */
import { useMessages } from '@commise/i18n/react';
import { useSuggestIngredients } from '@kitchensink/recipe-service-client/hooks';
import type { RecipeIngredientView } from '@kitchensink/recipe-core';
import { useState, type FC, type JSX } from 'react';

import { useIngredientCorrection } from '../hooks/useIngredientCorrection.js';
import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import { ambiguityReviewGroups, ambiguousNotice, cloneUnboundBannerText } from './model.js';
import type { AmbiguityReviewGroup } from './model.js';

export interface AmbiguityReviewProps {
    /** The recipe's STORED ingredient lines (never the scaled projection). */
    readonly ingredients: readonly RecipeIngredientView[];
    /** The clone response's unbound count, when this detail arrived from a clone (plan U13, R20). */
    readonly cloneUnboundLineCount?: number;
}

/** One review row: a distinct ambiguous phrase, its fresh shortlist, and its own pick lifecycle. */
const AmbiguityReviewRow: FC<{ readonly group: AmbiguityReviewGroup }> = ({ group }): JSX.Element => {
    const { detail } = useMessages(recipeMessages);
    // Gap 19: the shortlist is RE-DERIVED at render through the live blended suggest — the stored verdict
    // shortlist is evidence about the past, and offering it would let a cook pick an id that no longer
    // resolves. The suggest's own cache/staleness rules apply; a failed pick refetches underneath.
    const search = useSuggestIngredients(group.phrase, undefined, { enabled: true });
    // ⛔ `recipe_line`: the closed wire enum's member for a correction born from a recipe line's review —
    // this surface reviews LINES, not picker searches.
    const correction = useIngredientCorrection('recipe_line');
    const [refreshed, setRefreshed] = useState(false);

    const foodBacked = (search.data?.suggestions ?? []).flatMap((suggestion) => {
        if (suggestion.provenance === 'catalog') {
            return [{ foodId: suggestion.foodId, name: suggestion.name }];
        }

        const foodId = suggestion.ingredient.foodId;

        return foodId === undefined ? [] : [{ foodId, name: suggestion.ingredient.name }];
    });

    const pick = (foodId: string): void => {
        setRefreshed(false);
        correction.correct(group.phrase, foodId);
    };

    return (
        <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
            <div className="flex items-baseline gap-2">
                <span className="text-body-sm font-semibold text-charcoal">{group.phrase}</span>
                {group.lineCount > 1 && (
                    <span className="text-caption text-slate">
                        {fillTemplate(detail.ambiguousReviewBindsMany, { count: group.lineCount })}
                    </span>
                )}
            </div>

            {search.isLoading && (
                <p role="status" className="text-body-sm text-slate">
                    {detail.ambiguousReviewLoading}
                </p>
            )}

            {refreshed && (
                <p role="status" className="text-caption text-slate">
                    {detail.ambiguousReviewRefreshed}
                </p>
            )}

            {correction.viewState.kind === 'saved' || correction.viewState.kind === 'unchanged' ? (
                <p role="status" className="text-body-sm text-ocean-dark">
                    {detail.ambiguousReviewSaved}
                </p>
            ) : (
                <ul className="flex flex-wrap gap-2">
                    {foodBacked.map((candidate) => (
                        <li key={candidate.foodId}>
                            <button
                                type="button"
                                onClick={() => pick(candidate.foodId)}
                                disabled={correction.isSaving}
                                aria-busy={correction.isSaving}
                                className="rounded-full bg-seafoam/10 px-3 py-1 text-body-sm text-ocean-dark transition hover:bg-seafoam/20 disabled:opacity-60"
                            >
                                {candidate.name}
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {correction.viewState.kind === 'failed' && (
                <div className="flex items-center gap-2">
                    {/* ⛔ Row-scoped: a failed write disturbs THIS row alone — the batch's other picks stand. */}
                    <p role="alert" className="text-body-sm text-error-dark">
                        {detail.ambiguousReviewFailed}
                    </p>
                    <button
                        type="button"
                        onClick={() => {
                            setRefreshed(true);
                            void search.refetch();
                        }}
                        className="rounded-full bg-seafoam/10 px-3 py-1 text-caption font-medium text-ocean-dark"
                    >
                        {detail.ambiguousReviewRetry}
                    </button>
                </div>
            )}
        </li>
    );
};

export const AmbiguityReview: FC<AmbiguityReviewProps> = ({
    ingredients,
    cloneUnboundLineCount,
}): JSX.Element | null => {
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
        <section aria-label={detail.ambiguousReviewHeading} className="flex flex-col gap-3">
            {banner !== undefined && !bannerDismissed && (
                <div className="flex items-start gap-3 rounded-xl bg-warning/15 p-3">
                    {/* R20's clone notice — its own sentence, because its fix (re-match in the editor) is not
                        this surface's pick affordance. One-time: dismissal is local and final for this view. */}
                    <p role="note" className="flex-1 text-body-sm text-charcoal">
                        {banner}
                    </p>
                    <button
                        type="button"
                        onClick={() => setBannerDismissed(true)}
                        className="shrink-0 rounded-full bg-card px-3 py-1 text-caption font-medium text-slate"
                    >
                        {detail.cloneUnboundDismiss}
                    </button>
                </div>
            )}

            {notice !== undefined && (
                <>
                    <button
                        type="button"
                        onClick={() => setOpen((value) => !value)}
                        aria-expanded={open}
                        aria-label={detail.ambiguousReviewToggle}
                        className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-left"
                    >
                        <span className="flex-1 text-body-sm font-medium text-charcoal">{notice}</span>
                        <span className="shrink-0 rounded-full bg-seafoam/10 px-3 py-1 text-caption font-semibold text-ocean-dark">
                            {detail.ambiguousReviewToggle}
                        </span>
                    </button>

                    {open && (
                        <ul className="flex flex-col gap-2">
                            {groups.map((group) => (
                                <AmbiguityReviewRow key={group.phrase} group={group} />
                            ))}
                        </ul>
                    )}
                </>
            )}
        </section>
    );
};
