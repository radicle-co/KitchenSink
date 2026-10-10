/**
 * @module @commise/features-recipes/form — rows 6 and 7's panel (`docs/design/ingredientStatusExplanation.md` SPECIFY.1
 * rows 6 and 7): an `UNRESOLVED` or `AMBIGUOUS` line's shortlist, re-derived from the progressive food search over the
 * line's own words, a pick per food, and None of these. The contract the orchestration leaves take (`ShortlistPanel`),
 * and the one view the shared `CandidatesPanelBody` draws.
 *
 * The owner ruled on 2026-10-02 that every place a cook picks a food shows remote foods, so both rows read the same
 * progressive answer as the editor's list (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P12): database
 * foods first, then each source's foods under `From {source}`, added at the end; never a binding's stored candidates.
 * A pick is the entry's own pick of that food (`foodPickOf`, `remotePickOf`), committed on THIS line through the row
 * editor's commit port, so a stored line is re-pointed by the rebind command and a draft line by its admission (owner
 * ruling 2026-10-02: one pick binds one line). None of these starts Change food and records nothing (§3a).
 *
 * Pure: no React, no platform APIs.
 *
 * @pattern Presentation Model — {@link shortlistPanelOf} derives the view the body draws
 */
import { variantPartTexts } from '../detail/lineName.js';
import {
    foodPickOf,
    remotePickOf,
    servedFoodsOf,
    type EntrySearchView,
    type FoodOption,
    type RemoteFoodOption,
} from '../hooks/foodSuggestions.model.js';
import type { IngredientPick, LineCommitOutcome } from '../hooks/lineCommit.js';
import type { SettledRowCommit } from '../hooks/useIngredientRowEditor.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type { IngredientRemoteSearchMessages } from '../messages.js';
import type { CandidateGroup, CandidateOption, CandidatesPanelBody, CandidatesPanelView } from './candidatesPanel.js';
import type { IngredientLineKey } from './lineKey.js';
import type { RecipeFormMessages } from './messages.js';
import {
    remotePickFailureOf,
    sourceDisplayName,
    sourceNotesOf,
    unsearchedSentenceOf,
    type SourceNaming,
} from './progressiveNotes.js';

/** Why the row asks the cook: rows 6 and 7 explain themselves differently and list the same way. */
export type ShortlistReason = 'unresolved' | 'ambiguous';

/** A pick this row's panel made, once it settled. */
export interface ShortlistPick {
    readonly pick: IngredientPick;
    readonly outcome: LineCommitOutcome;
}

/** Props for the `ShortlistPanel` leaves (web and native). */
export interface ShortlistPanelProps {
    /** Row 6 (`unresolved`) or row 7 (`ambiguous`). */
    readonly reason: ShortlistReason;
    /** The row's name, which names the list. */
    readonly food: string;
    /** What the search asks for: the line's own words. */
    readonly phrase: string;
    /** The pick in flight on this row (`useIngredientRowEditor`'s `pickInFlight`), if any. */
    readonly inFlight: IngredientPick | undefined;
    /** The last pick this row's panel made, once it settled ({@link shortlistSettledAt}). */
    readonly lastPick: ShortlistPick | undefined;
    /** The remote picks the session's limit refused (`IngredientRowEditor.limitRefusals`). */
    readonly limitRefusals: number;
    /** The session's limit holder (`SourceLimit.hold`): a source frame that reports the limit holds it. */
    readonly holdLimit: (until: number) => void;
    /** How the editor names a remote source and says a time and a list (`IngredientRowEditor.naming`). */
    readonly naming: SourceNaming;
    /** Commit a pick on this row (`useIngredientRowEditor`'s `pickFromShortlist`). */
    readonly onPick: (pick: IngredientPick) => Promise<LineCommitOutcome>;
    /** A pick here put a food on the line: the host closes the panel. */
    readonly onSettled: () => void;
    /** None of these: the host closes the panel and starts Change food. It records nothing. */
    readonly onNoneOfThese: () => void;
}

/** The copy the view reads. */
export interface ShortlistPanelCopy {
    readonly form: Pick<
        RecipeFormMessages,
        | 'statusExplainAmbiguous'
        | 'statusExplainUnresolved'
        | 'candidatesLabel'
        | 'candidatesLoading'
        | 'candidatesLoadFailed'
        | 'candidatesEmpty'
        | 'candidatePickFailed'
        | 'ingredientCatalogUnavailable'
        | 'ingredientAuthoredUnavailable'
        | 'ingredientDatabaseUnavailable'
        | 'ingredientRemotePickFailed'
        | 'ingredientRemotePickGone'
    >;
    readonly remote: Pick<
        IngredientRemoteSearchMessages,
        | 'groupHeading'
        | 'hitName'
        | 'sourceUnnamed'
        | 'stillSearching'
        | 'incomplete'
        | 'sourceBusy'
        | 'sourceUnavailable'
        | 'sourceLimited'
        | 'busy'
        | 'sourceLimitReached'
    >;
    /** The app-wide parked-read sentence (`offlineNoticeMessages.readOffline`). */
    readonly readOffline: string;
}

