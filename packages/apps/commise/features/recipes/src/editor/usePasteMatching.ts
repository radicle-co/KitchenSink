'use client';

/**
 * @module @commise/features-recipes/editor — the Mediator between the paste's session (`usePasteIntoIngredients`),
 * recipe-service's MATCHES for the job's foods, and the draft (blueprint A2; ADR-0071; owner rulings 2026-10-25). It is
 * the one place that decides what joins the draft, when, and bound to what.
 *
 * - **It asks for matches** (`POST /matches`, idempotent, from the poll loop) when the set of unmatched parsed foods
 *   GROWS, never on every poll (`matchDemand.ts`), and remembers what it asked (`matchRequests.ts`): a food a call left
 *   unmade is asked for again, a bounded number of times; a failed call fails its foods for the cook to retry.
 * - **It joins lines in paste order, whole** (`pasteJoin.ts`): a line waits for its foods' matches, then every row joins
 *   at once. ONLY a confident match binds, by food admission (`useAddIngredientByFood`/`Variant`); every other row joins
 *   AS WRITTEN (`useCreateIngredient`), because a default is never selected for the cook (ADR-0070 section 5) and a
 *   doubtful or unmatched line needs the cook. ⛔ Nothing here looks a food up by name: that bound a ranked guess.
 * - **A checking line that later reads confident**, with nobody having bound it, is bound to the food the review
 *   confirmed — a DRAFT rebind, not the rebind command, because it is the server's bind and teaches nothing. ⛔ A late
 *   verdict never replaces a pick the cook made: the pick is a binding in the overlay, and a binding is only ever
 *   OFFERED to a line that holds none (`bindingOffered`); the line's note is derived from the wire every render.
 * - **The cook's pick** goes through the row editor's one commit port (`pickOnLine`), so a stored line is re-pointed by
 *   the rebind command and a draft line by its admission. Its pending send is raised INSIDE the press, its failure is
 *   kept whole in the send ledger, and Try again repeats the attempt that failed.
 * - **The overlay is memory.** ⛔ It is not persisted (ADR-0057 makes the draft format a one-way door and the job is not
 *   recorded in it): a reload keeps the lines as ordinary rows. A line the cook deletes is detected from the draft's
 *   keys and is never joined again.
 *
 * @pattern Mediator — between the paste session, the matches and the draft
 * @pattern Command — each join, each admission and each pick is a TanStack mutation or a replayable send
 * @pattern State — the overlay, the requests and the ledger are values moved by reducers
 * @pattern Idempotency guard — the joins and review binds started are claimed in a synchronous set, held in a ref on purpose
 */
import {
    useAddIngredientByFood,
    useAddIngredientByFoodVariant,
    useCreateIngredient,
    useProposeParseJobMatches,
} from '@kitchensink/recipe-service-client/hooks';
import type { ParseJobResponse } from '@kitchensink/schema-recipe';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useReducer, useRef, useState } from 'react';

import type { DraftAction, ResolvedRecipeFormIngredient } from '../form/draftAction.js';
import { isIngredientLineKey, type IngredientLineKey } from '../form/lineKey.js';
import { mintLineKey } from '../form/mintLineKey.js';
import {
    lineBindingOf,
    toIngredientLine,
    withLineMeasure,
    type BoundPick,
    type IngredientPick,
    type LineCommitOutcome,
} from '../hooks/lineCommit.js';
import type { SettledRowCommit } from '../hooks/useIngredientRowEditor.js';
import type { LinePick, MatchLine, PendingSend } from '../ingredientMatching/matchLine.js';
import { failedOf, pendingOf, retryOf, type SendAttempt, type SendLedger } from '../ingredientMatching/sendLedger.js';
import { shouldRequestMatches, unmatchedFoodRefsOf } from './matchDemand.js';
import { matchRequestFailures, requestedMatchKeys } from './matchRequests.js';
import { nextJoinOf, type NextJoin, type RowJoin } from './pasteJoin.js';
import { emptyPasteMatchHost, reducePasteMatchHost, type SavedPick } from './pasteMatchHost.js';
import { boundByOf, pasteMatchLinesOf } from './pasteMatchLines.js';
import { draftKeyOf, foodKeyOfDraft, type PasteMatchSession } from './pasteMatchSession.js';
import type { PastedRow } from './pastedLines.js';
import type { PasteIntoIngredients } from './usePasteIntoIngredients.js';

