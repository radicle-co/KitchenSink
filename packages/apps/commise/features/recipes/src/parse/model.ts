/**
 * @module @commise/features-recipes/parse — the CLIENT-side model for the paste-and-review ingredient
 * parse surface (plan U9, origin D9/R13): the state space a parse job can be in, the progress it reports,
 * and the one projection of each line both platform leaves render.
 *
 * **Design pattern: discriminated union + exhaustive switch (Visitor, satisfied by the language), over pure
 * projections.** Both leaves render {@link ParseJobViewState} with an exhaustive `switch` instead of
 * re-deriving the state from raw query flags — the shape `IngredientResolverViewState`,
 * `RecipeNutritionViewState` and `CorrectionViewState` already use. A new member is a COMPILE error at the
 * leaves rather than a silently blank screen.
 *
 * ⛔ NOTHING HERE RE-DECLARES A WIRE SHAPE (§15 / ADR-0014). Every job, line and proposal type is imported
 * from `@kitchensink/recipe-service-client`, which re-exports the generated contract.
 *
 * ## ⛔ THREE FACTS ABOUT THE SERVER THAT THIS MODULE EXISTS TO GET RIGHT
 *
 * Each is easy to read backwards from the wire alone, and each was verified in the service's own source
 * rather than inferred:
 *
 *  1. **`partial` is NOT terminal, so it is `settling`, not `failed`.** `ParseJobsService.enqueueOrMark`
 *     marks every line in a failed `SendMessageBatch` call `failed_retryable` — and `sqsBatchQueue`
 *     collects failures across ALL batches and throws once at the end, so lines whose messages really did
 *     send are marked too. Those land anyway (the worker's landing `UPDATE` is guarded on the digest, with
 *     NO status predicate), each flipping its line to `parsed` and re-running the aggregate, which admits
 *     `partial`. A `partial` job therefore walks itself toward `complete` with no retry pressed, which is
 *     why its copy says the lines "may still finish on their own" instead of announcing a failure.
 *
 *  2. **Expiry is the TIMESTAMP, not the status.** The TTL sweep rides a 15-minute tick while
 *     `ParseJobsDal.gateMutation` refuses a mutation the instant `expires_at <= now()`. So for up to a
 *     quarter of an hour a `GET` answers `running` on a job whose `retry` and `editLine` both `409`. A
 *     status-only reading would render a live job and offer controls the server has already stopped
 *     honouring. `expiresAt` is on the wire precisely so a client can know this — the sweep's own docstring
 *     says the `202` carries it "so the client knows the review deadline".
 *
 *  3. **A `running` job has no server-side terminal bound short of the 24-hour TTL.** A message that
 *     exhausts `maxReceiveCount` and lands in the DLQ leaves its line `pending` forever, and the
 *     aggregate's first arm KEEPS the job's status while any line is pending. Without
 *     {@link PARSE_JOB_STALL_BOUND_MS} a cook would watch a spinner for a day with no explanation and no
 *     control. `stalled` does NOT stop the poll — a legitimately slow job must still be able to finish on
 *     screen — it only tells the truth and surfaces the two things that can help.
 *
 * ## ⛔ WHAT THIS SURFACE DELIBERATELY DOES NOT DO: hand a proposal to the recipe form
 *
 * R19 is that a parse binds nothing — `parseProposalFoodSchema` carries a `name` and a `prep` and NO food
 * id, by construction, pinned by the service's own `parseJobs.schema.test.ts`. And the recipe form's only
 * append transition is `appendResolvedIngredient`, which `form/props.ts` records as being unable to express
 * an unresolved line at all: *"a container appending a line the cook never picked is a COMPILE error"*.
 *
 * So the handoff is not a missing wire-up, it is a collision between two settled invariants: carrying a
 * proposal into the editor needs either every proposed name resolved through the picker first, or exactly
 * the unresolved-row capability U28 removed. Both are product decisions. ⛔ Do NOT "just add"
 * `appendUnresolvedIngredient` — that quietly reopens U28. The review surface terminates at review.
 */
