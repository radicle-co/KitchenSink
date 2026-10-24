/**
 * @module @commise/features-recipes/editor — how the editor finished, and what the cook is told about it (E8; build spec
 * §7.8): "Recipe published." after a publish, "Changes saved." after Save changes. The editor hands the host the outcome
 * through `EditorNavigation.finished`; web carries it to the recipe page in a one-shot query parameter, because a snackbar
 * raised before the navigation dies with the old page's shell, and native shows the snackbar straight away.
 *
 * ⛔ The three outcomes, their wire spelling and their words are defined HERE, once, for the editor (which names them),
 * the web recipe page (which reads the parameter back) and the native task route (which shows the snackbar). So is the
 * one thing a finish adds to its outcome: that the cook's Private was not sent because the server would refuse it. The
 * recipe page says that inline; the snackbar says only the outcome.
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

/** The query parameter the web editor sets on the recipe page's URL. */
export const FINISHED_OUTCOME_PARAM = 'done';

/** Between the outcome and the refusal in the parameter's value (`published.final`). */
const REFUSAL_SEPARATOR = '.';

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
 * The parameter's value for a finish: the outcome, and `.<refusal>` after it when Private was refused. Pure.
 *
 * @param finish - How the editor finished.
 * @returns `published`, or `published.final`.
 */
export function finishedParamOf(finish: EditorFinish): string {
    return finish.privateRefused === undefined
        ? finish.outcome
        : `${finish.outcome}${REFUSAL_SEPARATOR}${finish.privateRefused}`;
}

/**
 * Read a finish back from a URL parameter. A URL is the reader's to forge, so anything that is not exactly an outcome's
 * spelling, optionally followed by one refusal's, is nothing.
 *
 * @param value - The parameter's value.
 * @returns The finish, or `undefined`. Pure.
 */
export function parseFinishedParam(value: string | null | undefined): EditorFinish | undefined {
    const [outcomePart, refusalPart, ...rest] = (value ?? '').split(REFUSAL_SEPARATOR);
    const outcome = FINISHED_OUTCOMES.find((candidate) => candidate === outcomePart);

    if (outcome === undefined || rest.length > 0) {
        return undefined;
    }

    if (refusalPart === undefined) {
        return { outcome, privateRefused: undefined };
    }

    const privateRefused = PRIVATE_REFUSALS.find((candidate) => candidate === refusalPart);

    return privateRefused === undefined ? undefined : { outcome, privateRefused };
}
