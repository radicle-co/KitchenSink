'use client';

/**
 * @module @commise/features-recipes/editor — Paste a list in the Ingredients section (blueprint A5 and A2, owner decision
 * D10, build spec §7.5.4): the paste's SESSION. It creates the parse job, polls it, projects its lines in paste order, and
 * keeps which of them have joined the draft. The flow ends inside the recipe, so no paste is ever left without a recipe
 * to land in.
 *
 * - **Offered while creating** (D10): until the recipe's first publish, as the editor says (`pasteOffered`).
 * - **The paste creates a parse job**, a write that cannot wait: offline it fails at once with the ordinary error
 *   (`useCreateParseJob`'s `networkMode`), never queued, because a paste that ran later would land in a recipe the cook
 *   has left.
 * - **This hook joins nothing.** ⛔ It used to look every settled line up BY NAME and append it, which bound a ranked
 *   guess (milk crackers for milk, ADR-0071), and that code is gone. `usePasteMatching` joins: it asks recipe-service for
 *   the job's matches and appends each line in paste order, bound only when the match is confident. This hook says which
 *   line is next in line (`lines`, `joined`), and is told when one has joined (`markJoined`).
 * - **The job outlives the session.** The session ends when the last line has joined; the job keeps being polled, because
 *   a food joined while its check was still running resolves later and the next read is how the cook's list learns it
 *   (the client's own poll policy stops when nothing is left to learn).
 * - **No time limit** (owner ruling 2026-10-13; plan 2026-10-15-011): each line says what the server reports it is doing.
 *   A line the server calls stalled, or that the system stopped trying, waits on the COOK: Add as written settles it
 *   through the add field's own reader, Add the rest as written does that for every such line, and Try again re-drives
 *   the whole paste. Only the server's own terminals (an expired or unreadable job) settle without the cook. Add as
 *   written also WITHDRAWS those lines from the parse job (`useWithdrawParseJobLines`), so the worker never spends an
 *   engine on an answer this client discards; the call is best effort and never holds the settling back.
 * - **The daily limit** (004 FR-022): a create refused with `IMPORT_QUOTA_EXCEEDED` has no job, so nothing is parsed or
 *   matched. The pasted lines still land: each settles through the reader, as written, and `quota` says when matching
 *   starts again. It is a notice, not a failure: the sheet closes.
 *
 * ⚠️ RESIDUAL: the lines still reading are not in the device draft (ADR-0057 keeps form values only), so closing the
 * editor mid-paste loses them. Recording a job in the draft would change the persisted format: a `staff-architect`
 * decision, not this hook's.
 *
 * @pattern Observer — over the parse job's poll
 * @pattern Adapter — the job to the pasted lines, through `pastedLines.ts`
 */
import { splitParseJobLines } from '@kitchensink/recipe-core';
import {
    useCreateParseJob,
    useParseJob,
    useRetryParseJob,
    useWithdrawParseJobLines,
} from '@kitchensink/recipe-service-client/hooks';
import {
    isImportQuotaExceededError,
    parseJobIsLive,
    shouldRetryRecipeServiceFailure,
} from '@kitchensink/recipe-service-client';
import type { ParseJobResponse } from '@kitchensink/schema-recipe';
import { useEffect, useState } from 'react';

import type { PasteReadingRow } from '../form/props.js';
import { pastedLinesOf, readerLinesOf, type PastedLine } from './pastedLines.js';
import { pasteRowsOf } from './pasteProgress.js';

/** Options for {@link usePasteIntoIngredients}. */
export interface UsePasteIntoIngredientsOptions {
    /** The editor offers paste (`pasteOffered`, D10). */
    readonly offered: boolean;
}

/** The daily limit's refusal: when matching starts again. */
export interface PasteQuota {
    /** ISO 8601. */
    readonly resetsAt: string;
}

