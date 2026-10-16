'use client';

/**
 * @module @commise/features-recipes/editor — Paste a list in the Ingredients section (blueprint A5, owner decision D10,
 * build spec §7.5.4). The flow ends inside the recipe, so no paste is ever left without a recipe to land in.
 *
 * - **Offered while creating** (D10): until the recipe's first publish, as the editor says (`pasteOffered`).
 * - **The paste creates a parse job**, a write that cannot wait: offline it fails at once with the ordinary error
 *   (`useCreateParseJob`'s `networkMode`), never queued, because a paste that ran later would land in a recipe the cook
 *   has left.
 * - **Each line reads at once** as a row, and each settled line joins the recipe IN PASTE ORDER: its foods are looked up
 *   by NAME (`useAddIngredientByName`, the existing cascade, ADR-0045; R19: the parse binds nothing) and appended with
 *   the measure the parse read. A line that joins before the create is submitted carries what it was read from
 *   (`sourceLine`, `sourcePhrase`) for the create; once it is (`pastedLineKeepsSource`, read when the line JOINS), a
 *   PATCH cannot carry them, so it lands as an authored line (A5, Q3; D10 accepts it).
 * - **Offline the lookups pause** (TanStack's `networkMode: 'online'`) and resume on reconnect; the rows then say so
 *   (`waiting`), from the mutations' own `isPaused`, never from a connectivity read.
 * - **No time limit** (owner ruling 2026-10-13; plan 2026-10-15-011): each row says what the server reports its line is
 *   doing. A line the server calls stalled, or that the system stopped trying, waits on the COOK: Add as written joins
 *   it through the add field's own reader, Add the rest as written does that for every such line, and Try again
 *   re-drives the whole paste. Only the server's own terminals (an expired or unreadable job) join without the cook.
 *   Add as written also WITHDRAWS those lines from the parse job (`useWithdrawParseJobLines`), so the worker never
 *   spends an engine on an answer this client discards; the call is best effort and never holds the join back.
 * - **One progress block and one polite region** over the rows (`pasteProgress.ts`, `usePasteAnnouncement.ts`).
 * - **A lookup that fails** holds its line, and the lines after it, so the order holds; Try again asks again.
 *
 * ⚠️ RESIDUAL: the lines still reading are not in the device draft (ADR-0057 keeps form values only), so closing the
 * editor mid-paste loses them. Recording a job in the draft would change the persisted format: a `staff-architect`
 * decision, not this hook's.
 *
 * @pattern Observer — over the parse job's poll
 * @pattern Command — each line's join, a TanStack mutation over its by-name lookups
 * @pattern Adapter — a settled line to draft rows, through `pastedLines.ts` and the line adapters
 */
import {
    useAddIngredientByName,
    useCreateParseJob,
    useParseJob,
    useRetryParseJob,
    useWithdrawParseJobLines,
} from '@kitchensink/recipe-service-client/hooks';
import { shouldRetryRecipeServiceFailure } from '@kitchensink/recipe-service-client';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useState } from 'react';

import type { DraftAction, ResolvedRecipeFormIngredient } from '../form/draftAction.js';
import { mintLineKey } from '../form/mintLineKey.js';
import type { PasteProgress, PasteReadingRow } from '../form/props.js';
import { toIngredientLine, withLineMeasure } from '../hooks/lineCommit.js';
import { pastedLinesOf, type PastedLine, type PastedRow } from './pastedLines.js';
import { pasteMilestoneOf, pasteProgressOf, pasteRowsOf } from './pasteProgress.js';
import { usePasteAnnouncement, type PasteAnnouncement } from './usePasteAnnouncement.js';

/** A pasted line the job has settled. */
type SettledPastedLine = Extract<PastedLine, { readonly kind: 'settled' }>;

/** Options for {@link usePasteIntoIngredients}. */
export interface UsePasteIntoIngredientsOptions {
    /** The editor offers paste (`pasteOffered`, D10). */
    readonly offered: boolean;
    /** A line joining now keeps its source for the create (`pastedLineKeepsSource`, A5). */
    readonly keepsSource: boolean;
    /** The editor's draft transition, which meets the draft as it is when a line joins. */
    readonly dispatch: (action: DraftAction) => void;
}

