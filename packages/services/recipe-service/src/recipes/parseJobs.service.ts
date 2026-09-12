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
    /** Insert the job and its lines in one transaction. @sideEffect Writes both parse-job tables. */
    createJob(
        ownerId: string,
        lines: readonly { readonly sourceLine: string; readonly lineDigest: string }[],
        expiresAt: Date,
    ): Promise<ParseJobRecord>;
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
        const lines = splitParseJobLines(text).map((sourceLine) => ({
            sourceLine,
            lineDigest: lineDigest(sourceLine, sha256Hex),
        }));
        const expiresAt = new Date(Date.now() + PARSE_JOB_TTL_HOURS * 3_600_000);
        const record = await this.dal.createJob(ownerId, lines, expiresAt);
        const messages = record.lines.map((line) => this.messageFor(record.id, ownerId, line));
        const enqueued = await this.enqueueOrMark(record.id, messages);

        if (enqueued) {
            return viewOf(record);
        }

        // Reflect the failure the caller can act on: every line just created is now retryable, and the
        // job aggregate (recomputed by the DAL) is `partial`. Rebuilt locally rather than re-read — the
        // marks are OURS, and a re-read races the worker.
        return viewOf({
            ...record,
            status: 'partial',
            lines: record.lines.map((line) => ({ ...line, status: 'failed_retryable' as const })),
        });
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
