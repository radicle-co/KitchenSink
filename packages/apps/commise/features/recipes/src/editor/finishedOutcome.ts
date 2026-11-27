/**
 * @module @commise/features-recipes/editor — how the editor finished, and what the cook is told about it (E8; build spec
 * §7.8): "Recipe published." after a publish, "Changes saved." after Save changes. The editor hands the host the outcome
 * through `EditorNavigation.finished`; both apps show the snackbar straight away, and only a refused Private travels to
 * the recipe page, in one query parameter.
 *
 * ⛔ The three outcomes and their words are defined HERE, once, for the editor (which names them), the web editor
 * and the native task route (which show the snackbar), and the web recipe page (which reads the refusal back). So is
 * the one thing a finish adds to its outcome: that the cook's Private was not sent because the server would refuse it.
 * The recipe page says that inline; the snackbar says only the outcome.
 *
 * "Add to a collection" after a FIRST publish waits for the chooser sheet (§6.4), which is a separate slice; the first
 * publish is already a distinct outcome so the action can be added without changing a caller.
 *
 * Pure and platform-agnostic.
 */
import { PRIVATE_REFUSALS, type PrivateRefusal } from '../actions/privateGate.js';
import type { EditorExit } from '../hooks/useRecipeEditor.js';
import type { EditorMessages } from './messages.js';

/** How the editor finished: the recipe's first publish, a later one, or a published recipe's saved changes. */
export const FINISHED_OUTCOMES = ['firstPublish', 'published', 'changesSaved'] as const;

/** One way the editor finished. */
export type FinishedOutcome = (typeof FINISHED_OUTCOMES)[number];

/**
 * How the editor finished, and whether the cook's Private was refused there (`visibilityFollowUp`). `privateRefused` is
 * a REQUIRED key, so every finish states it.
 */
export interface EditorFinish {
    readonly outcome: FinishedOutcome;
    readonly privateRefused: PrivateRefusal | undefined;
}

/**
 * The query parameter the web editor sets on the recipe page's URL, and only when Private was refused: the outcome
 * itself is shown as a snackbar before the navigation, so it never travels in the address.
 */
export const PRIVATE_REFUSED_PARAM = 'privateRefused';

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
 * What the snackbar says: how the editor finished. A refused Private is NOT said here — a 6 s toast is gone before a cook
 * who looked away reads it, and the recipe is now public against their own choice, so the recipe page says it inline
 * (`visibilityNoticeOf`, `docs/design/uiOverhaul/buildSpec.md` §6.4).
 *
 * @param finish - How the editor finished.
 * @param messages - The editor's copy.
 * @returns The snackbar's sentence. Pure.
 */
export function finishedNoticeOf(
    finish: EditorFinish,
    messages: Pick<EditorMessages, 'published' | 'changesSaved'>,
): string {
    return finish.outcome === 'changesSaved' ? messages.changesSaved : messages.published;
}

/**
 * Read a refusal back from the recipe page's URL. A URL is the reader's to forge, so anything that is not exactly one
 * refusal's spelling is nothing.
 *
 * @param value - The parameter's value.
 * @returns The refusal, or `undefined`. Pure.
 */
export function parsePrivateRefusalParam(value: string | null | undefined): PrivateRefusal | undefined {
    return PRIVATE_REFUSALS.find((candidate) => candidate === value);
}