/** What the Mediator reads of the paste's session. */
export type PasteSessionView = Pick<
    PasteIntoIngredients,
    'jobId' | 'job' | 'sessionKey' | 'lines' | 'joined' | 'failedAt' | 'matchesGone' | 'markJoined' | 'markJoinFailed'
>;

/** Options for {@link usePasteMatching}. */
export interface UsePasteMatchingOptions {
    /** The paste's session: the job, the lines and which have joined. */
    readonly paste: PasteSessionView;
    /** A line joining now keeps its source for the create (`pastedLineKeepsSource`, A5). */
    readonly keepsSource: boolean;
    /** The editor's draft transition, which meets the draft as it is when an answer lands. */
    readonly dispatch: (action: DraftAction) => void;
    /** The row editor's one commit port for a pick on a line the paste owns (`pickFromPaste`). */
    readonly pickOnLine: (key: IngredientLineKey, pick: IngredientPick) => Promise<LineCommitOutcome>;
    /** The draft's line keys: a key that goes is a line the cook deleted. */
    readonly lineKeys: readonly string[];
    /** Whether a checking line that reads confident binds by itself (not once the recipe is published). */
    readonly autoBind: boolean;
    /** The draft lines the cook has opened in the one food picker (Change food): the paste list does not draw them. */
    readonly searching: ReadonlySet<string>;
    /** The row editor's last settled commit: a food found through the picker binds its line as the cook's. */
    readonly settled: SettledRowCommit | undefined;
    /** Open the one food picker on a draft line (`entry.beginChange`). */
    readonly beginSearch: (key: IngredientLineKey) => void;
    /** The cook-facing words for a server `reason` key (the host's localisation). */
    readonly reviewReasonOf: (reason: string) => string;
}

/** What the host reads and calls. */
export interface PasteMatching {
    readonly session: PasteMatchSession;
    /** Every food of the paste that joined the draft, in paste order, as the lines both flows draw. */
    readonly lines: readonly MatchLine[];
    /** The lines the paste list draws: every line but those the cook has opened in the food picker. */
    readonly drawn: readonly MatchLine[];
    /** The draft line keys the paste list draws, so the ordinary rows leave them out: no line is drawn twice. */
    readonly ownedKeys: ReadonlySet<string>;
    /** The sends in flight, by food key. */
    readonly pending: ReadonlyMap<string, PendingSend>;
    /** The foods whose last send did not save. */
    readonly failed: ReadonlySet<string>;
    /** The send ledger (a retry repeats the attempt it holds). */
    readonly ledger: SendLedger;
    /** A line is joining the draft. */
    readonly joining: boolean;
    /** Work is waiting for a connection (from the mutations' own state, never a connectivity read). */
    readonly paused: boolean;
    /** The food's draft key, for a host that needs to focus or open the row. */
    readonly draftKeyOfFood: (key: string) => string | undefined;
    /** The line the list has open. */
    readonly expandTo: (key: string | undefined) => void;
    /** The line the pane shows. */
    readonly moveTo: (key: string | undefined) => void;
    /** Pick a food, or keep the line as written. `tag` is the press's own, handed back in {@link PasteMatching.saved}. */
    readonly pick: (key: string, pick: LinePick, tag?: string) => void;
    /** Use this: bind the food under review as the cook's pick. */
    readonly useProposal: (key: string, tag?: string) => void;
    /** Try again on a pick that did not save: repeat the attempt that failed. */
    readonly retryPick: (key: string, tag?: string) => void;
    /** The last pick that saved, with the tag its press gave it: the view moves focus when it changes. */
    readonly saved: SavedPick | undefined;
    /** Try again on a food whose options did not load. */
    readonly retryOptions: (key: string) => void;
    /** Search for a food: open the one food picker on the line. */
    readonly search: (key: string) => void;
}

/** A checking line the review confirmed, and the food it confirmed. */
interface ReviewedTarget {
    readonly key: string;
    readonly draftKey: string;
    readonly proposed: { readonly kind: 'root' | 'variant'; readonly id: string; readonly name: string };
    readonly reason: string;
}

/** One food of the job, or `undefined`. Pure. */
function wireFoodOf(job: ParseJobResponse | undefined, key: string) {
    const [lineIndex, foodIndex] = key.split(':').map(Number);

    return job?.lines.find((line) => line.lineIndex === lineIndex)?.proposal?.foods[foodIndex ?? -1];
}

