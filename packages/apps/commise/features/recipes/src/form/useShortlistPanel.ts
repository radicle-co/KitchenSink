/**
 * @module @commise/features-recipes/form — rows 6 and 7's panel orchestration, shared by the web and native
 * `ShortlistPanel` leaves (SPECIFY.1 rows 6 and 7).
 *
 * It searches the line's own words through the progressive food search (`useIngredientSuggestionSource`, handing it the
 * session's limit holder) and derives the view (`shortlistPanelOf`). A pick puts that food on THIS line through the
 * host's pick, a remote food by its reference; the panel settles once a food is on the line, and a remote food that
 * food refused makes the list ask again (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P8). The glyph panel
 * mounts its leaf only while open, so it searches only then; the pick is the row editor's, so it outlives the panel.
 *
 * @pattern Headless hook — the search, the view and the pick, which each leaf draws through `CandidatesPanelBody`
 */
import { offlineNoticeMessages } from '@commise/features-core/offline';
import { useMessages } from '@commise/i18n/react';
import { meetsSearchMinimum } from '@kitchensink/recipe-core/resolution/search-minimum';

import { entrySearchViewOf } from '../hooks/foodSuggestions.model.js';
import { useIngredientSuggestionSource } from '../hooks/ingredientSuggestionSource.js';
import { recipeMessages } from '../messages.js';
import type { CandidatesPanelView } from './candidatesPanel.js';
import { recipeFormMessages } from './messages.js';
import { shortlistPanelOf, type ShortlistPanelProps } from './shortlistPanel.js';

/** What a `ShortlistPanel` leaf draws and wires. */
export interface ShortlistPanelModel {
    readonly view: CandidatesPanelView;
    /** A press on the option with `candidateId`: inert for an option the list no longer holds, or while a pick runs. */
    readonly onPick: (candidateId: string) => void;
    /** Try again: the search asks again. */
    readonly onRetryRead: () => void;
    readonly onNoneOfThese: () => void;
}

/**
 * Rows 6 and 7's panel: its search, its view and its pick.
 *
 * @param props - The leaf's props.
 * @returns The view and its handlers.
 * @sideEffect Reads the progressive food search, and commits a pick through `props.onPick`.
 */
export function useShortlistPanel(props: ShortlistPanelProps): ShortlistPanelModel {
    const { phrase, inFlight, holdLimit, onPick, onSettled, onNoneOfThese } = props;
    const m = useMessages(recipeFormMessages);
    const shared = useMessages(recipeMessages);
    const { readOffline } = useMessages(offlineNoticeMessages);
    const trimmed = phrase.trim();
    const search = useIngredientSuggestionSource(trimmed, meetsSearchMinimum(trimmed), holdLimit);
    const panel = shortlistPanelOf(
        {
            view: entrySearchViewOf({ trimmed, debouncedTrimmed: trimmed, read: search.read }),
            reason: props.reason,
            food: props.food,
            inFlight,
            lastPick: props.lastPick,
            limitRefusals: props.limitRefusals,
            ...props.naming,
        },
        { form: m, remote: shared.ingredientRemoteSearch, readOffline },
    );

    return {
        view: panel.view,
        onPick: (candidateId) => {
            const chosen = panel.pickOf(candidateId);

            if (chosen === undefined || inFlight !== undefined) {
                return;
            }

            void onPick(chosen).then((outcome) => {
                if (outcome.kind === 'committed') {
                    onSettled();
                } else if (outcome.kind === 'remoteGone') {
                    search.refetch();
                }

                return outcome;
            });
        },
        onRetryRead: search.refetch,
        onNoneOfThese,
    };
}
