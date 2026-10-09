'use client';

/**
 * The U13 AMBIGUITY REVIEW surface (web) — D7/R9's author affordance on recipe detail — and the one-time CLONE banner.
 *
 * ENTRY is the count notice + a disclosure toggle; DISMISSAL (closing it) is always safe, because each pick is its own
 * write. One row per AMBIGUOUS LINE ({@link ambiguityReviewLines}), and a pick re-points THAT line alone, through the
 * rebind command, as the editor's row 7 does for a stored line (`useAmbiguityPick`). Each row's shortlist, sentences and
 * pick are `useAmbiguityReviewRow`'s. The row's status line sits after its chips and speaks once, at the end of the
 * answer.
 *
 * A taken pick's line is no longer ambiguous, so its row leaves the review. The surface then says the pick saved, in a
 * status line that takes focus from the row that went (WCAG 2.2 SC 2.4.3) and stays after the last row has gone.
 *
 * Only the OWNER is offered picks: the rebind is owner-checked, so anyone else's pick could only fail. The clone banner
 * is not a review and has no pick; it shows to whoever the clone response reached.
 *
 * ORCHESTRATION: the exported component selects the owner's review or the banner alone, by `viewerIsOwner`. The
 * owner's review holds the pick command, and each row its own state (`useAmbiguityReviewRow`).
 *
 * DESIGN PATTERN: platform leaf over shared pure models (`ambiguityReviewLines`, `ambiguousNotice`,
 * `clonePrivateFoodsBannerText`), the shared pick controller and the shared row hook — the `RecipeDetailBody` /
 * `needsReviewSurface` composition, extended.
 *
 * @pattern Command — each pick is one rebind (`useAmbiguityPick`), serialised across rows because every pick edits the
 *     same recipe version
 */
import { BUSY_CONTROL_CLASS, busyControlProps } from '@commise/ui/button';
import { useFocusOnSignal } from '@commise/ui/dialog-focus';
import { useMessages } from '@commise/i18n/react';
import { LiveRegion } from '@commise/ui/live-region';
import type { RecipeDetail } from '@kitchensink/recipe-core';
import { useId, useState, type FC, type JSX } from 'react';

import { useAmbiguityPick, type AmbiguityPickController } from '../hooks/useAmbiguityPick.js';
import { recipeMessages } from '../messages.js';
import {
    ambiguityReviewLines,
    ambiguousNotice,
    clonePrivateFoodsBannerText,
    reviewRowsGone,
    type AmbiguityReviewLine,
} from './model.js';
import { useAmbiguityReviewRow } from './useAmbiguityReviewRow.js';

export interface AmbiguityReviewProps {
    /** The recipe as read: its id, the version a pick edits, its STORED lines (never the scaled projection). */
    readonly recipe: Pick<RecipeDetail, 'id' | 'currentVersion' | 'ingredients' | 'clonePrivateFoodLineCount'>;
    /** Whether the viewer owns the recipe (`RecipeDetailViewProps.viewerIsOwner`): only the owner is offered picks. */
    readonly viewerIsOwner: boolean;
}

/** The clone notice: its own sentence, because a private food is not ambiguity and has no pick here. */
const ClonePrivateFoodsBanner: FC<{ readonly text: string }> = ({ text }): JSX.Element | null => {
    const { detail } = useMessages(recipeMessages);
    // One-time: dismissal is local and final for this view.
    const [dismissed, setDismissed] = useState(false);

    if (dismissed) {
        return null;
    }

    return (
        <div className="flex items-start gap-3 rounded-xl bg-attention-tint p-3">
            <p role="note" className="flex-1 text-body-sm text-ink">
                {text}
            </p>
            <button
                type="button"
                onClick={() => setDismissed(true)}
                className="shrink-0 rounded-full bg-paper px-3 py-1 text-caption font-medium text-ink-muted"
            >
                {detail.clonePrivateFoodsDismiss}
            </button>
        </div>
    );
};