/** What the Ingredients section draws and calls, and what the join queue reads. */
export interface PasteIntoIngredients {
    /** Whether Paste a list is offered: the editor offers it (D10), and no paste is still joining. */
    readonly available: boolean;
    readonly submit: (text: string) => void;
    /** The job is being created: the sheet's primary reads busy. */
    readonly submitting: boolean;
    /** The job could not be created: the sheet keeps the text and says so. A refused daily limit is not one. */
    readonly failed: boolean;
    /** Forget a failed create (the sheet opened again). */
    readonly clearFailure: () => void;
    /** Counts the pastes accepted (a job, or a refusal that lands the lines as written): the sheet closes when it moves. */
    readonly acceptedCount: number;
    /** The daily limit refused the last paste, or `undefined`. It stands until the next paste. */
    readonly quota: PasteQuota | undefined;
    /** The last accepted job's id, or `undefined` before one (and for a refused paste). It outlives the session. */
    readonly jobId: string | undefined;
    /** The job as last read. */
    readonly job: ParseJobResponse | undefined;
    /** The session's name: the job's id, or the refused paste's. A join is made for a session, never for the hook. */
    readonly sessionKey: string | undefined;
    /** The pasted lines of the session, in paste order; none once every line has joined. */
    readonly lines: readonly PastedLine[];
    /** The lines, by index, that have joined the draft. */
    readonly joined: ReadonlySet<number>;
    /** The line whose join failed, until Try again. */
    readonly failedAt: number | undefined;
    /** No match will come for this job: it expired, or the service says it is gone. */
    readonly matchesGone: boolean;
    /** The poll is waiting for a connection (from the query's own state). */
    readonly pollPaused: boolean;
    /** The line has joined with `rowsAdded` rows. A join for a session that has gone is ignored. */
    readonly markJoined: (sessionKey: string, lineIndex: number, rowsAdded: number) => void;
    /** The line's join failed. A failure for a session that has gone, or a line already joined, is ignored. */
    readonly markJoinFailed: (sessionKey: string, lineIndex: number) => void;
    /** Ask again for the line whose join failed. */
    readonly retryLookup: () => void;
    /** Re-drive every retryable line of the paste (the service's retry is job-wide). */
    readonly retryParse: () => void;
    /** Settle one line as the cook wrote it, through the add field's reader. */
    readonly addAsWritten: (lineIndex: number) => void;
    /** Settle every line waiting on the cook as written. */
    readonly addRestAsWritten: () => void;
    /** Moves each time focus should land on the progress block: the cook acted and no waiting row remains. */
    readonly focusSignal: number;
    /** The refused Try again, said in the block: the retry itself failed, so the lines are still not re-driven. */
    readonly retryFailed: boolean;
    /** The waiting row whose action takes focus next (a level the row lowers through `onRowFocusHandled`). */
    readonly focusRow: number | undefined;
    readonly onRowFocusHandled: () => void;
    /** How many ingredients the last finished paste added, said politely, once per paste. */
    readonly added: { readonly count: number; readonly occurrence: number } | undefined;
}

/** One paste, from its accepted job (or its refusal) to its last line. */
interface PasteSession {
    readonly key: string;
    /** The pasted lines when the paste has no job (the daily limit refused it). */
    readonly sourceLines: readonly string[] | undefined;
    /** The lines the cook chose to add as written, by index. */
    readonly typedByCook: ReadonlySet<number>;
    /** The lines that have joined. */
    readonly joined: ReadonlySet<number>;
    /** The rows added so far. */
    readonly addedRows: number;
    /** The line whose join failed, by its index, until Try again. */
    readonly failedAt: number | undefined;
}

/** The paste in progress and what the last finished one said. */
interface PasteState {
    readonly session: PasteSession | undefined;
    readonly added: PasteIntoIngredients['added'];
    readonly quota: PasteQuota | undefined;
}

/**
 * Paste a list into the Ingredients section.
 *
 * @param options - Whether paste is offered.
 * @returns What the section draws and calls, and what the join queue reads.
 * @sideEffect Creates a parse job and polls it.
 */
