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
} from '@kitchensink/recipe-service-client/hooks';
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
    /** Moves each time the cook acts on the paste, so focus can follow to the progress block. */
    readonly focusSignal: number;
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
    const [session, setSession] = useState<PasteSession | undefined>(undefined);
    const [acceptedCount, setAcceptedCount] = useState(0);
    // The sessions whose next line is being joined. A session object names one line of one paste (it is replaced as each
    // line joins), so claiming it once keeps a line from being joined twice, by a re-run effect included.
    const [claimed] = useState(() => new WeakSet<PasteSession>());
    const [added, setAdded] = useState<PasteIntoIngredients['added']>(undefined);
    const create = useCreateParseJob({
        onSuccess: (job) => {
            setSession({ jobId: job.id, typedByCook: new Set(), done: 0, addedRows: 0, failedAt: undefined });
            setAcceptedCount((count) => count + 1);
        },
    });
    const poll = useParseJob(session?.jobId ?? '');
    const byName = useAddIngredientByName();
    const retryJob = useRetryParseJob();
    const [focusSignal, setFocusSignal] = useState(0);

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
                  jobFailed: poll.isError,
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
     * @sideEffect Starts the join and, when it answers, dispatches the appends.
     */
    const joinNext = useEffectEvent((): void => {
        if (session === undefined || next?.kind !== 'settled' || claimed.has(session)) {
            return;
        }

        claimed.add(session);
        const from = session;
        const total = lines.length;
        const keepsSourceNow = keepsSource;

        join.mutate(next, {
            onSuccess: (admitted, line) => {
                for (const { row, ingredient } of admitted) {
                    options.dispatch({
                        kind: 'appendResolvedIngredient',
                        key: mintLineKey(),
                        line: draftLineOf(ingredient, row, line.sourceLine, keepsSourceNow),
                    });
                }

                const done = from.done + 1;
                const addedRows = from.addedRows + admitted.length;

                if (done >= total) {
                    setSession(undefined);
                    setAdded((previous) => ({ count: addedRows, occurrence: (previous?.occurrence ?? 0) + 1 }));

                    return;
                }

                setSession({ ...from, done, addedRows });
            },
            onError: (_error, line) =>
                setSession((current) => (current === undefined ? current : { ...current, failedAt: line.lineIndex })),
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

    /** The cook chose to add these lines as written: each joins through the reader, and focus follows to the block. */
    const addAsWrittenAt = (lineIndexes: readonly number[]): void => {
        setSession((current) =>
            current === undefined
                ? current
                : { ...current, typedByCook: new Set([...current.typedByCook, ...lineIndexes]) },
        );
        setFocusSignal((signal) => signal + 1);
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
                retryJob.mutate(session.jobId);
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
        announcement,
        added,
    };
}