/** What the Ingredients section draws and calls. */
export interface PasteIntoIngredients {
    /** Whether Paste a list is offered: the editor offers it (D10), and no paste is still reading. */
    readonly available: boolean;
    readonly submit: (text: string) => void;
    /** The job is being created: the sheet's primary reads busy. */
    readonly submitting: boolean;
    /** The job could not be created: the sheet keeps the text and says so. */
    readonly failed: boolean;
    /** Forget a failed create (the sheet opened again). */
    readonly clearFailure: () => void;
    /** Counts the jobs accepted: the sheet closes when it moves. */
    readonly acceptedCount: number;
    /** The pasted lines not in the recipe yet, in paste order. */
    readonly reading: readonly PasteReadingRow[];
    /** The progress block over them, while a paste is unfinished and its job has been read. */
    readonly progress: PasteProgress | undefined;
    /** Ask again for the line whose lookup failed. */
    readonly retryLookup: () => void;
    /** Re-drive every retryable line of the paste (the service's retry is job-wide). */
    readonly retryParse: () => void;
    /** Join one line as the cook wrote it, through the add field's reader. */
    readonly addAsWritten: (lineIndex: number) => void;
    /** Join every line waiting on the cook as written. */
    readonly addRestAsWritten: () => void;
    /** Moves each time focus should land on the progress block: the cook acted and no waiting row remains. */
    readonly focusSignal: number;
    /** The refused Try again, said in the block: the retry itself failed, so the lines are still not re-driven. */
    readonly retryFailed: boolean;
    /** The waiting row whose action takes focus next (a level the row lowers through `onRowFocusHandled`). */
    readonly focusRow: number | undefined;
    readonly onRowFocusHandled: () => void;
    /** What the polite region says, at milestones only. */
    readonly announcement: PasteAnnouncement | undefined;
    /** How many ingredients the last finished paste added, said politely, once per paste. */
    readonly added: { readonly count: number; readonly occurrence: number } | undefined;
}

/** One paste, from its accepted job to its last line. */
interface PasteSession {
    readonly jobId: string;
    /** The lines the cook chose to add as written, by index. */
    readonly typedByCook: ReadonlySet<number>;
    /** How many lines, in paste order, have joined. */
    readonly done: number;
    /** The rows added so far. */
    readonly addedRows: number;
    /** The line whose lookup failed, by its index, until Try again. */
    readonly failedAt: number | undefined;
}

/** The paste in progress and what the last finished one said. */
interface PasteState {
    readonly session: PasteSession | undefined;
    readonly added: PasteIntoIngredients['added'];
}

/** A row as a draft line: the admitted food, the measure the parse read, and the source while it may be sent. */
function draftLineOf(
    admitted: ResolvedRecipeFormIngredient,
    row: PastedRow,
    sourceLine: string,
    keepsSource: boolean,
): ResolvedRecipeFormIngredient {
    const line = withLineMeasure(admitted, row.measure);

    if (!keepsSource) {
        return line;
    }

    return { ...line, sourceLine, ...(row.sourcePhrase === undefined ? {} : { sourcePhrase: row.sourcePhrase }) };
}

/**
 * Paste a list into the Ingredients section.
 *
 * @param options - Whether the recipe is stored, and the editor's draft transition.
 * @returns What the section draws and calls.
 * @sideEffect Creates a parse job, polls it, looks each line's foods up by name, and appends them to the draft.
 */