/** A row as a draft line: the admitted food, the measure the parse read, and the source while it may be sent. */
function draftLineOf(
    admitted: ResolvedRecipeFormIngredient,
    row: PastedRow,
    sourceLine: string,
    keepsSource: boolean,
): ResolvedRecipeFormIngredient {
    const measured = withLineMeasure(admitted, row.measure);
    const line = {
        ...measured,
        ...(row.displayText === undefined ? {} : { displayText: row.displayText }),
        ...(row.note === undefined ? {} : { note: row.note }),
    };

    if (!keepsSource) {
        return line;
    }

    return { ...line, sourceLine, ...(row.sourcePhrase === undefined ? {} : { sourcePhrase: row.sourcePhrase }) };
}

/** The pick an attempt carries as the line shows it. Pure. */
function linePickOf(attempt: SendAttempt): LinePick {
    return attempt.kind === 'pick'
        ? attempt.pick
        : { kind: 'food', foodId: attempt.food.foodId, name: attempt.food.name };
}

/**
 * Match the paste's foods, join its lines, and carry the cook's picks.
 *
 * @param options - The paste's session, the draft's transition, the commit port and what the row editor knows.
 * @returns The overlay's lines and the commands the list calls.
 * @sideEffect Asks for matches, admits foods, appends lines to the draft and rebinds them.
 */
