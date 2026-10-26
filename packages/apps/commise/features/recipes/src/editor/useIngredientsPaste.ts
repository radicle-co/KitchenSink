'use client';

/**
 * @module @commise/features-recipes/editor — Paste a list, composed ONCE for both editor containers (build spec
 * §7.5.4; owner decision D10; ADR-0071): the paste's session (`usePasteIntoIngredients`), the Mediator that matches and
 * joins its lines (`usePasteMatching`), what the section draws of the matched lines (`usePasteMatchView`), the sheet
 * (`usePasteListSheet`), and where the section offers it — in the heading row once the section has lines, beside the add
 * field while it is empty, and nowhere once the editor stops offering it (the first publish, D10).
 *
 * While a paste's lines are still joining the recipe, or a pick is being sent, `pending` holds Publish: a recipe
 * published then would lose them, and the rows themselves say "Reading…". ⛔ A line still being CHECKED does not hold it:
 * the cook may publish, and the publish sheet (`openChoices`) says which lines have no food yet (R23). The same fact holds
 * the server create, through the shared paste hold the editor reads when a checkpoint runs (`pasteHold.ts`): written as
 * the paste's state commits, cleared on unmount.
 *
 * @pattern Facade — one entry point over the paste, its matching and its sheet, for the two containers
 */
import { useMessages } from '@commise/i18n/react';
import { useLayoutEffect } from 'react';

import type { DraftAction } from '../form/draftAction.js';
import { recipeFormMessages } from '../form/messages.js';
import type { IngredientsPasteView } from '../form/props.js';
import type { IngredientRowEditor } from '../hooks/useIngredientRowEditor.js';
import { reviewReasonOf } from '../ingredientMatching/reviewReason.js';
import { useMatchCopy } from '../ingredientMatching/useMatchCopy.js';
import type { OpenChoicesFacts } from './openChoicesCopy.js';
import type { PasteHold } from './pasteHold.js';
import { pasteMilestoneOf, pasteProgressOf, pasteRowsOf } from './pasteProgress.js';
import type { DraftKeep } from './saveStatus.js';
import { useAppFocused } from '../hooks/useAppFocused.js';
import { usePasteAnnouncement } from './usePasteAnnouncement.js';
import { usePasteIntoIngredients } from './usePasteIntoIngredients.js';
import { usePasteListSheet, type PasteListSheet } from './usePasteListSheet.js';
import { usePasteMatching } from './usePasteMatching.js';
import { usePasteMatchView } from './usePasteMatchView.js';

/** Options for {@link useIngredientsPaste}. */
export interface UseIngredientsPasteOptions {
    /** The editor offers paste (`pasteOffered`, D10: until the first publish). */
    readonly offered: boolean;
    /** A line joining now keeps its source for the create (`pastedLineKeepsSource`). */
    readonly keepsSource: boolean;
    readonly dispatch: (action: DraftAction) => void;
    /**
     * The draft's ingredient line keys: an empty section offers paste beside its add field rather than in its heading,
     * and a key that goes is a line the cook deleted (the paste list never joins it again).
     */
    readonly lineKeys: readonly string[];
    /** Open the sheet at once: Home's first-run Paste ingredients (§7.5.4). */
    readonly initiallyOpen: boolean;
    /** The hold the editor reads before its server create (`pasteHold.ts`): this paste is its one writer. */
    readonly hold: PasteHold;
    /** The row editor: the paste list's picks go through its one commit port, and its food picker opens on a line. */
    readonly rowEditor: IngredientRowEditor;
    /** Where the draft is kept (D7), for the offline notice. */
    readonly keep: DraftKeep;
    /** Whether a checking line that reads confident binds by itself (not once the recipe is published). */
    readonly autoBind: boolean;
}

/** What the publish action reads of the paste's lines that have no food yet. */
export interface PasteOpenChoices {
    /** The sheet's facts, or `undefined` while no line needs a pick: Publish goes straight through. */
    readonly facts: OpenChoicesFacts | undefined;
    /** Choose now: open the first line that needs a pick, and ask it for focus. */
    readonly chooseNow: () => void;
}

/** What a container wires. */
export interface IngredientsPaste {
    /** What the field group draws (`RecipeIngredientsFieldsProps.paste`). */
    readonly view: IngredientsPasteView;
    /** Whether the section's heading row offers Paste a list. */
    readonly inHeading: boolean;
    /** Opens the sheet: the heading's button. */
    readonly open: () => void;
    readonly sheet: PasteListSheet;
    /** The sheet's busy and failed states, for `PasteListSheet`. */
    readonly submitting: boolean;
    readonly failed: boolean;
    /** A paste is being sent, its lines are still joining the recipe, or a pick is being sent: Publish waits. */
    readonly pending: boolean;
    /** The lines with no food yet, for the publish sheet (R23). */
    readonly openChoices: PasteOpenChoices;
}