import {
    MAX_PARSE_JOB_LINES,
    PARSE_JOB_LINE_MAX_CHARS,
    refuseParseJobLines,
    splitParseJobLines,
} from '@kitchensink/recipe-core';
import { isNotFoundError, isParseJobExpiredError, parseJobIsLive } from '@kitchensink/recipe-service-client';
import type {
    ParseJobLineStatus,
    ParseJobLineView,
    ParseJobResponse,
    ParseProposalFood,
} from '@kitchensink/recipe-service-client';
import type { Locale } from '@commise/i18n';

import { formatQuantity } from '../detail/model.js';
import { fillTemplate } from '../list/model.js';
import type { RecipeParseMessages } from './messages.js';

/**
 * How long a job may sit `running` before the surface says so.
 *
 * ⚠️ AN ESTIMATE, NOT A MEASUREMENT, and the residual risk is recorded rather than hidden: no production
 * parse-job timing exists yet, and the honest inputs are a CRF Lambda's cold start, the queue's depth, and
 * a ceiling of `MAX_PARSE_JOB_LINES` (200) one-message-per-line invocations. Three minutes is generous
 * against a plausible worst case while being far inside a cook's patience.
 *
 * ⛔ Guessing LOW is deliberately made harmless: crossing this bound changes the SENTENCE, never the poll.
 * A slow-but-healthy job keeps polling and still completes on screen, so the cost of a misfire is one
 * honest "this is taking longer than usual" — not a stranded surface.
 */
export const PARSE_JOB_STALL_BOUND_MS = 180_000;

// ── Submission ────────────────────────────────────────────────────────────────────────────────────

/** What the paste form renders about the text a cook has typed so far. */
export interface ParseSubmissionModel {
    /** Admissible lines the job would actually store — the SPLITTER's count, not the raw newline count. */
    readonly lineCount: number;
    /** Every reason the paste would be refused, localized, in line order. Empty when it is admissible. */
    readonly refusals: readonly string[];
    /** Whether the submit control may fire. */
    readonly canSubmit: boolean;
}

/**
 * Project a pasted block into what the form should say about it, BEFORE any round trip.
 *
 * ⚠️ NOT A SECOND VALIDATOR. `RecipeServiceClient.createParseJob` already refuses an inadmissible paste
 * with no network call, using this same shared `refuseParseJobLines`. What this adds is the half a
 * transport cannot: telling the cook WHICH line is the problem, in their own locale, while they can still
 * fix it — the schema's `superRefine` messages are English server strings that never reach a UI.
 *
 * ⛔ The line number is reported 1-BASED. The wire counts from zero and a cook counts from one; handing
 * someone "line 4" for the fifth line of their paste is a bug they will spend minutes on.
 *
 * @param text - The raw pasted text.
 * @param messages - The resolved parse copy for the active locale.
 * @returns The count, the localized refusals, and whether submission may proceed. Pure.
 */
export function toParseSubmissionModel(text: string, messages: RecipeParseMessages): ParseSubmissionModel {
    const lines = splitParseJobLines(text);
    const refusals = refuseParseJobLines(lines).map((refusal) => {
        switch (refusal.reason) {
            case 'line_too_long':
                return fillTemplate(messages.refusalLineTooLong, {
                    line: refusal.lineIndex + 1,
                    max: PARSE_JOB_LINE_MAX_CHARS,
                });
            case 'too_many_lines':
                return fillTemplate(messages.refusalTooManyLines, { max: MAX_PARSE_JOB_LINES });
            case 'no_lines':
                return messages.refusalNoLines;
        }
    });

    return { lineCount: lines.length, refusals, canSubmit: refusals.length === 0 };
}

// ── Progress ──────────────────────────────────────────────────────────────────────────────────────

/** How far a job has got, counted from its lines rather than trusted from a server-side tally. */
export interface ParseJobProgress {
    readonly total: number;
    readonly parsed: number;
    readonly unparseable: number;
    readonly retryable: number;
    readonly pending: number;
    /**
     * Lines that have reached a VERDICT — `parsed` plus `unparseable`.
     *
     * ⛔ A `failed_retryable` line is NOT settled. It is outstanding work whose message was lost or whose
     * parse failed transiently, and counting it toward progress would tell a cook a job had finished
     * reading lines it has not read.
     */
    readonly settled: number;
}

/**
 * Count a job's lines by status. Pure.
 *
 * @param job - The job view.
 * @returns The per-status tally plus the settled count.
 */