export function usePasteIntoIngredients(options: UsePasteIntoIngredientsOptions): PasteIntoIngredients {
    const { offered } = options;
    // The session, the quota notice and the count a finished paste says live in ONE state, so the join that finishes a
    // paste ends the session and records its count in the same pure update (a second `setState` inside an updater would
    // not be pure).
    const [{ session, added, quota }, setPasteState] = useState<PasteState>({
        session: undefined,
        added: undefined,
        quota: undefined,
    });
    const setSession = (
        update: PasteSession | undefined | ((current: PasteSession | undefined) => PasteSession | undefined),
    ) =>
        setPasteState((state) => ({
            ...state,
            session: typeof update === 'function' ? update(state.session) : update,
        }));
    const [acceptedCount, setAcceptedCount] = useState(0);
    // The last accepted job: it outlives the session, because the poll must go on while a joined food is still checked.
    const [jobId, setJobId] = useState<string | undefined>(undefined);
    const create = useCreateParseJob({
        onSuccess: (job) => {
            setJobId(job.id);
            setSession({
                key: job.id,
                sourceLines: undefined,
                typedByCook: new Set(),
                joined: new Set(),
                addedRows: 0,
                failedAt: undefined,
            });
            setAcceptedCount((count) => count + 1);
        },
    });
    const poll = useParseJob(jobId ?? '');
    const retryJob = useRetryParseJob();
    const withdraw = useWithdrawParseJobLines();
    const [focusSignal, setFocusSignal] = useState(0);
    const [focusRow, setFocusRow] = useState<number | undefined>(undefined);

    // The deadline's clock: one timer per job, which fires as its `expiresAt` passes, so an expired job's unread lines
    // settle (the server's terminal, not a client limit). A render-time `Date.now()` would not do: a poll whose job has
    // not moved re-renders nothing, so the deadline would never be crossed.
    const [clock, setClock] = useState(() => Date.now());
    const expiresAt = jobId === undefined ? undefined : poll.data?.expiresAt;

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

    // ⛔ Only a TERMINAL read failure ends the paste (the job is gone, or refused): a read that may work again — a service
    // outage, the sandbox's nightly stop — keeps the lines where they were, because settling them all as written would
    // make the cook's choice for them. The client's own retry policy is the one authority on which failures repeating
    // cannot fix.
    const jobFailed = poll.isError && !shouldRetryRecipeServiceFailure(poll.error);
    const job = jobId === undefined ? undefined : poll.data;
    const expired = job !== undefined && (job.status === 'expired' || !parseJobIsLive(job, clock));
    // A paste with no job (the daily limit) has nothing to match.
    const matchesGone = session !== undefined && session.sourceLines !== undefined ? true : jobFailed || expired;
    const lines: readonly PastedLine[] =
        session === undefined
            ? []
            : session.sourceLines !== undefined
              ? readerLinesOf(session.sourceLines)
              : job === undefined
                ? []
                : pastedLinesOf({ job, jobFailed, now: clock, typedByCook: session.typedByCook });
    // The rows the cook can act on, for the focus the actions below move (the Facade draws the rows themselves).
    const unjoinedRows =
        session === undefined
            ? []
            : pasteRowsOf({
                  jobId: session.key,
                  lines,
                  joined: session.joined,
                  failedAt: session.failedAt,
                  waiting: false,
              });

    /**
     * The line has joined: record it, and end the session with the last one.
     *
     * @sideEffect Updates the paste's state.
     */
    const markJoined = (sessionKey: string, lineIndex: number, rowsAdded: number): void => {
        const total = lines.length;

        // A functional update: the answer merges into the session AS IT STANDS, so a choice the cook made while the join
        // was in flight (Add as written, Try again) is kept, and a paste that replaced this one (another key), or a line
        // that has already joined, is left alone.
        setPasteState((state) => {
            const current = state.session;

            if (current?.key !== sessionKey || current.joined.has(lineIndex)) {
                return state;
            }

            const joinedLines = new Set([...current.joined, lineIndex]);
            const addedRows = current.addedRows + rowsAdded;

            return joinedLines.size >= total
                ? {
                      ...state,
                      session: undefined,
                      added: { count: addedRows, occurrence: (state.added?.occurrence ?? 0) + 1 },
                  }
                : { ...state, session: { ...current, joined: joinedLines, addedRows, failedAt: undefined } };
        });
    };

    const markJoinFailed = (sessionKey: string, lineIndex: number): void => {
        setPasteState((state) => {
            const current = state.session;

            if (current?.key !== sessionKey || current.joined.has(lineIndex)) {
                return state;
            }

            return { ...state, session: { ...current, failedAt: lineIndex } };
        });
    };

    /**
     * The cook chose to add these lines as written: each settles through the reader, the server is told to stop parsing
     * them, and focus follows to the next waiting row (the UX spec's preference) or, with none, to the progress block.
     *
     * @sideEffect Withdraws the lines from the parse job; best effort, a refusal changes nothing the cook sees.
     */
    const addAsWrittenAt = (lineIndexes: readonly number[]): void => {
        if (session === undefined || jobId === undefined) {
            return;
        }

        const waiting = unjoinedRows.filter(
            (row) => (row.state === 'stalled' || row.state === 'retryable') && !lineIndexes.includes(row.lineIndex),
        );
        const last = Math.max(...lineIndexes);
        const nextWaiting = waiting.find((row) => row.lineIndex > last) ?? waiting[0];

        // A functional update: merge into the session AS IT STANDS, so a Try again or a join landing in the same batch
        // is not written back over.
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
            withdraw.mutate({ id: jobId, lineIndexes });
        }
    };

    return {
        available: offered && session === undefined && !create.isPending,
        submit: (text) => {
            setPasteState((state) => ({ ...state, quota: undefined }));
            create.mutate(
                { text },
                {
                    onError: (error) => {
                        if (!isImportQuotaExceededError(error)) {
                            return;
                        }

                        // 004 FR-022: no job exists, so every line lands as written and the cook is told when matching
                        // starts again. The splitter is recipe-core's, the one the sheet counted the lines with.
                        setJobId(undefined);
                        setPasteState((state) => ({
                            ...state,
                            quota: { resetsAt: error.resetsAt },
                            session: {
                                key: `limit-${String(acceptedCount + 1)}`,
                                sourceLines: splitParseJobLines(text),
                                typedByCook: new Set(),
                                joined: new Set(),
                                addedRows: 0,
                                failedAt: undefined,
                            },
                        }));
                        setAcceptedCount((count) => count + 1);
                    },
                },
            );
        },
        submitting: create.isPending,
        failed: create.isError && !isImportQuotaExceededError(create.error),
        clearFailure: () => create.reset(),
        acceptedCount,
        quota,
        jobId,
        job,
        sessionKey: session?.key,
        lines,
        joined: session?.joined ?? new Set(),
        failedAt: session?.failedAt,
        matchesGone,
        pollPaused: poll.fetchStatus === 'paused',
        markJoined,
        markJoinFailed,
        retryLookup: () =>
            setSession((current) => (current === undefined ? current : { ...current, failedAt: undefined })),
        retryParse: () => {
            if (jobId !== undefined) {
                // The press moves focus to the block (the control may go away); a refusal moves it again, onto the
                // failure the block now says.
                retryJob.mutate(jobId, { onError: () => setFocusSignal((signal) => signal + 1) });
                setFocusSignal((signal) => signal + 1);
            }
        },
        addAsWritten: (lineIndex) => addAsWrittenAt([lineIndex]),
        addRestAsWritten: () =>
            addAsWrittenAt(
                unjoinedRows
                    .filter((row: PasteReadingRow) => row.state === 'stalled' || row.state === 'retryable')
                    .map((row) => row.lineIndex),
            ),
        focusSignal,
        retryFailed: retryJob.isError,
        focusRow,
        onRowFocusHandled: () => setFocusRow(undefined),
        added,
    };
}
