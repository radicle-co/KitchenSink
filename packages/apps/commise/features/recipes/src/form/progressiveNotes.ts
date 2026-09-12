/**
 * @module @commise/features-recipes/form — the sentences every food list says about the parts of the progressive answer
 * it could not show (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P5 and P6): a database group that could
 * not be searched (L3), and each remote source's note; and what a remote pick that put no food on its line says (P8).
 * The editor's entry fields, rows 6 and 7 and the ambiguity review all say them, so they are worded once, here.
 *
 * Pure and platform-agnostic.
 */
import type { DatabasePart, RemotePart } from '../hooks/foodSuggestions.model.js';
import type { LineCommitOutcome, RemoteFoodPick } from '../hooks/lineCommit.js';
import { limitEndOf } from '../hooks/sourceLimit.model.js';
import { fillTemplate } from '../list/model.js';
import type { IngredientRemoteSearchMessages } from '../messages.js';
import type { RecipeFormMessages } from './messages.js';

/** The copy the sentences read, already localised. */
export interface ProgressiveNotesCopy {
    readonly form: Pick<
        RecipeFormMessages,
        'ingredientCatalogUnavailable' | 'ingredientAuthoredUnavailable' | 'ingredientDatabaseUnavailable'
    >;
    readonly remote: Pick<
        IngredientRemoteSearchMessages,
        'sourceUnnamed' | 'sourceBusy' | 'sourceUnavailable' | 'sourceLimited'
    >;
}

/** How a surface names a source and says a time and a list, in its locale. */
export interface SourceNaming {
    /** A source's name from the register (`shortName`, else `name`), or `undefined` while unread or unknown (P5). */
    readonly sourceName: (source: string) => string | undefined;
    /** The locale's hours and minutes for an epoch time (item 10's `{time}`). */
    readonly formatTime: (epochMs: number) => string;
    /** The locale's list of names (`Intl.ListFormat`). */
    readonly formatList: (items: readonly string[]) => string;
}

/**
 * A source's display name: the register's, or {@link IngredientRemoteSearchMessages.sourceUnnamed}, never the raw id
 * (P5). Pure.
 *
 * @param source - The source's register id.
 * @param naming - How the surface names a source.
 * @param copy - The localised copy.
 * @returns The name.
 */
export const sourceDisplayName = (
    source: string,
    naming: Pick<SourceNaming, 'sourceName'>,
    copy: { readonly remote: Pick<IngredientRemoteSearchMessages, 'sourceUnnamed'> },
): string => naming.sourceName(source) ?? copy.remote.sourceUnnamed;

/**
 * What our database could not search (L3): one group, or both. ⛔ It says nothing when both answered: only then may a
 * surface say that nothing matches. Pure.
 *
 * @param database - The database part.
 * @param copy - The localised copy.
 * @returns The sentence, or `undefined` when both groups answered.
 */
export const unsearchedSentenceOf = (database: DatabasePart, copy: Pick<ProgressiveNotesCopy, 'form'>) => {
    const authoredFailed = database.authored.kind === 'unavailable';
    const catalogFailed = database.catalog.kind === 'unavailable';

    if (authoredFailed && catalogFailed) {
        return copy.form.ingredientDatabaseUnavailable;
    }

    if (catalogFailed) {
        return copy.form.ingredientCatalogUnavailable;
    }

    return authoredFailed ? copy.form.ingredientAuthoredUnavailable : undefined;
};

/**
 * Each remote source's note, in arrival order (P6): busy says try later, unavailable says try now, and the cook's own
 * limit is ONE note for every source it skipped, where the first of them arrived, at the minute item 10 rounds its end
 * up to. A source that answered says nothing, even with no food (R66 hides what our catalog holds). Pure.
 *
 * @param remote - The remote parts, in arrival order.
 * @param naming - How the surface names a source and says a time and a list.
 * @param copy - The localised copy.
 * @returns The notes.
 */
export const sourceNotesOf = (
    remote: readonly RemotePart[],
    naming: SourceNaming,
    copy: Pick<ProgressiveNotesCopy, 'remote'>,
): string[] => {
    const limited = remote.filter((part): part is Extract<RemotePart, { kind: 'limited' }> => part.kind === 'limited');
    const notes: string[] = [];

    for (const part of remote) {
        switch (part.kind) {
            case 'answered':
                break;
            case 'busy':
                notes.push(
                    fillTemplate(copy.remote.sourceBusy, { source: sourceDisplayName(part.source, naming, copy) }),
                );
                break;
            case 'unavailable':
                notes.push(
                    fillTemplate(copy.remote.sourceUnavailable, {
                        source: sourceDisplayName(part.source, naming, copy),
                    }),
                );
                break;
            case 'limited':
                if (part === limited[0]) {
                    notes.push(
                        fillTemplate(copy.remote.sourceLimited, {
                            time: naming.formatTime(limitEndOf(Math.max(...limited.map((each) => each.retryAt)))),
                            sources: naming.formatList([
                                ...new Set(limited.map((each) => sourceDisplayName(each.source, naming, copy))),
                            ]),
                        }),
                    );
                }

                break;

            default: {
                const unhandled: never = part;

                return unhandled;
            }
        }
    }

    return notes;
};

/** The copy a remote pick's failure reads, already localised. */
export interface RemotePickCopy {
    readonly form: Pick<RecipeFormMessages, 'ingredientRemotePickFailed' | 'ingredientRemotePickGone'>;
    readonly remote: Pick<IngredientRemoteSearchMessages, 'sourceUnnamed' | 'busy' | 'sourceLimitReached'>;
}

/**
 * What a remote pick that put no food on its line says (P8), or `undefined` for an outcome that says nothing here: it
 * committed, it was refused as already in flight, or the recipe changed (the editor's conflict state says that). Pure.
 *
 * @param pick - The remote pick.
 * @param outcome - How it ended.
 * @param naming - How the surface names a source and says a time.
 * @param copy - The localised copy.
 * @returns The sentence, said assertively by the surface.
 */
export const remotePickFailureOf = (
    pick: RemoteFoodPick,
    outcome: LineCommitOutcome,
    naming: SourceNaming,
    copy: RemotePickCopy,
): string | undefined => {
    const source = sourceDisplayName(pick.source, naming, copy);

    switch (outcome.kind) {
        case 'committed':
        case 'busy':
        case 'conflict':
            return undefined;
        case 'failed':
            return fillTemplate(copy.form.ingredientRemotePickFailed, { name: pick.name, source });
        case 'remoteGone':
            return fillTemplate(copy.form.ingredientRemotePickGone, { name: pick.name });
        case 'sourceBusy':
            return fillTemplate(copy.remote.busy, { source });
        case 'limited':
            return fillTemplate(copy.remote.sourceLimitReached, { time: naming.formatTime(outcome.retryAt) });

        default: {
            const unhandled: never = outcome;

            return unhandled;
        }
    }
};