/** One review row: one ambiguous line, its fresh shortlist (`useAmbiguityReviewRow`), and its pick's failure. */
const AmbiguityReviewRow: FC<{ readonly review: AmbiguityReviewLine; readonly picker: AmbiguityPickController }> = ({
    review,
    picker,
}): JSX.Element => {
    const { detail } = useMessages(recipeMessages);
    const row = useAmbiguityReviewRow(review, picker);
    const nameId = useId();

    return (
        <li className="rounded-lg border border-line-divider bg-paper p-3">
            {/* Named by the line's summary (`AmbiguityReviewRowModel.summary`). */}
            <div role="group" aria-labelledby={nameId} className="flex flex-col gap-2">
                <span id={nameId} className="text-body-sm font-semibold text-ink">
                    {row.summary}
                </span>

                {row.groups.map((group) => (
                    <div key={group.key} className="flex flex-col gap-1">
                        {group.label !== undefined && (
                            <p aria-hidden className="text-caption font-semibold text-ink-muted">
                                {group.label}
                            </p>
                        )}
                        <ul aria-label={group.label} className="flex flex-wrap gap-2">
                            {group.candidates.map((candidate) => (
                                <li key={candidate.key}>
                                    <button
                                        type="button"
                                        aria-label={candidate.accessibleName}
                                        {...busyControlProps({
                                            busy: picker.picking,
                                            onClick: () => row.onPick(candidate.pick),
                                        })}
                                        className={`rounded-full bg-action/10 px-3 py-1 text-body-sm text-action-text transition hover:bg-action/20 ${BUSY_CONTROL_CLASS}`}
                                    >
                                        {candidate.name}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}

                {/* Shown, not live: the busy chips say it to assistive technology (V3-9). */}
                {row.adding !== undefined && <p className="text-caption text-ink-muted">{row.adding}</p>}

                {/* Mounted while empty, so each change of the sentence is spoken (WCAG 4.1.3); after the chips, so a
                    sentence that empties at the end moves none of them (P12). */}
                <p role="status" className={row.status === '' ? 'sr-only' : 'text-body-sm text-ink-muted'}>
                    {row.status}
                </p>

                {row.refreshed && (
                    <p role="status" className="text-caption text-ink-muted">
                        {detail.ambiguousReviewRefreshed}
                    </p>
                )}

                {/* ⛔ Row-scoped: a refused pick disturbs THIS row alone — the other lines' rows stand. Said again at each
                    press the cook's limit refuses (R8). */}
                <LiveRegion
                    politeness="assertive"
                    occurrence={picker.limitRefusals}
                    className="text-body-sm text-danger-text"
                >
                    {row.alert}
                </LiveRegion>

                {row.offersRetry && (
                    <button
                        type="button"
                        aria-label={row.retryLabel}
                        onClick={row.onRetry}
                        className="self-start rounded-full bg-action/10 px-3 py-1 text-caption font-medium text-action-text"
                    >
                        {detail.ambiguousReviewRetry}
                    </button>
                )}
            </div>
        </li>
    );
};

/** The owner's review: the entry, a row per ambiguous line, the pick command, and the banner when there is one. */
const OwnerAmbiguityReview: FC<Pick<AmbiguityReviewProps, 'recipe'>> = ({ recipe }): JSX.Element | null => {
    const { detail } = useMessages(recipeMessages);
    const picker = useAmbiguityPick(recipe);
    const [open, setOpen] = useState(false);
    const lines = ambiguityReviewLines(recipe.ingredients);
    const savedRef = useFocusOnSignal<HTMLParagraphElement>(reviewRowsGone(picker.saves, picker.takenAt, lines));
    const notice = ambiguousNotice(recipe.ingredients, detail);
    const banner = clonePrivateFoodsBannerText(recipe.clonePrivateFoodLineCount, detail);
    // A pick in flight or taken keeps the review, so its sentence, and the focus it takes, outlive the last row.
    const reviewing = notice !== undefined || picker.picking || picker.takenAt !== undefined;

    if (!reviewing && banner === undefined) {
        return null;
    }

    return (
        // Named for the review only when there is one: a clone banner on its own is not a review (WCAG 2.4.6).
        <section
            {...(reviewing ? { 'aria-label': detail.ambiguousReviewHeading } : {})}
            className="flex flex-col gap-3"
        >
            {banner !== undefined && <ClonePrivateFoodsBanner text={banner} />}

            {notice !== undefined && (
                <>
                    <button
                        type="button"
                        onClick={() => setOpen((value) => !value)}
                        aria-expanded={open}
                        aria-label={detail.ambiguousReviewToggle}
                        className="flex items-center gap-2 rounded-xl border border-line-divider bg-paper p-3 text-left"
                    >
                        <span className="flex-1 text-body-sm font-medium text-ink">{notice}</span>
                        <span className="shrink-0 rounded-full bg-action/10 px-3 py-1 text-caption font-semibold text-action-text">
                            {detail.ambiguousReviewToggle}
                        </span>
                    </button>

                    {open && (
                        <ul className="flex flex-col gap-2">
                            {lines.map((review) => (
                                <AmbiguityReviewRow key={review.position} review={review} picker={picker} />
                            ))}
                        </ul>
                    )}
                </>
            )}

            {/* Mounted while the review is, so the sentence is spoken when it changes (WCAG 4.1.3); focusable, so focus
                lands here when the row a pick was made on has gone (WCAG 2.2 SC 2.4.3). */}
            {reviewing && (
                <p
                    ref={savedRef}
                    role="status"
                    tabIndex={-1}
                    className={picker.takenAt !== undefined ? 'text-body-sm text-action-text' : 'sr-only'}
                >
                    {picker.takenAt !== undefined ? detail.ambiguousReviewSaved : ''}
                </p>
            )}
        </section>
    );
};

/** The ambiguity review and the clone banner for the recipe's owner; the clone banner alone for anyone else. */
export const AmbiguityReview: FC<AmbiguityReviewProps> = ({ recipe, viewerIsOwner }): JSX.Element | null => {
    const { detail } = useMessages(recipeMessages);

    if (viewerIsOwner) {
        return <OwnerAmbiguityReview recipe={recipe} />;
    }

    const banner = clonePrivateFoodsBannerText(recipe.clonePrivateFoodLineCount, detail);

    return banner === undefined ? null : (
        <section className="flex flex-col gap-3">
            <ClonePrivateFoodsBanner text={banner} />
        </section>
    );
};
