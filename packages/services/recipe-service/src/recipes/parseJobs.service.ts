/**
 * `ParseJobsService` (plan U9, origin D9/R13) — the async parse-job resource's business rules.
 *
 * DESIGN PATTERN: application service over two ports — {@link ParseJobsDalPort} (the SQL truth, implemented
 * by `dal/parseJobs.dal.ts`) and {@link ParseJobQueuePort} (the SQS producer) — the exact shape
 * `RecipesService` has with its DALs and the verification queue, so it stays unit-testable with fakes.
 *
 * ## The four rules that live HERE (everything else is the DAL's or the worker's)
 *
 *  1. **One splitter.** `splitParseJobLines` — the same function the wire schema refines with — decides
 *     what a line is, and `lineDigest` (recipe-core's, over the injected `sha256Hex`) decides its R17
 *     identity. The worker recomputes the digest from the message and guards its landing on the STORED
 *     value, so all three representations (validated, stored, enqueued) must come from one source.
 *  2. **An enqueue failure is neither swallowed nor a 500.** Unlike a verification request (droppable), a
 *     parse-job line's message IS the work: a lost message leaves the line `pending` until the TTL sweep,
 *     invisible to the retry endpoint. So the failure path marks the affected lines `failed_retryable` —
 *     the exact population `POST :id/retry` re-drives — and the request still answers with the job view,
 *     because the job WAS created. ⚠️ On a PARTIAL batch failure every still-pending line is marked, which
 *     may re-enqueue a line whose message did send: harmless by construction — the worker's landing is
 *     digest-guarded and idempotent, and the parse cache absorbs the duplicate work (KTD-F).
 *  3. **Owner scoping is a 404, never a 403** (the plan's own scenario): a 403 would confirm another
 *     user's job id exists. The DAL folds ownership into its WHERE clause — zero rows IS the denial —
 *     and this service maps that to `PARSE_JOB_NOT_FOUND`.
 *  4. **Proposals are projected, never passed through.** The stored jsonb is the worker's full
 *     `ParsedLine` (provenance, engine bookkeeping); the wire gets the strict review projection only.
 *     A stored row this build cannot read is a THROWN error (500), not a silently absent proposal — the
 *     writer is our own worker, so an unreadable row is a defect to surface, not a state to render.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RecipeErrorCode, ingredientQuantitySchema } from '@kitchensink/recipe-core';
import { z } from 'zod';
import { lineDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { splitParseJobLines } from '@kitchensink/recipe-core/parsing/parse-job-text';
import type { ParseLineJobMessage } from '@kitchensink/recipe-core/parsing/parse-job-message';

import { sha256Hex } from '../common/sha256.js';
import { DEFAULT_COPY_FORWARD_MAX_AGE_HOURS } from '../config/config.types.js';
import {
    evaluateCopyForward,
    type CopyForwardCandidate,
    type CopyForwardDecision,
} from './domain/copyForwardPolicy.js';
import { RecipeDomainError } from './recipe.error.js';
import { PARSE_JOB_QUEUE, type ParseJobQueuePort } from './parseJob.queue.js';
import type { ParseJobLineStatus, ParseJobStatus } from '../database/schema/parseJobs.js';
import type { ParseJobResponse, ParseProposal } from './parseJobs.schema.js';

/**
 * How long an untouched job lives before the TTL sweep expires it. A day: long enough to leave the review
 * tab open overnight, short enough that abandoned pasted text does not accumulate (the job's text is user
 * content — it is erased with its owner AND expired on abandonment).
 */
export const PARSE_JOB_TTL_HOURS = 24;

/** DI token for {@link ParseJobsDalPort} — provided by `RecipesModule` over the shared Drizzle client. */
export const PARSE_JOBS_DAL = 'PARSE_JOBS_DAL';

/** DI token for the copy-forward window, in hours — `RecipesModule` reads it from the env config. */
export const PARSE_COPY_FORWARD_MAX_AGE_HOURS = 'PARSE_COPY_FORWARD_MAX_AGE_HOURS';