export function toParseJobProgress(job: ParseJobResponse): ParseJobProgress {
    const countOf = (status: ParseJobLineStatus): number => job.lines.filter((line) => line.status === status).length;
    const parsed = countOf('parsed');
    const unparseable = countOf('unparseable');

    return {
        total: job.lines.length,
        parsed,
        unparseable,
        retryable: countOf('failed_retryable'),
        pending: countOf('pending'),
        settled: parsed + unparseable,
    };
}

// ── The view state ────────────────────────────────────────────────────────────────────────────────

/**
 * Every state the review surface can be in.
 *
 * `settling` and `stalled` are the two members a reader would not predict from the wire enum, and each has
 * its own entry in the module docstring. `expired` carries an OPTIONAL job because it is reachable two
 * ways: from a poll that observed the deadline, and from a mutation the server refused with
 * `ParseJobExpiredError` before any view was in hand.
 */
export type ParseJobViewState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'running'; readonly job: ParseJobResponse; readonly progress: ParseJobProgress }
    | { readonly kind: 'stalled'; readonly job: ParseJobResponse; readonly progress: ParseJobProgress }
    | { readonly kind: 'settling'; readonly job: ParseJobResponse; readonly progress: ParseJobProgress }
    | { readonly kind: 'ready'; readonly job: ParseJobResponse; readonly progress: ParseJobProgress }
    | { readonly kind: 'expired'; readonly job: ParseJobResponse | undefined }
    | { readonly kind: 'missing' }
    | { readonly kind: 'failed' };

/** Everything the state decision reads. Time enters as a PARAMETER so the projection stays pure. */
export interface ParseJobViewStateInput {
    /** The latest job view, or `undefined` before the first one lands. */
    readonly job: ParseJobResponse | undefined;
    /** The latest query/mutation error, or `undefined`. */
    readonly error: unknown;
    /** Epoch milliseconds "now" — never `Date.now()` inside, so every boundary here is table-testable. */
    readonly now: number;
    /** Epoch milliseconds at which the surface began waiting on the CURRENT run (reset by a retry/edit). */
    readonly runningSince: number;
}

/**
 * Fold the wire status, the review deadline, the elapsed wait and any error into ONE state.
 *
 * ⛔ THE JOB OUTRANKS THE ERROR, and that ordering is load-bearing rather than arbitrary. TanStack keeps
 * the last `error` alongside fresh `data` once a refetch succeeds, so reading the error first would pin a
 * recovered surface on its failure screen for the rest of the session — a poll that healed would look
 * permanently broken.
 *
 * @param input - The job, the error, and the two timestamps.
 * @returns The single state a leaf switches over. Pure and TOTAL.
 */
export function toParseJobViewState(input: ParseJobViewStateInput): ParseJobViewState {
    const { job, error, now, runningSince } = input;

    if (job !== undefined) {
        // Rule 2 of the module docstring: the deadline decides, not the stored status. `parseJobIsLive`
        // fails CLOSED on a timestamp it cannot read, so an unparseable `expiresAt` reads as expired rather
        // than as infinitely far away.
        if (job.status === 'expired' || !parseJobIsLive(job, now)) {
            return { kind: 'expired', job };
        }

        const progress = toParseJobProgress(job);

        switch (job.status) {
            case 'complete':
                return { kind: 'ready', job, progress };
            case 'partial':
                return { kind: 'settling', job, progress };
            case 'running':
                return now - runningSince > PARSE_JOB_STALL_BOUND_MS
                    ? { kind: 'stalled', job, progress }
                    : { kind: 'running', job, progress };
        }
    }

    if (error !== undefined && error !== null) {
        if (isParseJobExpiredError(error)) {
            return { kind: 'expired', job: undefined };
        }

        // ⛔ A stranger's job and an absent one are ONE answer by design — a `403` would confirm the id
        // exists. Rendering this as an authorization failure would leak exactly what the `404` hides.
        return isNotFoundError(error) ? { kind: 'missing' } : { kind: 'failed' };
    }

    return { kind: 'loading' };
}

// ── One line ──────────────────────────────────────────────────────────────────────────────────────

/**
 * How a line's status should be presented.
 *
 * ⛔ `unparseable` and `failed_retryable` MUST NOT share a tone. `unparseable` is terminal — the validator
 * loop exhausted — while `retry` re-drives exactly the `failed_retryable` population. Rendering them alike
 * would put one control in front of two outcomes, provably doing nothing for half of them.
 */
