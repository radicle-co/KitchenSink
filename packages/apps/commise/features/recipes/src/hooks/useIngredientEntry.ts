/**
 * @module @commise/features-recipes/hooks — the ingredient entry, hoisted (`docs/design/rowEditorBlueprint.md` decision 1;
 * `docs/design/ingredientStatusExplanation.md` §8a). The three hosts call it (web edit and create, mobile's editor), not
 * the ingredients field group, because the wizard renders only the current step.
 *
 * Every entry field the host renders — the trailing add row, a row whose line names no food or a freeform one, a row in
 * Change food — shares ONE active target, ONE debounce, ONE suggestion read and ONE analytics session. Each field's text
 * is kept per target, so moving between fields loses nothing, and the line in the draft is untouched until a pick
 * commits (§4b). A pick goes to the host's commit port (`useLineCommit`), which chooses the route; the field empties
 * only when the commit lands.
 *
 * - The food search sits behind `useIngredientSuggestionSource`: food's ONE progressive answer, our database's foods
 *   first and each remote source's after (`foodSuggestions.model.ts`; `docs/design/rowEditorOpenDecisions.md`, S7 list
 *   contract). A remote food is picked from the list like any other (P8): no button asks a source.
 * - The count is said once, at the end of the answer, unless the answer still runs 1 s after its database part settled;
 *   then that part is said at the guard and the end says only what came after (P7, {@link COUNT_GUARD_MS}).
 * - The cook's own source limit is the session's (`useSourceLimit`, held by the row editor): a source frame that reports
 *   it holds it, through the search (system change 9).
 * - Nothing here opens a panel: a pick that lands `UNRESOLVED` is committed as it is, and its row offers the choice.
 *
 * @pattern Headless hook — the entry's state and actions; the fields render it
 * @pattern Memento over the analytics side-channel — `sessionRef` holds the open search session so it can be settled
 *     when the active target changes, when that target's row is removed, and at unmount. It is never read to render.
 */
import { meetsSearchMinimum } from '@kitchensink/recipe-core/resolution/search-minimum';
import type { QueryOutcomeEvent } from '@kitchensink/recipe-core/analytics/event-payload';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

import { abandonOutcome, observeServedList, pickOutcome, type SearchSession } from '../analytics/queryOutcome.model.js';
import { mintEventId } from '../analytics/mintEventId.js';
import { useAnalyticsEmitter } from '../analytics/useAnalyticsEmitter.js';
import type { IngredientLineKey } from '../form/lineKey.js';
import {
    EMPTY_ENTRY,
    activeTargetOf,
    isPendingAt,
    changingOf,
    entryTextOf,
    pendingEntryOf,
    withActiveTarget,
    withChangeBegun,
    withEntryAbandoned,
    withEntryCommitted,
    withEntryLeft,
    withEntryText,
    type EntryLine,
    type EntryState,
    type PendingEntry,
} from './ingredientEntry.model.js';
import {
    entrySearchViewOf,
    foodPickOf,
    remotePickOf,
    servedFoodsOf,
    type EntrySearchView,
    type FoodOption,
    type RemoteFoodOption,
} from './foodSuggestions.model.js';
import { INGREDIENT_SEARCH_DEBOUNCE_MS } from './ingredientSearchDebounce.js';
import { useIngredientSuggestionSource } from './ingredientSuggestionSource.js';
import type { IngredientPick, LineCommitPort, LineCommitTarget } from './lineCommit.js';
import { useDebouncedValue } from './useDebouncedValue.js';
import { useReadDeadline } from './useReadDeadline.js';
import type { SourceLimit } from './useSourceLimit.js';

/**
 * How long after the database part settles the answer may still run and be said once, at its end (P7): up to 1 s a
 * person's flow of thought is not broken.
 */
export const COUNT_GUARD_MS = 1_000;

/** Options for {@link useIngredientEntry}. */
export interface UseIngredientEntryOptions {
    /** The draft's lines, in order. A row's field starts from its line's name; a row that goes ends its entry. */
    readonly lines: readonly EntryLine[];
    /** The host's commit port: `useLineCommit`'s `commit`. */
    readonly commit: LineCommitPort;
    /** The session's one source limit (`useSourceLimit`): a source frame that reports the cook's limit holds it. */
    readonly sourceLimit: SourceLimit;
}