/**
 * Paste a list, for one editor.
 *
 * @param options - Whether paste is offered and keeps its source, the draft's transition and keys, the row editor, and
 *     whether to open at once.
 * @returns What the container wires.
 * @sideEffect Through `usePasteIntoIngredients` and `usePasteMatching`: creates and polls the parse job, asks for its
 *     matches, and appends the lines it settles.
 */
export function useIngredientsPaste(options: UseIngredientsPasteOptions): IngredientsPaste {
    const m = useMessages(recipeFormMessages);
    const matchCopy = useMatchCopy();
    const { rowEditor } = options;
    const paste = usePasteIntoIngredients({ offered: options.offered });
    const matching = usePasteMatching({
        paste,
        keepsSource: options.keepsSource,
        dispatch: options.dispatch,
        pickOnLine: rowEditor.pickFromPaste,
        lineKeys: options.lineKeys,
        autoBind: options.autoBind,
        searching: rowEditor.entry.changing,
        settled: rowEditor.settled,
        beginSearch: rowEditor.entry.beginChange,
        reviewReasonOf: (reason) => reviewReasonOf(matchCopy.line, reason),
    });
    // Waiting for a connection, from the queries' and mutations' own state, never a connectivity read: TanStack parks
    // work without a connection or without focus, and a focused app parked is an offline one (`useAppFocused`).
    const appFocused = useAppFocused();
    const offline = appFocused && (paste.pollPaused || matching.paused);
    const sheet = usePasteListSheet(paste, {
        initiallyOpen: options.initiallyOpen,
        copy: { lineTooLong: m.pasteRefusalLineTooLong, tooManyLines: m.pasteRefusalTooManyLines },
    });
    const presentation = usePasteMatchView({
        matching,
        lineCount: options.lineKeys.length,
        keep: options.keep,
        quota: paste.quota,
        offline,
    });
    const reading = pasteRowsOf({
        jobId: paste.sessionKey ?? '',
        lines: paste.lines,
        joined: paste.joined,
        failedAt: paste.failedAt,
        waiting: offline,
    });
    const progress = reading.length === 0 ? undefined : pasteProgressOf(reading, paste.joined.size, paste.lines.length);
    const condition = progress === undefined ? undefined : pasteMilestoneOf(progress);
    const announcement = usePasteAnnouncement(
        paste.sessionKey,
        condition,
        progress === undefined ? 0 : progress.status.kind === 'needsYou' ? progress.status.count : progress.count,
    );
    const empty = options.lineKeys.length === 0 && reading.length === 0;
    const open = (): void => sheet.setOpen(true);
    const pending = paste.submitting || reading.length > 0 || matching.joining || matching.pending.size > 0;
    const { hold } = options;

    // A layout effect: the hold is current once this state commits, before any passive effect or event can run a
    // checkpoint. A paste that goes away holds nothing, and tells nobody (there is no editor left to checkpoint).
    // @sideEffect Writes the shared paste hold.
    useLayoutEffect(() => {
        hold.set(pending);
    }, [hold, pending]);
    useLayoutEffect(() => () => hold.discard(), [hold]);

    return {
        view: {
            matching: presentation.view,
            reading,
            progress,
            onRetryLookup: paste.retryLookup,
            onRetryParse: paste.retryParse,
            onAddAsWritten: paste.addAsWritten,
            onAddRestAsWritten: paste.addRestAsWritten,
            focusSignal: paste.focusSignal,
            retryFailed: paste.retryFailed,
            focusRow: paste.focusRow,
            onRowFocusHandled: paste.onRowFocusHandled,
            // The notice already says it when the work is offline (`PasteMatchNotice`): the reading-phase region must not
            // say the same milestone twice.
            announcement:
                announcement?.milestone === 'offline' && presentation.view.notice?.kind === 'offline'
                    ? undefined
                    : announcement,
            added: paste.added,
            onOpen: paste.available && empty ? open : undefined,
        },
        inHeading: paste.available && !empty,
        open,
        sheet,
        submitting: paste.submitting,
        failed: paste.failed,
        pending,
        openChoices: { facts: presentation.facts, chooseNow: presentation.chooseNow },
    };
}