export type ParseLineTone = 'progress' | 'success' | 'warning' | 'error';

/** What a leaf renders for one submitted line. */
export interface ParseLineModel {
    /** The WIRE index (0-based) — what `PATCH /{id}/lines/{lineIndex}` takes. */
    readonly lineIndex: number;
    /** The line's accessible label, numbered from ONE for a human. */
    readonly label: string;
    /** The stored line, as submitted or last edited. */
    readonly sourceLine: string;
    readonly status: ParseJobLineStatus;
    readonly statusLabel: string;
    readonly tone: ParseLineTone;
    /** The measure sentence, or `undefined` while no proposal has landed. */
    readonly measure: string | undefined;
    /** Every food the line named, in order — `undefined` while no proposal has landed. */
    readonly foods: readonly ParseProposalFood[] | undefined;
    /** Set only when a proposal landed and named NO foods — a heading is a fact, not a failure. */
    readonly emptyFoodsNotice: string | undefined;
    /** Localized reasons the line wants a human's eye. Empty when clean or not yet landed. */
    readonly reviewReasons: readonly string[];
    /** Label of this row's edit control, numbered from ONE. */
    readonly editLabel: string;
}

/** Status → the word and the tone it is shown in. Exhaustive over the wire enum. */
function presentStatus(
    status: ParseJobLineStatus,
    messages: RecipeParseMessages,
): { label: string; tone: ParseLineTone } {
    switch (status) {
        case 'pending':
            return { label: messages.linePending, tone: 'progress' };
        case 'parsed':
            return { label: messages.lineParsed, tone: 'success' };
        case 'unparseable':
            return { label: messages.lineUnparseable, tone: 'error' };
        case 'failed_retryable':
            return { label: messages.lineRetryable, tone: 'warning' };
    }
}

/**
 * Project one line into what a leaf renders. Pure.
 *
 * ⛔ THE MEASURE GOES THROUGH `formatQuantity`, the formatter the detail and version surfaces already
 * share, so a parse proposal and a saved recipe never render the same amount two ways — including the en
 * dash between a range's bounds. Its R40 contract carries straight through: an ABSENT quantity prints NO
 * number, so `2 cups` and `the size of an egg` stay distinguishable instead of the second becoming a `0`
 * or a fabricated `1`. Where the line states neither an amount nor a unit, `formatQuantity` answers `''`
 * and this substitutes a sentence rather than rendering an empty slot.
 *
 * ⛔ A REVIEW REASON THIS BUILD DOES NOT KNOW FALLS BACK. The wire types reasons as opaque strings
 * precisely so a deployed pipeline may emit one ahead of a released mobile binary; showing a raw
 * `snake_case` key to a cook, or a blank chip, are both worse than a vague-but-true sentence.
 *
 * @param line - The line as the job reports it.
 * @param messages - The resolved parse copy for the active locale.
 * @param locale - The active BCP-47 locale, for the measure's number formatting.
 * @returns The row model.
 */
export function toParseLineModel(
    line: ParseJobLineView,
    messages: RecipeParseMessages,
    locale: Locale,
): ParseLineModel {
    const { label: statusLabel, tone } = presentStatus(line.status, messages);
    const humanNumber = line.lineIndex + 1;
    const base = {
        lineIndex: line.lineIndex,
        label: fillTemplate(messages.lineLabel, { line: humanNumber }),
        sourceLine: line.sourceLine,
        status: line.status,
        statusLabel,
        tone,
        editLabel: fillTemplate(messages.lineEditAction, { line: humanNumber }),
    };

    if (line.proposal === null) {
        return { ...base, measure: undefined, foods: undefined, emptyFoodsNotice: undefined, reviewReasons: [] };
    }

    const formatted = formatQuantity(line.proposal.quantity, locale, line.proposal.unit ?? undefined);

    return {
        ...base,
        measure: formatted === '' ? messages.lineNoMeasure : formatted,
        foods: line.proposal.foods,
        emptyFoodsNotice: line.proposal.foods.length === 0 ? messages.lineNoFoods : undefined,
        reviewReasons: line.proposal.reviewReasons.map((key) => messages.reasons[key] ?? messages.reasonUnknown),
    };
}
