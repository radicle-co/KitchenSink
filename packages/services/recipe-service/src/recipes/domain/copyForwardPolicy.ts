/**
 * THE COPY-FORWARD POLICY — "may this line's previously landed answer be reused instead of re-queued?"
 *
 * DESIGN PATTERN: **Specification / Policy module**, the sibling of `transcriptionCarryForward.ts` (which is
 * literally the other carry-forward policy in this directory), `provenancePolicy.ts` and
 * `visibilityPolicy.ts` — pure, total, no I/O, no Drizzle, no Nest, and exhaustible as a truth table. The
 * clock and the window are INJECTED, so nothing here reads the environment or `Date.now()`.
 *
 * ## ⛔ Why this tier exists
 *
 * `ParseJobsService.create` enqueues one SQS message per pasted line unconditionally. The parse cache is
 * consulted, but inside the WORKER — after the send, the receive and the claim have all been paid for.
 * Measured on the September queue: `NumberOfMessagesSent` = 1,650,952 for a 2,502-line corpus, of which
 * 16.8% were ever received. A PRODUCER count, not redelivery.
 *
 * ## ⛔ Why the source is a prior JOB LINE and not `ingredient_parse_cache`
 *
 * The cache is keyed `(line_digest, engine, engine_version)` and holds ONE ROW PER ENGINE; a job line's
 * `proposal` is the MERGED `ParsedLine` that `compareParses` adjudicates out of both. recipe-service
 * depends on neither `recipe-import-core` (so it cannot merge) nor either engine's version string (so it
 * cannot tell a current row from a retired one) — and skipping a line against a retired version means the
 * line is never parsed with the current model. A prior job line's proposal is already merged, and this
 * service owns the table.
 *
 * ## ⛔ THE ORDERING RULE THIS TIER SITS ABOVE, AND ITS DISCHARGE
 *
 * `parsePipeline.ts` owns exactly one rule: **"A human correction outranks a cached parse; a cached parse
 * outranks an engine call."** This policy is a NEW TIER ABOVE `corrections`, evaluated in a different
 * deployable, unable to consult the corrections tier. Unaddressed, a cook corrects a parse, re-pastes the
 * line, silently receives the PRE-CORRECTION answer, and corrects it forever.
 *
 * The discharge is {@link CopyForwardInput.correctionsChangedAt} — the newest moment anything in this
 * caller's visible correction set changed. An answer that landed before that moment is not copied.
 *
 * ⛔ It asks only **"did the set MOVE?"**, never which correction wins. `parsePorts.ts` warns by name that
 * two readers with different precedence would let a correction bind on the API path and not on the import
 * path; re-deriving `findInForce`'s ordering here is precisely that mistake. The restraint is the design.
 *
 * ⚠️ THE ASYMMETRY IS DELIBERATE AND MUST NOT BE FLATTENED. The watermark is a **sound bound**: if nothing
 * in the correction set moved since the answer landed, no correction now in force could have changed it.
 * The recency window is only a **PROXY** for version-awareness — `recipe_parse_job_lines` carries no engine
 * version, so a model pin changed inside the window still serves the old answer. The owed follow-up is a
 * `recipe-workers` change recording the engine version on the landed line, after which the window is
 * deleted rather than tuned.
 *
 * ⚠️ The REAL bound on the candidate pool is neither of those: `expireParseJobs` DELETES a job seven days
 * past its 24-hour expiry, cascading to its lines, so no candidate can ever be older than ~8 days however
 * large the window is set.
 */
import type { ParseJobLineStatus } from '../../database/schema/parseJobs.js';

/**
 * The terminal line states that carry an ANSWER and may therefore be copied.
 *
 * ⛔ ONLY `parsed`. A line that landed any other way is a FAILURE, and the owner's ruling (2026-09-19,
 * "let's not cache failed_retryable and unparseable") is that a failure is never carried forward.
 *
 * ⛔ `failed_retryable` means "we kept trying and could not get to it" — ABSENCE, not a reading. Copying it
 * would turn a transient outage into a permanent fact about a line, ADR-0026 §3's rule one table over.
 *
 * ⛔ `unparseable` IS NOT COPYABLE EITHER, and the argument for copying it is the one to refuse: that
 * `landingOf` assigns it to a SUCCESSFUL parse that found no food ("spoonfuls", "baking-board"), so
 * re-queuing buys the same answer. That is sound about cost and silent about the cook: the same status is
 * also what an exhausted validator loop lands, the two are indistinguishable in the column, and copying
 * it forward means a line the parser could not read is never re-read. The saving is given up
 * deliberately — the re-queued line costs one message and, for the genuinely food-free case, one cache
 * miss.
 */
