/**
 * @module @commise/features-recipes/hooks — the row editor's controllers, composed ONCE for the three hosts (web edit and
 * create, mobile's editor; `docs/design/rowEditorBlueprint.md` decisions 1, 2 and 7). A host calls this and hands the
 * result to the ingredients field group, as it hands it the nutrition read.
 *
 * - The commit port (`useLineCommit`) is the one route every pick takes: the entry's, the authored-food form's and the
 *   details dialog's. Each gets the port with its origin bound, and `useLineCommit` keeps the settled commit and the
 *   pick in flight, so the rows say and focus the right thing from one owner of commit state.
 * - The entry (`useIngredientEntry`) is hoisted here because the wizard renders only the current step.
 * - The details dialog is open for at most one line. Its outcome becomes the pick decision 7 names: a variant, or
 *   Remove details as the line's root. The route (the rebind command for a stored line, the draft otherwise) is
 *   `commitRouteFor`'s, never this hook's.
 * - Rows 6 and 7 pick through the same port (`pickFromShortlist`): each lists what the food search finds for its line's
 *   words, and one pick binds one line (owner ruling 2026-10-02).
 * - The cook's own source limit is held here, ONCE for the session, above every surface that spends it (system change
 *   9): the port refuses a remote pick while it stands, the entry's search holds it from a source frame.
 * - How the editor names a remote source and says a time and a list is read here once (`useSourceNaming`), so every
 *   row and panel says the same name for the same source (S7 list contract P5).
 *
 * @pattern Facade — one entry point over the commit, entry, authored-food, details and source-limit controllers
 */
import { useState } from 'react';

import type { DetailsDialogEntry } from '../details/detailsDialogMachine.js';
import { useVariantDetailsDialog, type VariantDetailsDialogModel } from '../details/useVariantDetailsDialog.js';
import type { IngredientLineKey } from '../form/lineKey.js';
import type { SourceNaming } from '../form/progressiveNotes.js';
import type { DraftAction } from '../form/draftAction.js';
import { errorsInStep } from '../form/steps.js';
import type { GateOutcome } from '../wizard/model.js';
import type { EntryLine } from './ingredientEntry.model.js';
import {
    isPickRefusal,
    type IngredientPick,
    type LineCommitOutcome,
    type LineCommitPort,
    type LineCommitTarget,
} from './lineCommit.js';
import {
    useAuthoredFoodCreate,
    type AuthoredFoodCreateController,
    type AuthoredFoodOutcome,
} from './useAuthoredFoodCreate.js';
import { useIngredientEntry, type IngredientEntry } from './useIngredientEntry.js';
import { useLineCommit, type LineCommitSurface, type SettledLineCommit } from './useLineCommit.js';
import { useSourceLimit, type SourceLimit } from './useSourceLimit.js';
import { useSourceNaming } from './useSourceNaming.js';

/** Options for {@link useIngredientRowEditor}. */
export interface UseIngredientRowEditorOptions {
    /** The form the picks are made on, and its ports. */
    readonly surface: LineCommitSurface;
    /** The draft's lines, in order. */
    readonly lines: readonly EntryLine[];
}

/** A line's details dialog, open. */
export interface RowDetailsTarget {
    readonly key: IngredientLineKey;
    /** The root the line is bound to: the dialog lists its variants, and Remove details binds it. */
    readonly rootId: string;
    /** The root's name, from the line, so the dialog names the food before its read lands (R24). */
    readonly foodName: string;
    readonly entry: DetailsDialogEntry;
}

/** The surface a commit came from. A details commit carries the mode the dialog was opened in. */
export type RowCommitOrigin =
    | { readonly kind: 'entry' }
    | { readonly kind: 'authoredFood'; readonly outcome: AuthoredFoodOutcome }
    /** Row 6's or row 7's panel: one pick on one line the search's shortlist offers (`../form/shortlistPanel.model.ts`). */
    | { readonly kind: 'shortlist' }
    | { readonly kind: 'details'; readonly mode: DetailsDialogEntry['mode'] };

/** The last commit that settled, with where it came from. A commit refused as `busy` never settles. */
export type SettledRowCommit = SettledLineCommit<RowCommitOrigin>;

