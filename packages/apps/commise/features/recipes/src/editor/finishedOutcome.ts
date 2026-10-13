/**
 * @module @commise/features-recipes/editor — how the editor finished, and what the cook is told about it (E8; build spec
 * §7.8): "Recipe published." after a publish, "Changes saved." after Save changes. The editor hands the host the outcome
 * through `EditorNavigation.finished`; web carries it to the recipe page in a one-shot query parameter, because a snackbar
 * raised before the navigation dies with the old page's shell, and native shows the snackbar straight away.
 *
 * ⛔ The three outcomes, their wire spelling and their words are defined HERE, once, for the editor (which names them),
 * the web recipe page (which reads the parameter back) and the native task route (which shows the snackbar).
 *
 * "Add to a collection" after a FIRST publish waits for the chooser sheet (§6.4), which is a separate slice; the first
 * publish is already a distinct outcome so the action can be added without changing a caller.
 *
 * Pure and platform-agnostic.
 */
import type { EditorExit } from '../hooks/useRecipeEditor.js';
import type { EditorMessages } from './messages.js';

/** How the editor finished: the recipe's first publish, a later one, or a published recipe's saved changes. */
export const FINISHED_OUTCOMES = ['firstPublish', 'published', 'changesSaved'] as const;

/** One way the editor finished. */
export type FinishedOutcome = (typeof FINISHED_OUTCOMES)[number];

/** The query parameter the web editor sets on the recipe page's URL. */
export const FINISHED_OUTCOME_PARAM = 'done';

/**
 * The outcome of a hand-off that finished the edit.
 *
 * @param exit - A publish or a Save changes.
 * @returns Its outcome. Pure.
 */
export function outcomeOfExit(
    exit: Extract<EditorExit, { readonly kind: 'published' | 'changesSaved' }>,
): FinishedOutcome {
    if (exit.kind === 'changesSaved') {
        return 'changesSaved';
    }

    return exit.firstPublish ? 'firstPublish' : 'published';
}

/**
 * What the cook is told.
 *
 * @param outcome - How the editor finished.
 * @param messages - The editor's copy.
 * @returns The snackbar's sentence. Pure.
 */
export function finishedNoticeOf(
    outcome: FinishedOutcome,
    messages: Pick<EditorMessages, 'published' | 'changesSaved'>,
): string {
    return outcome === 'changesSaved' ? messages.changesSaved : messages.published;
}

/**
 * Read an outcome back from a URL parameter. A URL is the reader's to forge, so anything that is not exactly one of the
 * three spellings is nothing.
 *
 * @param value - The parameter's value.
 * @returns The outcome, or `undefined`. Pure.
 */
export function parseFinishedOutcome(value: string | null | undefined): FinishedOutcome | undefined {
    return FINISHED_OUTCOMES.find((outcome) => outcome === value);
}