export function usePasteIntoIngredients(options: UsePasteIntoIngredientsOptions): PasteIntoIngredients {
    const { offered, keepsSource } = options;
    // The session and the count a finished paste says live in ONE state, so the join that finishes a paste ends the
    // session and records its count in the same pure update (a second `setState` inside an updater would not be pure).
    const [{ session, added }, setPasteState] = useState<PasteState>({ session: undefined, added: undefined });
    const setSession = (
        update: PasteSession | undefined | ((current: PasteSession | undefined) => PasteSession | undefined),
    ) =>
        setPasteState((state) => ({
            ...state,
            session: typeof update === 'function' ? update(state.session) : update,
        }));
    const [acceptedCount, setAcceptedCount] = useState(0);
    // The lines being joined, by `jobId:done`: a line of one paste is named by its job and its place in paste order, NOT
    // by the session object, which Add as written and Try again replace without moving `done`. Claiming the line once
    // keeps it from being joined twice, by a re-run effect included. A failed join releases its claim (Try again).
    const [claimed] = useState(() => new Set<string>());
    const create = useCreateParseJob({
        onSuccess: (job) => {
            setSession({ jobId: job.id, typedByCook: new Set(), done: 0, addedRows: 0, failedAt: undefined });
            setAcceptedCount((count) => count + 1);
        },
    });
    const poll = useParseJob(session?.jobId ?? '');
    const byName = useAddIngredientByName();
    const retryJob = useRetryParseJob();
    const withdraw = useWithdrawParseJobLines();
    const [focusSignal, setFocusSignal] = useState(0);
    const [focusRow, setFocusRow] = useState<number | undefined>(undefined);

    // The deadline's clock: one timer per job, which fires as its `expiresAt` passes, so an expired job's unread lines
    // join (the server's terminal, not a client limit). A render-time `Date.now()` would not do: a poll whose job has not
    // moved re-renders nothing, so the deadline would never be crossed.
    const [clock, setClock] = useState(() => Date.now());
    const expiresAt = session === undefined ? undefined : poll.data?.expiresAt;

    useEffect(() => {
        const deadline = expiresAt === undefined ? Number.NaN : Date.parse(expiresAt);

        if (!Number.isFinite(deadline)) {
            return undefined;
        }

        // ⚠️ Capped, because `setTimeout` treats a delay past 2^31 - 1 ms as zero; a later tick re-arms it.
        const timer = setTimeout(
            () => setClock(Date.now()),
            Math.min(2_147_483_647, Math.max(0, deadline + 1 - Date.now())),
        );

        return () => clearTimeout(timer);
    }, [expiresAt]);

    const lines: readonly PastedLine[] =
        session === undefined || poll.data === undefined
            ? []
            : pastedLinesOf({
                  job: poll.data,
                  // ⛔ Only a TERMINAL read failure ends the paste (the job is gone, or refused): a read that may work
                  // again — a service outage, the sandbox's nightly stop — keeps the lines where they were, because
                  // joining them all as written would make the cook's choice for them. The client's own retry policy
                  // is the one authority on which failures repeating cannot fix.
                  jobFailed: poll.isError && !shouldRetryRecipeServiceFailure(poll.error),
                  now: clock,
                  typedByCook: session.typedByCook,
              });
    const next = session === undefined || session.failedAt !== undefined ? undefined : lines[session.done];
    const nextSettledIndex = next?.kind === 'settled' ? next.lineIndex : undefined;

    /**
     * The join, as a Command: every food of one settled line looked up by name together, so a line joins whole or not
     * at all. Its answer is applied by the call that started it (below), which knows the line and the session.
     */
    const join = useMutation({
        mutationFn: (line: SettledPastedLine) =>
            Promise.all(
                line.rows.map(async (row) => ({
                    row,
                    ingredient: toIngredientLine(await byName.mutateAsync(row.name)),
                })),
            ),
    });

    /**
     * Start joining the next settled line, once per session (`claimed`), and apply its answer: the rows appended in
     * order and the paste advanced, or the line held as failed with the lines after it.
     *
     * ⚠️ A replaced paste's appends dispatch BEFORE the session guard below: the answer cannot know the paste was
     * replaced until it merges. The UI cannot reach that state (`available` needs `session === undefined`, so no
     * second paste starts while one is joining), and the guard still keeps the newer session's counters whole.
     *
     * @sideEffect Starts the join and, when it answers, dispatches the appends.
     */
    const joinNext = useEffectEvent((): void => {
        if (session === undefined || next?.kind !== 'settled') {
            return;
        }

        const claim = `${session.jobId}:${session.done}`;

        if (claimed.has(claim)) {
            return;
        }

        claimed.add(claim);
        const total = lines.length;
        const keepsSourceNow = keepsSource;

        // The session is still the step this join was started for: the same paste, not yet past this line.
        const stillThisStep = (current: PasteSession): boolean => `${current.jobId}:${current.done}` === claim;

        join.mutate(next, {
            onSuccess: (admitted, line) => {
                for (const { row, ingredient } of admitted) {
                    options.dispatch({
                        kind: 'appendResolvedIngredient',
                        key: mintLineKey(),
                        line: draftLineOf(ingredient, row, line.sourceLine, keepsSourceNow),
                    });
                }

                // A functional update: the answer merges into the session AS IT STANDS, so a choice the cook made while the
                // join was in flight (Add as written, Try again) is kept, and a paste that replaced this one (another job
                // id), or a session that has already moved past this line, is left alone. The closure supplies only the
                // job id, the line it joined and the line count, which never change.
                setPasteState((state) => {
                    const current = state.session;

                    if (current === undefined || !stillThisStep(current)) {
                        return state;
                    }

                    const done = current.done + 1;
                    const addedRows = current.addedRows + admitted.length;

                    return done >= total
                        ? {
                              session: undefined,
                              added: { count: addedRows, occurrence: (state.added?.occurrence ?? 0) + 1 },
                          }
                        : { ...state, session: { ...current, done, addedRows } };
                });
            },
            onError: (_error, line) => {
                claimed.delete(claim);
                // The same guard as the answer: a failure of a join for a paste that was replaced, or for a line the session
                // has already moved past, must not mark the newer state failed.
                setPasteState((state) => {
                    const current = state.session;

                    if (current === undefined || !stillThisStep(current)) {
                        return state;
                    }

                    return { ...state, session: { ...current, failedAt: line.lineIndex } };
                });
            },
        });
    });

    useEffect(() => {
        if (nextSettledIndex !== undefined) {
            joinNext();
        }
    }, [nextSettledIndex, session]);

    // The work waits for a connection: the join (a mutation) paused, a lookup inside it paused, or the poll paused.
    const waiting = join.isPaused || byName.isPaused || poll.fetchStatus === 'paused';
    const reading =
        session === undefined
            ? []
            : pasteRowsOf({ jobId: session.jobId, lines, done: session.done, failedAt: session.failedAt, waiting });
    const progress =
        session === undefined || reading.length === 0
            ? undefined
            : pasteProgressOf(reading, session.done, lines.length);
    const condition = progress === undefined ? undefined : pasteMilestoneOf(progress);
    const announcement = usePasteAnnouncement(
        session?.jobId,
        condition,
        progress === undefined ? 0 : progress.status.kind === 'needsYou' ? progress.status.count : progress.count,
    );

    /**
     * The cook chose to add these lines as written: each joins through the reader, the server is told to stop parsing
     * them, and focus follows to the next waiting row (the UX spec's preference) or, with none, to the progress block.
     *
     * @sideEffect Withdraws the lines from the parse job; best effort, a refusal changes nothing the cook sees.
     */
    const addAsWrittenAt = (lineIndexes: readonly number[]): void => {
        if (session === undefined) {
            return;
        }

        const waiting = reading.filter(
            (row) => (row.state === 'stalled' || row.state === 'retryable') && !lineIndexes.includes(row.lineIndex),
        );
        const last = Math.max(...lineIndexes);
        const nextWaiting = waiting.find((row) => row.lineIndex > last) ?? waiting[0];

        // A functional update: merge into the session AS IT STANDS, so a Try again or a join landing in the same batch
        // is not written back over. The closure is read only for the job id, which never changes within a session.
        setSession((current) =>
            current === undefined
                ? current
                : { ...current, typedByCook: new Set([...current.typedByCook, ...lineIndexes]) },
        );

        if (nextWaiting === undefined) {
            setFocusRow(undefined);
            setFocusSignal((signal) => signal + 1);
        } else {
            setFocusRow(nextWaiting.lineIndex);
        }

        if (lineIndexes.length > 0) {
            // Best effort: the choice stands whatever the server answers, so the only cost of a failure is a paid parse.
            withdraw.mutate({ id: session.jobId, lineIndexes });
        }
    };

    return {
        available: offered && session === undefined && !create.isPending,
        submit: (text) => create.mutate({ text }),
        submitting: create.isPending,
        failed: create.isError,
        clearFailure: () => create.reset(),
        acceptedCount,
        reading,
        progress,
        retryLookup: () =>
            setSession((current) => (current === undefined ? current : { ...current, failedAt: undefined })),
        retryParse: () => {
            if (session !== undefined) {
                // The press moves focus to the block (the control may go away); a refusal moves it again, onto the
                // failure the block now says.
                retryJob.mutate(session.jobId, { onError: () => setFocusSignal((signal) => signal + 1) });
                setFocusSignal((signal) => signal + 1);
            }
        },
        addAsWritten: (lineIndex) => addAsWrittenAt([lineIndex]),
        addRestAsWritten: () =>
            addAsWrittenAt(
                reading
                    .filter((row) => row.state === 'stalled' || row.state === 'retryable')
                    .map((row) => row.lineIndex),
            ),
        focusSignal,
        retryFailed: retryJob.isError,
        focusRow,
        onRowFocusHandled: () => setFocusRow(undefined),
        announcement,
        added,
    };
}