/** What the view is derived from. */
export interface ShortlistPanelInput extends SourceNaming {
    /** The line's food search (`entrySearchViewOf` over `useIngredientSuggestionSource`). */
    readonly view: EntrySearchView;
    readonly reason: ShortlistReason;
    readonly food: string;
    readonly inFlight: IngredientPick | undefined;
    readonly lastPick: ShortlistPick | undefined;
    readonly limitRefusals: number;
}

/** The panel's view, and the pick each option makes. */
export interface ShortlistPanel {
    readonly view: CandidatesPanelView;
    /** The pick an option makes, by the option's `candidateId`; `undefined` for an option the list no longer holds. */
    readonly pickOf: (candidateId: string) => IngredientPick | undefined;
}

/** A database food's key: the group and the id, because the two groups hold different foods. Pure. */
const databaseKeyOf = (food: FoodOption): string => `${food.group}:${food.hit.id}`;

/** A remote food's key: its source and the reference food issued, never its place (P2). Pure. */
const remoteKeyOf = (food: RemoteFoodOption): string => `remote:${food.source}:${food.hit.reference}`;

/** Whether two picks name the same food. Pure. */
const samePick = (a: IngredientPick, b: IngredientPick): boolean => {
    switch (a.kind) {
        case 'catalogFood':
            return b.kind === 'catalogFood' && b.foodId === a.foodId;
        case 'catalogVariant':
            return b.kind === 'catalogVariant' && b.foodVariantId === a.foodVariantId;
        case 'remoteFood':
            return b.kind === 'remoteFood' && b.reference === a.reference;
        case 'name':
        case 'declared':
            return b.kind === a.kind && b.text === a.text;
    }
};

/**
 * What the last pick says, assertively: a remote pick's P8 sentence, or the database pick's failure. Pure.
 *
 * @param lastPick - The last pick this panel made, once it settled.
 * @param input - The panel's input, for naming a source and saying a time.
 * @param copy - The localised copy.
 * @returns The sentence, or `''`.
 */
const alertOf = (lastPick: ShortlistPick | undefined, input: ShortlistPanelInput, copy: ShortlistPanelCopy): string => {
    if (lastPick === undefined) {
        return '';
    }

    if (lastPick.pick.kind === 'remoteFood') {
        return remotePickFailureOf(lastPick.pick, lastPick.outcome, input, copy) ?? '';
    }

    return lastPick.outcome.kind === 'failed' ? copy.form.candidatePickFailed : '';
};

/** Builds one option and records the pick it makes, by its `candidateId`. */
type OptionOf = (
    candidateId: string,
    pick: IngredientPick,
    name: string,
    extra: Partial<CandidateOption>,
) => CandidateOption;

/**
 * An option builder over the pick in flight: the option for that pick reads busy, every other one blocked.
 *
 * @param inFlight - The pick in flight on this row, if any.
 * @param picks - The caller's accumulator: each option's pick, by its `candidateId`.
 * @returns The builder.
 * @sideEffect The builder writes each option's pick into `picks`.
 */
const optionsOver =
    (inFlight: IngredientPick | undefined, picks: Map<string, IngredientPick>): OptionOf =>
    (candidateId, pick, name, extra) => {
        const busy = inFlight !== undefined && samePick(pick, inFlight);

        picks.set(candidateId, pick);

        return {
            candidateId,
            name,
            summary: undefined,
            accessibleName: undefined,
            ...extra,
            busy,
            blocked: inFlight !== undefined && !busy,
        };
    };

/**
 * The served list's groups: the database's foods first, then each source's under its heading. Each option's pick is
 * recorded through `optionOf`.
 */