/** The details dialog, as the rows open and render it. */
export interface RowDetailsController {
    /** The line whose dialog is open; `undefined` while closed. */
    readonly target: RowDetailsTarget | undefined;
    readonly open: (target: RowDetailsTarget) => void;
    readonly model: VariantDetailsDialogModel;
}

/**
 * What a host hands the ingredients field group. The commit port itself stays here: the rows read what settled from
 * {@link settled} alone, one source for one fact.
 */
export interface IngredientRowEditor {
    readonly entry: IngredientEntry;
    readonly authoredFood: AuthoredFoodCreateController;
    readonly details: RowDetailsController;
    /** The session's one source limit: a panel's search holds it from a source frame (system change 9). */
    readonly sourceLimit: SourceLimit;
    /** How every row and panel names a remote source and says a time and a list (P5, P6). */
    readonly naming: SourceNaming;
    /** The remote picks the limit refused before asking: each says the limit again (`LineCommit.limitRefusals`). */
    readonly limitRefusals: number;
    /**
     * Row 6's and row 7's pick: put `pick` on the line with `key`, through the one commit port, so a stored line is
     * re-pointed by the rebind command and a draft line by its admission. Its in-flight and settled facts are
     * {@link pickInFlight} and {@link settled}, like every other commit's.
     */
    readonly pickFromShortlist: (key: IngredientLineKey, pick: IngredientPick) => Promise<LineCommitOutcome>;
    /** The last commit that settled, from any surface. */
    readonly settled: SettledRowCommit | undefined;
    /**
     * The cook has moved past {@link settled}: typed new text, picked, used Change food again or cancelled
     * (`docs/design/rowEditorOpenDecisions.md` E2, E3). A failure's line shows until then. It lives here, with what
     * settled, because this host outlives the step: leaving the step is not moving past. `true` while nothing settled.
     */
    readonly movedPast: boolean;
    /** The cook moved past {@link settled}. */
    readonly moveOn: () => void;
    /**
     * How many of the entry's picks settled with no food on their line. Each counts as an attempt on the step that
     * holds the ingredients, so the wizard's rail marks it (E2).
     */
    readonly pickFailures: number;
    /**
     * The pick in flight on `target`, or `undefined`: the row reads busy and says what it is doing (§S13 P11), and its
     * other actions do nothing.
     */
    readonly pickInFlight: (target: LineCommitTarget) => IngredientPick | undefined;
    /**
     * A save or Next was refused for pending text, and the first pending field has not taken focus yet. A level, not
     * an event: the refusal can move the wizard to step 2, whose field mounts after it
     * (`rowEditorOpenDecisions.md` R7).
     */
    readonly pendingFocusRequested: boolean;
    /**
     * A save or Next was refused for pending text, and some field still holds pending text: each such field says why,
     * under it (`rowEditorOpenDecisions.md` R7, "On the field"). Unlike {@link pendingFocusRequested} it outlasts the
     * focus move; it drops once no field holds pending text.
     */
    readonly pendingRefused: boolean;
    /** How many refusals have pointed at a pending field: its alert says its sentence again at each one (R8). */
    readonly pendingRefusals: number;
    /** A gate decided: a refusal for pending text, on the step that holds it, raises {@link pendingFocusRequested}. */
    readonly refused: (outcome: GateOutcome) => void;
    /** The pending field took focus: lowers {@link pendingFocusRequested}. */
    readonly pendingFocusHandled: () => void;
    /**
     * The host's own draft transition, which meets the draft as it is when an action lands. A row removes through it
     * by key, because its Remove can run from a handler that closed over an earlier draft (a held menu item).
     */
    readonly dispatch: (action: DraftAction) => void;
}

/**
 * The row editor's controllers.
 *
 * @param options - The host's surface and the draft's lines.
 * @returns The composed controllers, and the last settled commit.
 * @sideEffect Reads and writes through the composed hooks.
 */