export function usePasteMatching(options: UsePasteMatchingOptions): PasteMatching {
    const { paste } = options;
    const addByFood = useAddIngredientByFood();
    const addByFoodVariant = useAddIngredientByFoodVariant();
    const createFreeform = useCreateIngredient();
    const propose = useProposeParseJobMatches();
    const [host, hostDispatch] = useReducer(reducePasteMatchHost, emptyPasteMatchHost);
    const { session, requests, ledger } = host;
    const { job, jobId } = paste;
    // The joins and bindings started, by id: claiming one keeps a re-run of the effect that starts it from doing it twice.
    //
    // @pattern Idempotency guard — a synchronous claim set, held in a ref on purpose. A claim must be visible to the very
    // next call, before any render: an effect the framework runs again against the same render's values (Fast Refresh, a
    // remount with the same deps) would otherwise meet a claim still sitting in a dispatch queue, and join the line twice,
    // which is a duplicated ingredient. Nothing renders from it, so it is not state. It is cleared with each new job (the
    // effect below, declared before the effects that claim), so a finished job's ids never linger. ⚠️ Tests cannot drive a
    // same-commit replay, so this is justified by that reasoning, not by a red test.
    const claimed = useRef(new Set<string>());
    useEffect(() => {
        claimed.current.clear();
    }, [jobId]);

    // A new paste starts clean: its food keys (`lineIndex:foodIndex`) repeat from job to job, so nothing of the old
    // job's overlay, requests or sends may meet them, and an answer that arrives for the old job is dropped by the
    // reducer. Lines it left in the draft keep their text and become ordinary rows. Adjusted during render.
    if (host.jobId !== jobId) {
        hostDispatch({ type: 'jobStarted', jobId });
    }

    // A line the cook deletes: a draft key present on the previous render and gone now. Terminal (`removed`). A key the
    // overlay joined but the draft has not shown yet was never present, so it is never taken for a removal.
    const keysSignature = options.lineKeys.join('\n');
    const [seenKeys, setSeenKeys] = useState({ signature: keysSignature, keys: options.lineKeys });

    if (seenKeys.signature !== keysSignature) {
        setSeenKeys({ signature: keysSignature, keys: options.lineKeys });

        for (const draftKey of seenKeys.keys.filter((each) => !options.lineKeys.includes(each))) {
            hostDispatch({ type: 'overlay', jobId, event: { type: 'draftLineRemoved', draftKey } });
        }
    }

    // A food found through the one picker and committed binds its line as the cook's pick.
    const [seenSettled, setSeenSettled] = useState(options.settled);

    if (options.settled !== seenSettled) {
        setSeenSettled(options.settled);
        const { settled } = options;
        const food = settled?.target.kind === 'line' ? foodKeyOfDraft(session, settled.target.key) : undefined;

        if (settled?.origin.kind === 'entry' && settled.outcome.kind === 'committed' && food !== undefined) {
            const { binding } = settled.outcome;

            hostDispatch({
                type: 'overlay',
                jobId,
                event: {
                    type: 'bindingSet',
                    key: food,
                    binding: {
                        boundBy: 'cook',
                        // A line the picker kept AS WRITTEN names no food: it is not matched and counts no nutrition.
                        pick:
                            binding.foodId === undefined
                                ? { kind: 'asWritten' }
                                : { kind: 'food', foodId: binding.foodId, name: binding.name ?? '' },
                        reviewNote: undefined,
                    },
                },
            });
        }
    }

    // Foods whose options will not come: their request failed, or the job can no longer match (expired, unreadable). Both
    // draw the failed-options line (Try again, Search, Keep as written), never a "Use this" with nothing to use.
    const unmatched = job === undefined ? [] : unmatchedFoodRefsOf(job);
    const optionsFailed: ReadonlySet<string> = paste.matchesGone
        ? new Set([...matchRequestFailures(requests), ...unmatched.map((food) => food.key)])
        : matchRequestFailures(requests);

    // ── Asking for matches ──────────────────────────────────────────────────────────────────────────────────────
    const wantsMatches =
        jobId !== undefined &&
        host.jobId === jobId &&
        !paste.matchesGone &&
        shouldRequestMatches(requestedMatchKeys(requests), unmatched, requests.inFlight !== undefined);
    const requestMatches = useEffectEvent((): void => {
        if (jobId === undefined) {
            return;
        }

        hostDispatch({ type: 'requests', jobId, event: { type: 'sent', keys: unmatched.map((food) => food.key) } });
        propose.mutate(jobId, {
            onSuccess: (answer) =>
                hostDispatch({
                    type: 'requests',
                    jobId,
                    event: {
                        type: 'answered',
                        unmatched: new Set(unmatchedFoodRefsOf(answer).map((food) => food.key)),
                    },
                }),
            onError: () => hostDispatch({ type: 'requests', jobId, event: { type: 'refused' } }),
        });
    });

    useEffect(() => {
        if (wantsMatches) {
            requestMatches();
        }
    }, [wantsMatches]);

    // ── Joining lines, in paste order ───────────────────────────────────────────────────────────────────────────
    const next =
        paste.sessionKey === undefined
            ? undefined
            : nextJoinOf({
                  lines: paste.lines,
                  job,
                  joined: paste.joined,
                  optionsFailed,
                  matchesGone: paste.matchesGone,
                  failedAt: paste.failedAt,
              });
    const joinId = next === undefined ? undefined : `${paste.sessionKey ?? ''}:${String(next.lineIndex)}`;

    /** A row admitted: bound to the food a confident match named, or created as written. */
    const admit = (rowJoin: RowJoin): Promise<ResolvedRecipeFormIngredient> => {
        const admitted =
            rowJoin.kind === 'bound'
                ? rowJoin.food.variant
                    ? addByFoodVariant.mutateAsync(rowJoin.food.id)
                    : addByFood.mutateAsync(rowJoin.food.id)
                : createFreeform.mutateAsync(rowJoin.row.name);

        return admitted.then(toIngredientLine);
    };

    /** The join, as a Command: every row of one line admitted together, so a line joins whole or not at all. */
    const join = useMutation({
        mutationFn: (step: NextJoin) =>
            Promise.all(step.rows.map(async (rowJoin) => ({ rowJoin, line: await admit(rowJoin) }))),
    });
    const joinNext = useEffectEvent((): void => {
        const sessionKey = paste.sessionKey;

        if (sessionKey === undefined || next === undefined || joinId === undefined || claimed.current.has(joinId)) {
            return;
        }

        claimed.current.add(joinId);
        const { keepsSource } = options;

        join.mutate(next, {
            onSuccess: (admitted, step) => {
                for (const { rowJoin, line } of admitted) {
                    const draftKey = mintLineKey();

                    options.dispatch({
                        kind: 'appendResolvedIngredient',
                        key: draftKey,
                        line: draftLineOf(line, rowJoin.row, step.sourceLine, keepsSource),
                    });

                    if (rowJoin.key !== undefined) {
                        hostDispatch({
                            type: 'overlay',
                            jobId,
                            event: { type: 'lineJoined', key: rowJoin.key, draftKey },
                        });
                    }

                    if (rowJoin.kind === 'bound' && rowJoin.key !== undefined) {
                        hostDispatch({
                            type: 'overlay',
                            jobId,
                            event: {
                                type: 'bindingSet',
                                key: rowJoin.key,
                                binding: {
                                    boundBy: rowJoin.boundBy,
                                    pick: { kind: 'food', foodId: rowJoin.food.id, name: rowJoin.food.name },
                                },
                            },
                        });
                    }
                }

                paste.markJoined(sessionKey, step.lineIndex, admitted.length);
            },
            onError: (_error, step) => {
                claimed.current.delete(joinId);
                paste.markJoinFailed(sessionKey, step.lineIndex);
            },
        });
    });

    useEffect(() => {
        if (joinId !== undefined) {
            joinNext();
        }
    }, [joinId]);

    // ── A checking line that the review confirmed ───────────────────────────────────────────────────────────────
    const reviewed: readonly ReviewedTarget[] = options.autoBind
        ? [...session.joins].flatMap(([key, entry]) => {
              const match = wireFoodOf(job, key)?.match;

              return entry.status === 'joined' &&
                  match?.state === 'confident' &&
                  match.proposed !== null &&
                  !session.bindings.has(key) &&
                  !ledger.has(key)
                  ? [{ key, draftKey: entry.draftKey, proposed: match.proposed, reason: match.reason }]
                  : [];
          })
        : [];
    const reviewedKey = reviewed[0]?.key;
    const bindReviewed = useEffectEvent((): void => {
        const target = reviewed[0];

        if (target === undefined || jobId === undefined || claimed.current.has(`review:${jobId}:${target.key}`)) {
            return;
        }

        claimed.current.add(`review:${jobId}:${target.key}`);
        const food = { foodId: target.proposed.id, name: target.proposed.name };

        hostDispatch({
            type: 'ledger',
            jobId,
            event: { type: 'started', key: target.key, attempt: { kind: 'useProposal', food } },
        });
        const admitted =
            target.proposed.kind === 'variant'
                ? addByFoodVariant.mutateAsync(target.proposed.id)
                : addByFood.mutateAsync(target.proposed.id);

        // The reducer offers the binding to a line nobody has bound, and re-points the draft line only then: a pick the
        // cook made while this was in flight stands (ADR-0071 section 9). The pick is the WIRE's food (the id the
        // candidates carry), not the admitted ingredient's own.
        void admitted.then(
            (ingredient) =>
                hostDispatch({
                    type: 'reviewAdmitted',
                    jobId,
                    key: target.key,
                    binding: {
                        boundBy: boundByOf(target.reason),
                        pick: { kind: 'food', foodId: target.proposed.id, name: target.proposed.name },
                    },
                    draft: lineBindingOf(toIngredientLine(ingredient)),
                }),
            () => hostDispatch({ type: 'ledger', jobId, event: { type: 'failed', key: target.key } }),
        );
    });

    useEffect(() => {
        if (reviewedKey !== undefined) {
            bindReviewed();
        }
    }, [reviewedKey]);

    // ── A binding the server offered that the wire no longer shows ───────────────────────────────────────────────
    // The paste never looks matched when the saved line would ask: a held server or review binding on a food whose match
    // no longer reads confident is withdrawn, and its draft line goes back to the food as written. The cook's pick stays.
    const withdrawn = [...session.joins].flatMap(([key, entry]) => {
        const match = wireFoodOf(job, key)?.match;
        const held = session.bindings.get(key);

        return entry.status === 'joined' &&
            match != null &&
            match.state !== 'confident' &&
            held?.boundBy !== 'cook' &&
            held !== undefined
            ? [key]
            : [];
    });
    const withdrawnKey = withdrawn[0];
    const withdrawOffer = useEffectEvent((): void => {
        if (
            withdrawnKey === undefined ||
            jobId === undefined ||
            claimed.current.has(`withdraw:${jobId}:${withdrawnKey}`)
        ) {
            return;
        }

        claimed.current.add(`withdraw:${jobId}:${withdrawnKey}`);
        void createFreeform.mutateAsync(wireFoodOf(job, withdrawnKey)?.name ?? '').then(
            (ingredient) =>
                hostDispatch({
                    type: 'offerWithdrawn',
                    jobId,
                    key: withdrawnKey,
                    draft: lineBindingOf(toIngredientLine(ingredient)),
                }),
            () => claimed.current.delete(`withdraw:${jobId}:${withdrawnKey}`),
        );
    });

    useEffect(() => {
        if (withdrawnKey !== undefined) {
            withdrawOffer();
        }
    }, [withdrawnKey]);

    // The draft line the reducer earned a re-point for: applied, then cleared.
    const rebinds = host.rebinds;
    const applyRebinds = useEffectEvent((): void => {
        for (const [key, binding] of rebinds) {
            const draftKey = draftKeyOf(session, key);

            if (draftKey !== undefined && isIngredientLineKey(draftKey)) {
                options.dispatch({ kind: 'rebindIngredient', key: draftKey, binding });
            }

            hostDispatch({ type: 'rebindApplied', key });
        }
    });

    useEffect(() => {
        if (rebinds.size > 0) {
            applyRebinds();
        }
    }, [rebinds]);

    // ── The cook's sends ────────────────────────────────────────────────────────────────────────────────────────
    /** What a pick commits as: a food by its kind, or the food's own words as written. Pure. */
    const boundPickOf = (key: string, attempt: SendAttempt): BoundPick => {
        const pick = linePickOf(attempt);

        if (pick.kind === 'asWritten') {
            return { kind: 'declared', text: wireFoodOf(job, key)?.name ?? '' };
        }

        const candidate = wireFoodOf(job, key)?.match?.candidates.find((each) => each.id === pick.foodId);

        return candidate?.kind === 'variant'
            ? { kind: 'catalogVariant', foodVariantId: pick.foodId }
            : { kind: 'catalogFood', foodId: pick.foodId, name: pick.name };
    };

    /**
     * Send an attempt for a food. The pending send is raised in this call, inside the press, so the next render already
     * refuses a second one.
     *
     * @sideEffect Commits the pick through the row editor's port.
     */
    const run = (key: string, attempt: SendAttempt, tag: string | undefined): void => {
        const draftKey = draftKeyOf(session, key);

        if (
            draftKey === undefined ||
            jobId === undefined ||
            !isIngredientLineKey(draftKey) ||
            ledger.get(key)?.pending !== undefined
        ) {
            return;
        }

        hostDispatch({ type: 'ledger', jobId, event: { type: 'started', key, attempt } });
        const failed = (): void => hostDispatch({ type: 'ledger', jobId, event: { type: 'failed', key } });

        void options
            .pickOnLine(draftKey, boundPickOf(key, attempt))
            .then(
                (outcome) =>
                    outcome.kind === 'committed'
                        ? hostDispatch({ type: 'pickSaved', jobId, key, attempt, tag })
                        : failed(),
                failed,
            );
    };

    const lines: readonly MatchLine[] =
        job === undefined
            ? []
            : pasteMatchLinesOf({ job, session, optionsFailed, reviewReasonOf: options.reviewReasonOf });
    const drawn = lines.filter((line) => !options.searching.has(draftKeyOf(session, line.key) ?? ''));

    return {
        session,
        lines,
        drawn,
        ownedKeys: new Set(drawn.flatMap((line) => draftKeyOf(session, line.key) ?? [])),
        pending: pendingOf(ledger),
        failed: failedOf(ledger),
        ledger,
        joining: join.isPending,
        paused:
            join.isPaused ||
            addByFood.isPaused ||
            addByFoodVariant.isPaused ||
            createFreeform.isPaused ||
            propose.isPaused,
        draftKeyOfFood: (key) => draftKeyOf(session, key),
        expandTo: (key) => hostDispatch({ type: 'overlay', jobId, event: { type: 'expanded', key } }),
        moveTo: (key) => hostDispatch({ type: 'overlay', jobId, event: { type: 'paneMoved', key } }),
        pick: (key, pick, tag) => run(key, { kind: 'pick', pick }, tag),
        useProposal: (key, tag) => {
            const proposed = wireFoodOf(job, key)?.match?.proposed;

            if (proposed !== null && proposed !== undefined) {
                run(key, { kind: 'useProposal', food: { foodId: proposed.id, name: proposed.name } }, tag);
            }
        },
        retryPick: (key, tag) => {
            const attempt = retryOf(ledger, key);

            if (attempt !== undefined) {
                run(key, attempt, tag);
            }
        },
        saved: host.saved,
        retryOptions: (key) => hostDispatch({ type: 'requests', jobId, event: { type: 'retry', key } }),
        search: (key) => {
            const draftKey = draftKeyOf(session, key);

            if (draftKey !== undefined && isIngredientLineKey(draftKey)) {
                options.beginSearch(draftKey);
            }
        },
    };
}
