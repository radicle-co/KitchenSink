/**
 * THE PARSE-JOB LINE MESSAGE (plan U8/U9, origin D9/R13) — the queue contract between
 * `POST /recipe-parse-jobs` (the producer, recipe-service) and the parse worker (recipe-workers).
 *
 * ⛔ CONSUMER BEFORE PRODUCER (ADR-0022's ordering note): the worker ships first and this schema with it,
 * so the producer can never enqueue a shape the deployed worker has not seen.
 *
 * ⛔ IT CARRIES INPUTS, NEVER CONCLUSIONS — the verification queue's rule, for the same reason: the
 * worker re-derives everything judgeable (it recomputes `lineDigest` from the
 * line and DISCARDS the landing on mismatch, so a message body that was tampered with, truncated, or
 * belongs to an edited line can never land under the wrong phrase — R17's stale-landing rule).
 */
import { z } from 'zod';

import { PARSE_JOB_LINE_MAX_CHARS } from './parseJobText.js';

/** One line is one message, exactly as one verification is (batchSize 1, DLQ maps to one line). */
export const parseLineJobMessageSchema = z
    .object({
        /** The `recipe_parse_jobs` row this line belongs to. */
        jobId: z.uuid(),
        /** The line's position within the job — with `jobId`, the landing row's primary key. */
        lineIndex: z.number().int().min(0).max(9_999),
        /** The raw source line, verbatim. The bound is `parseJobText.ts`'s — the splitter and this contract admit the same lines. */
        sourceLine: z.string().min(1).max(PARSE_JOB_LINE_MAX_CHARS),
        /**
         * `parseKey.ts`'s `lineDigest(sourceLine)` AS THE PRODUCER STORED IT — the VERSIONED form
         * (`v{N}:{64 hex}`), never a bare hash. The worker recomputes from `sourceLine` and the landing
         * UPDATE is guarded on the STORED hash — three-way agreement, or the landing is discarded (R17):
         * an edit that changed the line re-drives its own new message.
         *
         * ⛔ THE SHAPE IS LOOSE ACROSS VERSIONS ON PURPOSE (`v\d+`, not the current `PARSE_KEY_VERSION`):
         * mid-deploy, a message carrying the OLD generation's digest must reach the digest guard and be
         * DISCARDED quietly (the designed stale path) — a schema pinned to the current version would
         * instead refuse it into the DLQ as poison. ⚠️ The original regex here demanded BARE 64-hex,
         * which no producer using `lineDigest()` could ever satisfy — found by U9's integration tier when
         * every enqueue was "refused by the contract (lineDigest)"; a unit test against a hand-rolled
         * hex fixture could not see it.
         */
        lineDigest: z.string().regex(/^v\d+:[0-9a-f]{64}$/),
        /**
         * The requesting cook, for the corrections tier's personal scope (R22). Absent means unattended:
         * global corrections only.
         */
        userId: z.string().min(1).max(255).optional(),
        /** ISO-8601 instant the job accepted the line. */
        requestedAt: z.iso.datetime(),
    })
    .strict();

export type ParseLineJobMessage = z.infer<typeof parseLineJobMessageSchema>;