export const COPYABLE_LINE_STATUSES = ['parsed'] as const satisfies readonly ParseJobLineStatus[];

/** A line status that carries an answer. */
export type CopyableLineStatus = (typeof COPYABLE_LINE_STATUSES)[number];

/** One previously landed line that MIGHT be copied forward. */
export interface CopyForwardCandidate {
    /** The digest the answer is about — the SAME identity the messages and stored rows carry. */
    readonly lineDigest: string;
    /** The status that was landed. Only {@link COPYABLE_LINE_STATUSES} can be copied. */
    readonly status: ParseJobLineStatus;
    /** The stored `ParsedLine` jsonb. ⛔ `unknown`: it may outlive the shape that wrote it. */
    readonly proposal: unknown;
    /** The landed `llmAttempts`, carried so the copy is indistinguishable from the original. */
    readonly llmAttempts: number | null;
    /**
     * When the WORKER landed this answer.
     *
     * ⛔ Only a worker-landed line may be a candidate — the DAL enforces `copied_at IS NULL`. A copied row's
     * `updated_at` is its INSERT time, so a chain of copies would present an ever-refreshing landing time
     * and defeat both the window and the watermark. See `migrations/0048`.
     */
    readonly landedAt: Date;
}

/** One line of the paste being created. */
export interface CopyForwardLine {
    readonly sourceLine: string;
    readonly lineDigest: string;
}

/** Everything a copy-forward decision depends on. Every key REQUIRED, so no call site decides by omission. */
export interface CopyForwardInput {
    /** The paste's lines, in submission order. */
    readonly lines: readonly CopyForwardLine[];
    /** Previously landed answers available to this caller. May hold several per digest. */
    readonly candidates: readonly CopyForwardCandidate[];
    /** The clock, injected. */
    readonly now: Date;
    /** How old an answer may be and still be copied. `0` disables copy-forward entirely (the kill switch). */
    readonly maxAgeHours: number;
    /**
     * The newest moment anything in this caller's visible correction set changed, or `null` if it never has.
     *
     * ⛔ The discharge of the corrections ordering rule — see the module docstring.
     */
    readonly correctionsChangedAt: Date | null;
}

/** What to do with one submitted line. */
export type CopyForwardDecision =
    | { readonly kind: 'enqueue' }
    | {
          readonly kind: 'copy';
          readonly status: CopyableLineStatus;
          /** The stored proposal, with `raw` rebased onto THIS submission's spelling (HAZ-041). */
          readonly proposal: Record<string, unknown>;
          readonly llmAttempts: number | null;
      };

/** The one decision meaning "do the work". Shared so the refusals below cannot drift apart. Pure. */
const ENQUEUE: CopyForwardDecision = { kind: 'enqueue' };

/**
 * Whether a candidate's status is one that carries an answer.
 *
 * ⛔ Narrows the CANDIDATE, not just its status field, so the narrowing survives into `bestCandidate`'s
 * return type and the caller needs no cast to read the status back out as a {@link CopyableLineStatus}.
 *
 * @param candidate - The landed line under consideration.
 * @returns Whether it carries an answer that may be copied. Pure.
 */
function carriesAnAnswer(
    candidate: CopyForwardCandidate,
): candidate is CopyForwardCandidate & { readonly status: CopyableLineStatus } {
    return (COPYABLE_LINE_STATUSES as readonly ParseJobLineStatus[]).includes(candidate.status);
}

/**
 * Whether a stored proposal is shaped like something this policy can rebase.
 *
 * ⛔ FAILS TOWARD DOING THE WORK. A payload this build cannot read is an answer to re-earn, never one to
 * serve — and a non-object has no `raw` to rebase, so serving it would publish another line's spelling.
 *
 * @param proposal - The stored jsonb.
 * @returns Whether it is a plain object. Pure.
 */
function isRebasable(proposal: unknown): proposal is Record<string, unknown> {
    return typeof proposal === 'object' && proposal !== null && !Array.isArray(proposal);
}