const servedGroupsOf = (
    view: Extract<EntrySearchView, { readonly kind: 'served' }>,
    input: ShortlistPanelInput,
    copy: ShortlistPanelCopy,
    optionOf: OptionOf,
): CandidateGroup[] => {
    const database = servedFoodsOf(view).map((food) =>
        optionOf(databaseKeyOf(food), foodPickOf(food), food.hit.name, {
            summary: food.group === 'catalog' ? variantPartTexts(food.hit.variant?.parts)?.join(', ') : undefined,
        }),
    );
    const groups: CandidateGroup[] =
        database.length === 0
            ? []
            : [
                  {
                      key: 'database',
                      label: fillTemplate(copy.form.candidatesLabel, { name: input.food }),
                      heading: false,
                      options: database,
                  },
              ];

    for (const part of view.remote) {
        if (part.kind === 'answered' && part.foods.length > 0) {
            const source = sourceDisplayName(part.source, input, copy);

            groups.push({
                key: `remote:${part.source}`,
                label: fillTemplate(copy.remote.groupHeading, { source }),
                heading: true,
                options: part.foods.map((food) =>
                    optionOf(remoteKeyOf(food), remotePickOf(food), food.hit.name, {
                        accessibleName: fillTemplate(copy.remote.hitName, { name: food.hit.name, source }),
                    }),
                ),
            });
        }
    }

    return groups;
};

/** A served answer's body: the list, or failed or empty once every part has answered (L3). */
const servedBodyOf = (
    view: Extract<EntrySearchView, { readonly kind: 'served' }>,
    input: ShortlistPanelInput,
    copy: ShortlistPanelCopy,
    optionOf: OptionOf,
): CandidatesPanelBody => {
    const groups = servedGroupsOf(view, input, copy, optionOf);
    const unsearched = unsearchedSentenceOf(view.database, copy);
    const notes = [
        ...(unsearched === undefined ? [] : [unsearched]),
        ...sourceNotesOf(view.remote, input, copy),
        ...(view.progress === 'incomplete' ? [copy.remote.incomplete] : []),
    ];
    const ended = view.progress !== 'running';
    const everyPartFailed =
        ended &&
        view.database.authored.kind === 'unavailable' &&
        view.database.catalog.kind === 'unavailable' &&
        view.remote.every((part) => part.kind !== 'answered');

    if (everyPartFailed) {
        return { kind: 'failed', text: copy.form.candidatesLoadFailed };
    }

    // Only an answer from every part may say there is nothing (L3).
    if (ended && groups.length === 0 && notes.length === 0) {
        return { kind: 'empty', text: copy.form.candidatesEmpty };
    }

    return { kind: 'list', groups, notes, waiting: ended ? undefined : copy.remote.stillSearching };
};

/** The panel's body for the search's state. */
const bodyOf = (input: ShortlistPanelInput, copy: ShortlistPanelCopy, optionOf: OptionOf): CandidatesPanelBody => {
    const { view } = input;

    switch (view.kind) {
        case 'idle':
        case 'tooShort':
            // A line whose name cannot be searched has nothing to list; None of these is the way on.
            return { kind: 'empty', text: copy.form.candidatesEmpty };
        case 'searching':
            return { kind: 'loading', text: copy.form.candidatesLoading };
        case 'offline':
            return { kind: 'offline', text: copy.readOffline };
        case 'failed':
            return { kind: 'failed', text: copy.form.candidatesLoadFailed };
        case 'served':
            return servedBodyOf(view, input, copy, optionOf);
    }
};

/**
 * Rows 6 and 7's panel: its view and the pick each option makes. Pure.
 *
 * @param input - The line's food search, its name, its pick, and how the surface names a source.
 * @param copy - The localised copy.
 * @returns The panel.
 */
export const shortlistPanelOf = (input: ShortlistPanelInput, copy: ShortlistPanelCopy): ShortlistPanel => {
    const picks = new Map<string, IngredientPick>();
    const body = bodyOf(input, copy, optionsOver(input.inFlight, picks));
    const limited = input.lastPick?.outcome.kind === 'limited';

    return {
        view: {
            explanation:
                input.reason === 'ambiguous' ? copy.form.statusExplainAmbiguous : copy.form.statusExplainUnresolved,
            body,
            alert: alertOf(input.lastPick, input, copy),
            alertOccurrence: limited ? input.limitRefusals : 0,
        },
        pickOf: (candidateId) => picks.get(candidateId),
    };
};

/**
 * The last pick this row's panel made, once it settled, read from the row editor's one settled commit, so the panel says
 * it again when it is opened after the answer. Pure.
 *
 * @param settled - The row editor's last settled commit.
 * @param key - The row.
 * @returns The pick and how it ended, or `undefined` when the last commit was not this row's panel's.
 */
export const shortlistSettledAt = (
    settled: SettledRowCommit | undefined,
    key: IngredientLineKey,
): ShortlistPick | undefined =>
    settled?.origin.kind === 'shortlist' && settled.target.kind === 'line' && settled.target.key === key
        ? { pick: settled.pick, outcome: settled.outcome }
        : undefined;