/** One line as `create` hands it to the DAL: the stored fields plus what to do about it. */
export interface NewParseJobLine {
    readonly sourceLine: string;
    readonly lineDigest: string;
    /**
     * Whether this line's answer is copied from a prior landing or its message must be sent.
     *
     * ⛔ REQUIRED, so no call site acquires copy-forward — or loses it — by omission.
     */
    readonly decision: CopyForwardDecision;
}

/** One line as the DAL stores and returns it. */
export interface ParseJobLineRecord {
    readonly lineIndex: number;
    readonly sourceLine: string;
    readonly lineDigest: string;
    readonly status: ParseJobLineStatus;
    /** The worker's stored `ParsedLine` jsonb, or `null` before a landing. */
    readonly proposal: unknown;
    readonly llmAttempts: number | null;
}

/** One job as the DAL returns it, lines in submission order. */
export interface ParseJobRecord {
    readonly id: string;
    readonly status: ParseJobStatus;
    readonly createdAt: Date;
    readonly expiresAt: Date;
    readonly lines: readonly ParseJobLineRecord[];
}

/** A mutation's outcome. `missing` covers stranger AND absent — the DAL cannot tell them apart on purpose. */
export type ParseJobMutation<T> =
    { readonly kind: 'missing' } | { readonly kind: 'expired' } | (T & { readonly kind: 'ok' });

/** A line the retry/edit paths re-enqueue. */
export interface ReenqueueableLine {
    readonly lineIndex: number;
    readonly sourceLine: string;
    readonly lineDigest: string;
}

/** The SQL truth this service depends on. Implemented by `dal/parseJobs.dal.ts`. */
export interface ParseJobsDalPort {
    /**
     * Previously landed answers this caller may copy — newest per digest, worker-landed only, in window.
     *
     * @param ownerId - The caller; the owner filter IS the authorization.
     * @param digests - The digests to look for.
     * @param maxAgeHours - The recency window; `0` returns nothing.
     * @returns At most one candidate per digest. @sideEffect Reads.
     */
    findCopyForwardCandidates(
        ownerId: string,
        digests: readonly string[],
        maxAgeHours: number,
    ): Promise<readonly CopyForwardCandidate[]>;
    /**
     * The newest moment anything in this caller's visible correction set changed, or `null`.
     *
     * ⛔ The discharge of the corrections ordering rule — see `copyForwardPolicy.ts`. @sideEffect Reads.
     */
    correctionsChangedAt(ownerId: string): Promise<Date | null>;
    /**
     * Insert the job and its lines in one transaction, honouring each line's decision and deriving the
     * job's initial status from how many lines are still outstanding.
     *
     * @sideEffect Writes both parse-job tables.
     */
    createJob(ownerId: string, lines: readonly NewParseJobLine[], expiresAt: Date): Promise<ParseJobRecord>;
    /** The owner's job with its lines, or `undefined` (stranger and absent are ONE answer). @sideEffect Reads. */
    getJob(ownerId: string, jobId: string): Promise<ParseJobRecord | undefined>;
    /** Flip these lines to `failed_retryable` and recompute the job aggregate. @sideEffect Writes. */
    markLinesFailedRetryable(jobId: string, lineIndexes: readonly number[]): Promise<void>;
    /** Flip every `failed_retryable` line back to `pending` (job → `running`), returning what to re-enqueue. @sideEffect Writes. */
    resetForRetry(
        ownerId: string,
        jobId: string,
    ): Promise<ParseJobMutation<{ readonly lines: readonly ReenqueueableLine[] }>>;
    /** Atomically replace one line's text + digest (status → `pending`, job → `running`). @sideEffect Writes. */
    editLine(
        ownerId: string,
        jobId: string,
        lineIndex: number,
        sourceLine: string,
        digest: string,
    ): Promise<ParseJobMutation<{ readonly line: ReenqueueableLine }>>;
}