/**
 * The best candidate for one digest, or `undefined` when none may be copied.
 *
 * ⚠️ THE OVERLAP WITH THE DAL'S STATEMENT IS NOT ONE RELATIONSHIP, AND THE DIFFERENCE MATTERS — state it
 * per rule rather than as a blanket "this module is the authority", which is what it used to say and was
 * false of one of the three:
 *
 *  - **Status** — re-asserted here by `carriesAnAnswer`. The SQL's `l.status IN ('parsed','unparseable')`
 *    bounds the fetch; a row arriving with any other status is still refused here.
 *  - **The recency window** — re-asserted here, and NOT redundant, because the two checks read DIFFERENT
 *    CLOCKS. The SQL compares against the database's `now()`; this module compares against the `now`
 *    INJECTED into it. A caller reasoning about a fixed instant gets that instant honoured.
 *  - ⛔ **Newest-wins — the DAL is the authority and this module CANNOT re-check it.**
 *    `COPY_FORWARD_CANDIDATES_SQL` is `SELECT DISTINCT ON (l.line_digest) … ORDER BY l.line_digest,
 *    l.updated_at DESC`, so exactly ONE row per digest ever reaches this function and the loop below
 *    maximises over a singleton. Flip that `DESC` to `ASC` and the oldest answer is copied with nothing
 *    here able to notice. The loop is kept because this function's CONTRACT takes many candidates and must
 *    be total over them — its unit tests exercise that contract directly — but `DISTINCT ON` is
 *    load-bearing, and the assertion that protects the real path is an integration one against the DAL.
 *
 * @param candidates - Every candidate for this digest.
 * @param input - The run's clock, window and watermark.
 * @returns The candidate to copy, or `undefined`. Pure.
 */
function bestCandidate(
    candidates: readonly CopyForwardCandidate[],
    input: CopyForwardInput,
): (CopyForwardCandidate & { readonly status: CopyableLineStatus }) | undefined {
    const oldestAllowed = input.now.getTime() - input.maxAgeHours * 3_600_000;
    let best: (CopyForwardCandidate & { readonly status: CopyableLineStatus }) | undefined;

    for (const candidate of candidates) {
        if (!carriesAnAnswer(candidate) || !isRebasable(candidate.proposal)) {
            continue;
        }

        const landed = candidate.landedAt.getTime();

        if (landed < oldestAllowed) {
            continue;
        }

        // ⛔ The ordering rule's discharge. `<=` rather than `<`: an answer that landed in the same instant a
        // correction moved may or may not have seen it, and the cheap wrong choice is to re-earn the answer.
        if (input.correctionsChangedAt !== null && landed <= input.correctionsChangedAt.getTime()) {
            continue;
        }

        if (best === undefined || landed > best.landedAt.getTime()) {
            best = candidate;
        }
    }

    return best;
}

/**
 * Decide, for every submitted line, whether its answer may be copied forward or the line must be queued.
 *
 * ⚠️ ONE DECISION PER SUBMITTED POSITION, never per distinct digest. A paste may legitimately repeat an
 * ingredient and the paste is POSITIONAL — the cook gets their own lines back, and the worker's landing is
 * keyed on `line_index`, so collapsing two positions onto one message would strand the twin `pending` until
 * its job's TTL.
 *
 * @param input - The lines, the candidates, and the three gates.
 * @returns Exactly one decision per input line, in order. Pure.
 */
export function evaluateCopyForward(input: CopyForwardInput): readonly CopyForwardDecision[] {
    if (input.lines.length === 0) {
        return [];
    }

    const byDigest = new Map<string, CopyForwardCandidate[]>();

    for (const candidate of input.candidates) {
        const existing = byDigest.get(candidate.lineDigest);

        if (existing === undefined) {
            byDigest.set(candidate.lineDigest, [candidate]);
        } else {
            existing.push(candidate);
        }
    }

    // One resolution per DIGEST, reused across every position that shares it — the decision is a property of
    // the line, while the rebase below is a property of the position.
    const resolved = new Map<string, (CopyForwardCandidate & { readonly status: CopyableLineStatus }) | undefined>();

    return input.lines.map((line) => {
        if (!resolved.has(line.lineDigest)) {
            resolved.set(line.lineDigest, bestCandidate(byDigest.get(line.lineDigest) ?? [], input));
        }

        const candidate = resolved.get(line.lineDigest);

        if (candidate === undefined || !isRebasable(candidate.proposal)) {
            return ENQUEUE;
        }

        return {
            kind: 'copy',
            status: candidate.status,
            // ⛔ HAZ-041: `ParsedLine.raw` is the cook's line BYTE-IDENTICAL, but `lineDigest` NFC-normalizes
            // and collapses whitespace — so two lines sharing a digest can differ in bytes. Copying without
            // rebasing would show a proposal quoting a DIFFERENT string than the row's own `sourceLine`, in
            // the same payload. `runParsePipeline` does the same for each position of a repeated line.
            proposal: { ...candidate.proposal, raw: line.sourceLine },
            llmAttempts: candidate.llmAttempts,
        };
    });
}
