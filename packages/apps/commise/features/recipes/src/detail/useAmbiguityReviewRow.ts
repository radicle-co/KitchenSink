/**
 * @module @commise/features-recipes/detail — one ambiguity review row's state, shared by the web and native
 * `AmbiguityReview` leaves (U13).
 *
 * The row's shortlist is RE-DERIVED at render through the progressive food search (gap 19;
 * `useIngredientSuggestionSource`): the stored verdict shortlist is evidence about the past, and offering it would let
 * a cook pick an id that no longer resolves. Our database's foods come first, then each remote source's under
 * `From {source}` (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P12). A pick re-points THIS line alone
 * through the review's pick controller (owner ruling 2026-10-02, "Fix one line at a time"); a pick that re-points
 * nothing is said on its row in P8's words, retryable, and a remote pick in flight says where its food is coming from
 * (V3-9).
 *
 * @pattern Headless hook — the row's search, list, sentences and pick, which each leaf draws
 */
import { offlineNoticeMessages } from '@commise/features-core/offline';
import { useLocale, useMessages } from '@commise/i18n/react';
import { meetsSearchMinimum } from '@kitchensink/recipe-core/resolution/search-minimum';
import { useState } from 'react';

import { recipeFormMessages } from '../form/messages.js';
import { remotePickFailureOf, type RemotePickCopy, type SourceNaming } from '../form/progressiveNotes.js';
import { rowBusyText } from '../form/rowCommitMessage.js';
import { entrySearchViewOf } from '../hooks/foodSuggestions.model.js';
import { useIngredientSuggestionSource } from '../hooks/ingredientSuggestionSource.js';
import type { AmbiguityPickController, ReviewPickFailure } from '../hooks/useAmbiguityPick.js';
import { useSourceNaming } from '../hooks/useSourceNaming.js';
import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import {
    lineSummary,
    reviewShortlistOf,
    reviewShortlistStatus,
    type AmbiguityReviewLine,
    type ReviewGroup,
    type ReviewPick,
} from './model.js';

/** What a review row's leaf draws and wires. */
export interface AmbiguityReviewRowModel {
    /** The line, amount and all, so two lines with the same food name are told apart (WCAG 1.3.1). */
    readonly summary: string;
    readonly groups: readonly ReviewGroup[];
    /** The polite line after the chips: what the list could not show, said once at the end of its answer (P12). */
    readonly status: string;
    /** A pick on THIS row that re-pointed nothing, said assertively; `''` otherwise. */
    readonly alert: string;
    /** What a remote pick on this row is adding, and from where (V3-9); `undefined` otherwise. */
    readonly adding: string | undefined;
    /** Try again, after this row's failure, asked the list again. */
    readonly refreshed: boolean;
    /** Try again is offered: after this row's failure, or a search that failed (P12 defect (b)). */
    readonly offersRetry: boolean;
    /** Try again's accessible name, which names the line's words. */
    readonly retryLabel: string;
    readonly onPick: (pick: ReviewPick) => void;
    readonly onRetry: () => void;
}

/** The copy a row's failure reads: P8's remote sentences, and the review's own failure. */
interface RowAlertCopy extends RemotePickCopy {
    readonly failed: string;
}

/**
 * What a failed pick says on its row: a remote pick's P8 sentence, or the review's own failure. Pure.
 *
 * @param failure - This row's failed pick, if any.
 * @param naming - How the review names a source and says a time.
 * @param copy - The localised copy.
 * @returns The sentence, or `''`.
 */
const rowAlertOf = (failure: ReviewPickFailure | undefined, naming: SourceNaming, copy: RowAlertCopy): string => {
    if (failure === undefined) {
        return '';
    }

    if (failure.pick.kind !== 'remoteFood') {
        return copy.failed;
    }

    return remotePickFailureOf(failure.pick, failure.outcome, naming, copy) ?? '';
};

/**
 * One review row: its fresh shortlist, its sentences, and its pick.
 *
 * @param review - The ambiguous line.
 * @param picker - The review's pick controller.
 * @returns The row's state and handlers.
 * @sideEffect Reads the progressive food search, and re-points the line through `picker`.
 */
export function useAmbiguityReviewRow(
    review: AmbiguityReviewLine,
    picker: AmbiguityPickController,
): AmbiguityReviewRowModel {
    const shared = useMessages(recipeMessages);
    const { detail } = shared;
    const form = useMessages(recipeFormMessages);
    const { readOffline } = useMessages(offlineNoticeMessages);
    const locale = useLocale();
    const naming = useSourceNaming();
    const phrase = review.name.trim();
    const search = useIngredientSuggestionSource(phrase, meetsSearchMinimum(phrase), picker.holdLimit);
    const [refreshed, setRefreshed] = useState(false);
    const shortlist = reviewShortlistOf(
        entrySearchViewOf({ trimmed: phrase, debouncedTrimmed: phrase, read: search.read }),
        naming,
        { remote: shared.ingredientRemoteSearch },
    );
    const failure = picker.failure?.position === review.position ? picker.failure : undefined;
    const adding = picker.adding?.position === review.position ? picker.adding.pick : undefined;

    return {
        summary: lineSummary(review.line, locale, shared.ingredientLineName),
        groups: shortlist.kind === 'listed' ? shortlist.groups : [],
        status: reviewShortlistStatus(shortlist, naming, {
            loading: detail.ambiguousReviewLoading,
            offline: readOffline,
            form,
            remote: shared.ingredientRemoteSearch,
        }),
        alert: rowAlertOf(failure, naming, {
            failed: detail.ambiguousReviewFailed,
            form,
            remote: shared.ingredientRemoteSearch,
        }),
        adding: rowBusyText(
            adding,
            {
                form,
                added: shared.ingredientPickerStatus.added,
                details: shared.ingredientDetails,
                remote: shared.ingredientRemoteSearch,
            },
            naming,
        ),
        refreshed,
        offersRetry: failure !== undefined || shortlist.kind === 'failed',
        retryLabel: fillTemplate(detail.ambiguousReviewRetryLabel, { phrase }),
        onPick: (pick) => {
            setRefreshed(false);
            picker.pick(review.position, pick, search.refetch);
        },
        onRetry: () => {
            setRefreshed(failure !== undefined);
            search.refetch();
        },
    };
}