/**
 * What this service reads out of the STORED proposal — a tolerant pick over the worker's `ParsedLine`.
 *
 * `loose` on both objects ON PURPOSE: the stored shape legitimately carries more than the wire does
 * (provenance, `llmAttempts`, engine bookkeeping), and new internal fields must not break reads. The wire
 * projection below rebuilds the STRICT shape field by field, so nothing extra can leak through.
 */
const storedProposalSchema = z.looseObject({
    raw: z.string(),
    quantity: ingredientQuantitySchema,
    unit: z.string().nullable(),
    statedMeasure: z.string().nullable(),
    foods: z.array(z.looseObject({ name: z.string(), prep: z.string().nullable() })),
    reviewReasons: z.array(z.string()),
});

/** Project a stored `ParsedLine` onto the strict wire shape. Pure. @throws On a row this build cannot read. */
function projectProposal(stored: unknown): ParseProposal {
    const parsed = storedProposalSchema.parse(stored);

    return {
        raw: parsed.raw,
        quantity: parsed.quantity,
        unit: parsed.unit,
        statedMeasure: parsed.statedMeasure,
        foods: parsed.foods.map((food) => ({ name: food.name, prep: food.prep })),
        reviewReasons: parsed.reviewReasons,
    };
}

/** Map a DAL record onto the wire view. Pure. */
function viewOf(record: ParseJobRecord): ParseJobResponse {
    return {
        id: record.id,
        status: record.status,
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        lines: record.lines.map((line) => ({
            lineIndex: line.lineIndex,
            sourceLine: line.sourceLine,
            status: line.status,
            proposal: line.proposal === null ? null : projectProposal(line.proposal),
        })),
    };
}

/** `PARSE_JOB_NOT_FOUND` — stranger and absent are deliberately one answer. */
function parseJobNotFound(jobId: string): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.PARSE_JOB_NOT_FOUND, `Parse job ${jobId} not found.`);
}

/** `PARSE_JOB_EXPIRED` — the TTL passed; the remedy is a fresh create. */
function parseJobExpired(jobId: string): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.PARSE_JOB_EXPIRED, `Parse job ${jobId} expired.`);
}

@Injectable()
export class ParseJobsService {
    private readonly logger = new Logger(ParseJobsService.name);

    public constructor(
        @Optional() @Inject(PARSE_JOBS_DAL) private readonly dal: ParseJobsDalPort,
        @Optional() @Inject(PARSE_JOB_QUEUE) private readonly queue: ParseJobQueuePort,
        @Optional()
        @Inject(PARSE_COPY_FORWARD_MAX_AGE_HOURS)
        private readonly copyForwardMaxAgeHours: number = DEFAULT_COPY_FORWARD_MAX_AGE_HOURS,
    ) {}

    /**
     * Create a job from a pasted block: split, digest, store, enqueue one message per line.
     *
     * The controller's schema already refused an inadmissible paste with the SAME splitter, so by the time
     * this runs the split is known-admissible; splitting again is not a second opinion, it is the one
     * opinion applied to the one representation that matters (what gets stored).
     *
     * @sideEffect Writes the parse-job tables and enqueues SQS messages.
     */
    public async create(ownerId: string, text: string): Promise<ParseJobResponse> {
        const split = splitParseJobLines(text).map((sourceLine) => ({
            sourceLine,
            lineDigest: lineDigest(sourceLine, sha256Hex),
        }));
        const lines = await this.decideCopyForward(ownerId, split);
        const expiresAt = new Date(Date.now() + PARSE_JOB_TTL_HOURS * 3_600_000);
        const record = await this.dal.createJob(ownerId, lines, expiresAt);
        // ⛔ Only the lines the DAL actually left OUTSTANDING get a message. Reading it off the stored status
        // rather than off `decisions` keeps ONE authority for "what still needs doing" — the rows.
        const outstanding = record.lines.filter((line) => line.status === 'pending');

        if (outstanding.length === 0) {
            // Nothing to send, so nothing can fail. ⚠️ The job is already `complete` (derived in the DAL's
            // transaction) — see `createJob` on why that is not a post-commit aggregate call.
            return viewOf(record);
        }

        const messages = outstanding.map((line) => this.messageFor(record.id, ownerId, line));
        const enqueued = await this.enqueueOrMark(record.id, messages);

        if (enqueued) {
            return viewOf(record);
        }

        // Reflect the failure the caller can act on: every line we TRIED TO SEND is now retryable, and the
        // job aggregate (recomputed by the DAL) is `partial`. Rebuilt locally rather than re-read — the
        // marks are OURS, and a re-read races the worker.
        //
        // ⛔ A COPIED line is never touched here. It was never sent, it already holds an answer, and
        // regressing it to `failed_retryable` would discard a good parse to report a queue outage.
        const marked = new Set(outstanding.map((line) => line.lineIndex));

        return viewOf({
            ...record,
            status: 'partial',
            lines: record.lines.map((line) =>
                marked.has(line.lineIndex) ? { ...line, status: 'failed_retryable' as const } : line,
            ),
        });
    }