/** What the hosts and the fields read and wire. */
export interface IngredientEntry {
    /** The text a field shows. */
    readonly textOf: (target: LineCommitTarget) => string;
    /** The cook typed into a field; it becomes the active one. */
    readonly setText: (target: LineCommitTarget, text: string) => void;
    /** A field took focus (the combobox's `onFocus`); it becomes the active one. */
    readonly focus: (target: LineCommitTarget) => void;
    /** The field the search serves; `undefined` before any, and once its row is gone. */
    readonly active: LineCommitTarget | undefined;
    /** Whether `target` is the active field: only it is handed the polite count (`ComboboxProps.countAnnouncement`). */
    readonly isActive: (target: LineCommitTarget) => boolean;
    /** The active field's food list: the progressive answer, as it stands. */
    readonly view: EntrySearchView;
    /**
     * The answer still ran {@link COUNT_GUARD_MS} after its database part settled, so that part is said then and the end
     * says only what came after (P7's slow path).
     */
    readonly databaseSaidEarly: boolean;
    /** The rows in Change food (the row policy drops its Change food and details actions there, system change 5). */
    readonly changing: ReadonlySet<IngredientLineKey>;
    /** Change food on a row: its name becomes an entry field, on its current name. */
    readonly beginChange: (key: IngredientLineKey) => void;
    /** Abandon a field's entry (Cancel, Escape on a closed list, Android back): it goes back to what its line holds. */
    readonly abandon: (target: LineCommitTarget) => void;
    /** The cook left a row's entry: Change food with nothing new typed ends; with new text it stays (item 4). */
    readonly leave: (target: LineCommitTarget) => void;
    /** The first field holding text a save would drop (§4b): where the refusal points. */
    readonly pending: PendingEntry | undefined;
    /** Whether one field holds such text: each row says so in its own words (`ingredientEntryPendingChange`). */
    readonly isPending: (target: LineCommitTarget) => boolean;
    /** Its text, or `''`: what `validateRecipeForm` is handed. */
    readonly pendingEntryText: string;
    /** Pick a food of our database from the active field's list. */
    readonly selectFood: (food: FoodOption) => void;
    /** Pick a remote food from the active field's list: adopted, then committed, by the commit port (P8). */
    readonly selectRemoteFood: (food: RemoteFoodOption) => void;
    /** Find nutrition by the active field's text. */
    readonly findByName: () => void;
    /** Use the active field's text as written, without nutrition. */
    readonly declareAsWritten: () => void;
}

/** The search session and the field it was opened for. */
interface OpenSession {
    readonly targetKey: string;
    readonly session: SearchSession;
}

/** A field's identity as the debounce and the session hold it. */
const keyOf = (target: LineCommitTarget | undefined): string | undefined =>
    target === undefined ? undefined : target.kind === 'line' ? target.key : target.kind;

/**
 * Whether the list was served: the database part is in and one of its groups answered. The session observes the database
 * foods only, which settle once (P2); a search where both groups failed served nothing, so it opens no session. Pure.
 */
const wasServed = (view: EntrySearchView): boolean =>
    view.kind === 'served' && (view.database.authored.kind === 'answered' || view.database.catalog.kind === 'answered');

/**
 * The hoisted ingredient entry.
 *
 * @param options - The draft's lines and the host's commit port.
 * @returns The entry's state and actions.
 * @sideEffect Reads suggestions for the active field, and emits the search session's outcome.
 */