export function useIngredientRowEditor(options: UseIngredientRowEditorOptions): IngredientRowEditor {
    const sourceLimit = useSourceLimit();
    const lineCommit = useLineCommit<RowCommitOrigin>(options.surface, sourceLimit);
    const naming = useSourceNaming();
    const [detailsTarget, setDetailsTarget] = useState<RowDetailsTarget | undefined>(undefined);
    // The refusals that pointed at a pending field, and how many of them a field has taken: the level stands while
    // the two differ (`docs/design/rowEditorOpenDecisions.md` R7).
    const [refusalCount, setRefusalCount] = useState(0);
    const [handledCount, setHandledCount] = useState(0);
    const pendingFocusRequested = refusalCount !== handledCount;
    const [pendingRefused, setPendingRefused] = useState(false);
    // What settled when the cook last moved on (E2): equal to what settled now means the cook moved past it.
    const [movedPastFrom, setMovedPastFrom] = useState(lineCommit.settled);
    const [pickFailures, setPickFailures] = useState(0);

    /** The one commit port, tagged with the surface the pick came from (`useLineCommit` keeps what it settles). */
    const commitFrom =
        (origin: RowCommitOrigin): LineCommitPort =>
        (pick, target) =>
            lineCommit.commit(pick, target, origin);

    const entry = useIngredientEntry({
        lines: options.lines,
        commit: async (pick, target) => {
            const outcome = await commitFrom({ kind: 'entry' })(pick, target);

            if (isPickRefusal(outcome)) {
                setPickFailures((count) => count + 1);
            }

            return outcome;
        },
        sourceLimit,
    });

    // The refusal's levels have nothing left to point at once no field holds pending text, and must not fire later at
    // text typed after it. Adjusted during render, React's previous-value form.
    if (pendingFocusRequested && entry.pending === undefined) {
        setHandledCount(refusalCount);
    }

    if (pendingRefused && entry.pending === undefined) {
        setPendingRefused(false);
    }

    const authoredFood = useAuthoredFoodCreate({
        commit: async (pick, target, outcome) => {
            const committed = await lineCommit.commit(pick, target, { kind: 'authoredFood', outcome });

            // The text the form was opened on is spent: its field empties, as it does after a pick from the list.
            if (committed.kind === 'committed') {
                entry.abandon(target);
            }

            return committed;
        },
    });
    const model = useVariantDetailsDialog({
        open: detailsTarget !== undefined,
        rootId: detailsTarget?.rootId ?? '',
        entry: detailsTarget?.entry ?? { mode: 'add' },
        onOutcome: (outcome) => {
            setDetailsTarget(undefined);

            if (detailsTarget === undefined || outcome.kind === 'dismissed') {
                return;
            }

            const pick: IngredientPick =
                outcome.kind === 'committed'
                    ? { kind: 'catalogVariant', foodVariantId: outcome.variant.id }
                    : { kind: 'catalogFood', foodId: detailsTarget.rootId, name: detailsTarget.foodName };

            void commitFrom({ kind: 'details', mode: detailsTarget.entry.mode })(pick, {
                kind: 'line',
                key: detailsTarget.key,
            });
        },
    });

    return {
        pickFromShortlist: (key, pick) => commitFrom({ kind: 'shortlist' })(pick, { kind: 'line', key }),
        entry,
        authoredFood,
        details: { target: detailsTarget, open: setDetailsTarget, model },
        sourceLimit,
        naming,
        limitRefusals: lineCommit.limitRefusals,
        settled: lineCommit.settled,
        movedPast: lineCommit.settled === movedPastFrom,
        moveOn: () => setMovedPastFrom(lineCommit.settled),
        pickFailures,
        pickInFlight: lineCommit.inFlightPick,
        pendingFocusRequested,
        pendingRefused,
        pendingRefusals: refusalCount,
        refused: (outcome) => {
            // Only a refusal whose landing step holds the pending text points at the field (R7 item 2).
            if (
                outcome.kind === 'refused' &&
                outcome.step !== undefined &&
                errorsInStep(outcome.errors, outcome.step).ingredients === 'ingredientsPendingText'
            ) {
                setRefusalCount((count) => count + 1);
                setPendingRefused(true);
            }
        },
        pendingFocusHandled: () => setHandledCount(refusalCount),
        dispatch: options.surface.dispatch,
    };
}