    /**
     * Decide, per submitted line, whether its answer may be copied forward.
     *
     * ⛔ FAILS TOWARD DOING THE WORK. If either read throws, every line is enqueued — the parse pipeline's
     * own posture, where a tier whose I/O failed continues because "a stale cache row taking down a parse it
     * exists to accelerate" is strictly worse than the extra call. Never the reverse: a dedup that fails
     * CLOSED would silently stop parsing.
     *
     * ⚠️ The two reads are issued CONCURRENTLY — they are independent, and awaiting them in turn would put
     * two round trips in front of every paste.
     *
     * @param ownerId - The caller.
     * @param lines - The split, digested lines.
     * @returns One decision per line, positionally. @sideEffect Reads the job lines and the corrections.
     */
    private async decideCopyForward(
        ownerId: string,
        lines: readonly { readonly sourceLine: string; readonly lineDigest: string }[],
    ): Promise<readonly NewParseJobLine[]> {
        // ⛔ THE ZIP LIVES HERE, WHERE BOTH HALVES ARE IN SCOPE. `evaluateCopyForward` answers one decision
        // per submitted position, and the caller used to re-pair them by index — which needed a cast
        // (`noUncheckedIndexedAccess` is off, so the compiler already believed the lookup total) and turned
        // a length mismatch into a runtime `TypeError` at some later field access rather than an error here.
        // Attaching the decision where it is produced makes the pairing unrepresentable-if-wrong instead.
        const enqueueAll = lines.map((line) => ({ ...line, decision: { kind: 'enqueue' } as const }));

        // ⛔ THE KILL SWITCH COSTS NOTHING, which is the point of it. A zero window cannot copy anything, so
        // neither read is issued — and the second one matters: `correctionsChangedAt` is a measured SEQ SCAN
        // of `ingredient_parse_corrections` (20,000 rows → 254 buffers, 1.7 ms) with no index able to serve
        // its `scope = 'global' OR user_id = $1` disjunction. A switch that disabled the behaviour while
        // leaving a per-request scan on the create hot path would be the opposite of a kill switch.
        if (lines.length === 0 || this.copyForwardMaxAgeHours <= 0) {
            return enqueueAll;
        }

        try {
            const digests = [...new Set(lines.map((line) => line.lineDigest))];
            const [candidates, correctionsChangedAt] = await Promise.all([
                this.dal.findCopyForwardCandidates(ownerId, digests, this.copyForwardMaxAgeHours),
                this.dal.correctionsChangedAt(ownerId),
            ]);

            const decisions = evaluateCopyForward({
                lines,
                candidates,
                now: new Date(),
                maxAgeHours: this.copyForwardMaxAgeHours,
                correctionsChangedAt,
            });

            return lines.map((line, index) => ({ ...line, decision: decisions[index] ?? { kind: 'enqueue' } }));
        } catch (error) {
            // ⚠️ LOUD, then degraded. A silently-disabled dedup is a bill nobody reads as a defect.
            this.logger.warn(
                `parse-job copy-forward lookup failed for ${String(lines.length)} line(s); enqueueing all — ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );

            return enqueueAll;
        }
    }

    /** The owner's job view. @throws `PARSE_JOB_NOT_FOUND` for stranger and absent alike. @sideEffect Reads. */
    public async get(ownerId: string, jobId: string): Promise<ParseJobResponse> {
        const record = await this.dal.getJob(ownerId, jobId);

        if (record === undefined) {
            throw parseJobNotFound(jobId);
        }

        return viewOf(record);
    }

    /**
     * Re-drive exactly the `failed_retryable` lines (the plan's partial-outage scenario).
     *
     * @throws `PARSE_JOB_NOT_FOUND` / `PARSE_JOB_EXPIRED`. @sideEffect Writes line statuses, enqueues.
     */
    public async retry(ownerId: string, jobId: string): Promise<ParseJobResponse> {
        const reset = await this.dal.resetForRetry(ownerId, jobId);

        if (reset.kind === 'missing') {
            throw parseJobNotFound(jobId);
        }

        if (reset.kind === 'expired') {
            throw parseJobExpired(jobId);
        }

        if (reset.lines.length > 0) {
            await this.enqueueOrMark(
                jobId,
                reset.lines.map((line) => this.messageFor(jobId, ownerId, line)),
            );
        }

        return this.get(ownerId, jobId);
    }

    /**
     * Replace one line's text — R17's re-drive half: the stored digest moves WITH the text in one UPDATE
     * (the DAL's), so a landing for the old phrase matches zero rows, and the new phrase re-drives itself.
     *
     * @throws `PARSE_JOB_NOT_FOUND` / `PARSE_JOB_EXPIRED`. @sideEffect Writes the line, enqueues.
     */
    public async editLine(
        ownerId: string,
        jobId: string,
        lineIndex: number,
        sourceLine: string,
    ): Promise<ParseJobResponse> {
        const trimmed = sourceLine.trim();
        const digest = lineDigest(trimmed, sha256Hex);
        const edited = await this.dal.editLine(ownerId, jobId, lineIndex, trimmed, digest);

        if (edited.kind === 'missing') {
            throw parseJobNotFound(jobId);
        }

        if (edited.kind === 'expired') {
            throw parseJobExpired(jobId);
        }

        await this.enqueueOrMark(jobId, [this.messageFor(jobId, ownerId, edited.line)]);

        return this.get(ownerId, jobId);
    }

    /** One consumer-shaped message. Pure. */
    private messageFor(
        jobId: string,
        ownerId: string,
        line: { readonly lineIndex: number; readonly sourceLine: string; readonly lineDigest: string },
    ): ParseLineJobMessage {
        return {
            jobId,
            lineIndex: line.lineIndex,
            sourceLine: line.sourceLine,
            lineDigest: line.lineDigest,
            userId: ownerId,
            requestedAt: new Date().toISOString(),
        };
    }

    /**
     * Enqueue, converting a failure into the retryable state (rule 2 in the module docstring).
     *
     * @returns Whether the enqueue succeeded. @sideEffect Enqueues; on failure writes line statuses.
     */
    private async enqueueOrMark(jobId: string, messages: readonly ParseLineJobMessage[]): Promise<boolean> {
        try {
            await this.queue.enqueue(messages);

            return true;
        } catch (error) {
            // ⚠️ LOUD, then converted — never silent: the failure is recoverable (retry re-drives), but an
            // unlogged conversion is how an SQS misconfiguration hides behind a green API for weeks.
            this.logger.warn(
                `parse-job ${jobId}: enqueue failed, marking ${String(messages.length)} line(s) failed_retryable — ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            await this.dal.markLinesFailedRetryable(
                jobId,
                messages.map((message) => message.lineIndex),
            );

            return false;
        }
    }
}