export function useIngredientEntry(options: UseIngredientEntryOptions): IngredientEntry {
    const { lines, commit, sourceLimit } = options;
    const [state, setState] = useState<EntryState>(EMPTY_ENTRY);
    const active = activeTargetOf(state, lines);
    const activeKey = keyOf(active);
    const trimmed = active === undefined ? '' : entryTextOf(state, active, lines).trim();

    // ONE debounce, of the text AND the field it belongs to: a settle for the field the cook just left must not be
    // searched, or observed, as the new field's.
    const query = useMemo(() => ({ targetKey: activeKey, trimmed }), [activeKey, trimmed]);
    const settled = useDebouncedValue(query, INGREDIENT_SEARCH_DEBOUNCE_MS);
    const settledForActive = settled.targetKey === activeKey && activeKey !== undefined;
    const searchEnabled = settledForActive && meetsSearchMinimum(settled.trimmed);
    const search = useIngredientSuggestionSource(settled.trimmed, searchEnabled, sourceLimit.hold);
    const debouncedTrimmed = settledForActive ? settled.trimmed : '';
    // The same object while the text and the read are, so the session effect below observes each frame once.
    const view = useMemo(
        () => entrySearchViewOf({ trimmed, debouncedTrimmed, read: search.read }),
        [trimmed, debouncedTrimmed, search.read],
    );

    // P7's guard: its key is the answer, from the moment its database part settles while it still runs. A guard that
    // fires marks THIS answer said early, which outlasts its end, so the end says only what came after.
    const answerKey = settled.targetKey === undefined ? undefined : `${settled.targetKey}:${settled.trimmed}`;
    const [saidEarlyFor, setSaidEarlyFor] = useState<string | undefined>(undefined);

    useReadDeadline(view.kind === 'served' && view.progress === 'running' ? answerKey : undefined, COUNT_GUARD_MS, () =>
        setSaidEarlyFor(answerKey),
    );

    const emitAnalytics = useAnalyticsEmitter();
    const emitFromEffect = useEffectEvent((event: QueryOutcomeEvent): void => {
        emitAnalytics(event);
    });
    const sessionRef = useRef<OpenSession | null>(null);

    /** End the open session with `outcome`, emitted fire-and-forget. */
    const settleSession = (outcome: QueryOutcomeEvent | null): void => {
        sessionRef.current = null;

        if (outcome !== null) {
            emitAnalytics(outcome);
        }
    };

    /** The open session's no-pick. */
    const abandoned = (): QueryOutcomeEvent | null => abandonOutcome(sessionRef.current?.session ?? null);

    useEffect(() => {
        // A served list settled for the active field: begin, continue or replace its session (KTD6).
        if (wasServed(view) && settled.targetKey !== undefined) {
            const observed = observeServedList(
                sessionRef.current?.session ?? null,
                settled.trimmed,
                servedFoodsOf(view),
                mintEventId,
            );

            sessionRef.current =
                observed.session === null ? null : { targetKey: settled.targetKey, session: observed.session };

            if (observed.abandoned !== null) {
                emitFromEffect(observed.abandoned);
            }
        }
    }, [view, settled]);

    useEffect(() => {
        // ⛔ The session's OWN row went (§8a): any other row's removal leaves it open.
        const open = sessionRef.current;

        if (open !== null && open.targetKey !== 'newLine' && !lines.some((line) => line.key === open.targetKey)) {
            sessionRef.current = null;
            const pending = abandonOutcome(open.session);

            if (pending !== null) {
                emitFromEffect(pending);
            }
        }
    }, [lines]);

    useEffect(() => {
        return (): void => {
            // Leaving the screen: an open session is a no-pick (KTD6c).
            const pending = abandonOutcome(sessionRef.current?.session ?? null);
            sessionRef.current = null;

            if (pending !== null) {
                emitFromEffect(pending);
            }
        };
        // Mount-only: re-running it would settle a session mid-search.
    }, []);

    /** Make `target` the active field, settling the open session when the field changes. */
    const activate = (target: LineCommitTarget): void => {
        if (keyOf(target) !== activeKey) {
            settleSession(abandoned());
        }
    };

    /**
     * Commit `pick` on the active field; its text goes once the commit lands.
     *
     * @sideEffect Commits through the host's port.
     */
    const commitPick = (pick: IngredientPick): void => {
        if (active === undefined) {
            return;
        }

        const target = active;
        const pickedText = entryTextOf(state, target, lines);

        void commit(pick, target).then((outcome) => {
            if (outcome.kind === 'committed') {
                setState((current) => withEntryCommitted(current, target, pickedText));
            }

            // P8: the hit is no longer valid, so the answer that offered it is dropped and the list asks again.
            if (outcome.kind === 'remoteGone') {
                search.refetch();
            }
        });
    };

    /** A pick of the typed text itself: the served list did not produce it, so the session ends as a no-pick. */
    const commitTyped = (toPick: (text: string) => IngredientPick): void => {
        if (active === undefined || trimmed === '') {
            return;
        }

        settleSession(abandoned());
        commitPick(toPick(trimmed));
    };

    const pending = pendingEntryOf(state, lines);

    return {
        textOf: (target) => entryTextOf(state, target, lines),
        setText: (target, text) => {
            activate(target);

            // Clearing the active field without a pick ends its session (AE2).
            if (text.trim() === '' && keyOf(target) === activeKey) {
                settleSession(abandoned());
            }

            setState((current) => withEntryText(current, target, text, lines));
        },
        focus: (target) => {
            activate(target);
            setState((current) => withActiveTarget(current, target));
        },
        active,
        isActive: (target) => activeKey !== undefined && keyOf(target) === activeKey,
        view,
        databaseSaidEarly: view.kind === 'served' && saidEarlyFor === answerKey,
        changing: changingOf(state, lines),
        beginChange: (key) => {
            const line = lines.find((each) => each.key === key);

            if (line === undefined) {
                return;
            }

            activate({ kind: 'line', key });
            setState((current) => withChangeBegun(current, line));
        },
        abandon: (target) => {
            if (keyOf(target) === activeKey) {
                settleSession(abandoned());
            }

            setState((current) => withEntryAbandoned(current, target));
        },
        leave: (target) => {
            setState((current) => withEntryLeft(current, target));
        },
        pending,
        pendingEntryText: pending?.text ?? '',
        isPending: (target) => isPendingAt(state, target, lines),
        selectFood: (food) => {
            if (active === undefined) {
                return;
            }

            // The pick is recorded at the tap: the one moment its place in the served list is known (KTD6).
            settleSession(pickOutcome(sessionRef.current?.session ?? null, food));
            commitPick(foodPickOf(food));
        },
        findByName: () => commitTyped((text) => ({ kind: 'name', text })),
        declareAsWritten: () => commitTyped((text) => ({ kind: 'declared', text })),
        selectRemoteFood: (food) => {
            if (active === undefined) {
                return;
            }

            // The analytics wire names our database's groups only, so a remote pick ends the session as a no-pick.
            settleSession(abandoned());
            commitPick(remotePickOf(food));
        },
    };
}
