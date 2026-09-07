/**
 * THE PARSE-JOB WIRE CONTRACT (plan U9, origin D9/R13) — authored beside `parseJobs.controller.ts` and
 * copied to `@kitchensink/schema-recipe` by `contract:generate` (ADR-0014).
 *
 * ## The three rules this contract carries
 *
 *  1. **Admission is `parseJobText.ts`'s** (`@kitchensink/recipe-core`). The `superRefine` splits with the
 *     SAME function the service stores with, so a request that validates is exactly the job that gets
 *     created — R17's digest guard presumes one answer to "what is a line".
 *  2. **Refusals are rejections, never truncations** (ADR-0024's over-cap rule): an over-long line names
 *     its index so the caller can fix THAT line; nothing is silently trimmed to fit.
 *  3. **Proposals only (R19).** The proposal wire shape is a PROJECTION of the worker's stored
 *     `ParsedLine` and deliberately carries NO food id and no resolution: a parse proposes text, and the
 *     reviewed draft binds foods through ordinary `POST /recipes` (`by-food` admission re-validates every
 *     id). A wire field for a binding here would let the parse do what only the reviewed create may.
 *
 * ⚠️ `reviewReasons` is `string[]` on the wire ON PURPOSE: the reason taxonomy lives in
 * `@kitchensink/recipe-import-core` (`IngredientReviewReason`), which is NOT an admissible contract import
 * (the schema package admits only zod + the zod-only `@kitchensink/recipe-core` leaf — see
 * `contract/config.ts`). Clients treat reasons as opaque display keys with a fallback; enumerating them
 * here would be a second representation of that union, drifting the moment the pipeline adds one.
 */
import { z } from 'zod';
import {
    ingredientQuantitySchema,
    PARSE_JOB_LINE_MAX_CHARS,
    PARSE_JOB_TEXT_MAX_CHARS,
    refuseParseJobLines,
    splitParseJobLines,
} from '@kitchensink/recipe-core';

// ── Requests ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Body of `POST /api/v1/recipe-parse-jobs`: a pasted ingredient block.
 *
 * The outer `max` is the DERIVED text bound (never a third literal — see `PARSE_JOB_TEXT_MAX_CHARS`); the
 * `superRefine` applies the real per-line admission with the shared splitter.
 */
export const createParseJobRequestSchema = z
    .strictObject({
        /** The pasted text. Split on newlines; lines are trimmed and blank lines dropped. */
        text: z.string().min(1).max(PARSE_JOB_TEXT_MAX_CHARS),
    })
    .superRefine((body, ctx) => {
        for (const refusal of refuseParseJobLines(splitParseJobLines(body.text))) {
            ctx.addIssue({
                code: 'custom',
                path: ['text'],
                // ⚠️ Names the INDEX, never the line's content — this message reaches error envelopes and logs.
                message:
                    refusal.reason === 'line_too_long'
                        ? `line ${String(refusal.lineIndex)} exceeds ${String(PARSE_JOB_LINE_MAX_CHARS)} characters`
                        : refusal.reason === 'too_many_lines'
                          ? `too many lines (line ${String(refusal.lineIndex)} is past the cap)`
                          : 'no non-empty lines',
            });
        }
    });

export type CreateParseJobRequest = z.infer<typeof createParseJobRequestSchema>;

/** Body of `PATCH /api/v1/recipe-parse-jobs/{id}/lines/{lineIndex}`: the replacement line. */
export const editParseJobLineRequestSchema = z.strictObject({
    /** The corrected line. Trimmed before storing; whitespace-only is refused (an edit is not a delete). */
    sourceLine: z
        .string()
        .min(1)
        .max(PARSE_JOB_LINE_MAX_CHARS)
        .refine((line) => line.trim() !== '', { message: 'sourceLine is blank' }),
});

export type EditParseJobLineRequest = z.infer<typeof editParseJobLineRequestSchema>;

// ── Responses ────────────────────────────────────────────────────────────────────────────────────

/** Job lifecycle. `expired` is the TTL sweep's terminal state; `partial` means some lines are retryable. */
export const parseJobStatusSchema = z.enum(['running', 'partial', 'complete', 'expired']);

export type ParseJobStatus = z.infer<typeof parseJobStatusSchema>;

/** Per-line lifecycle. `unparseable` is terminal (R6: the validator loop exhausted); `failed_retryable` is not. */
export const parseJobLineStatusSchema = z.enum(['pending', 'parsed', 'unparseable', 'failed_retryable']);

export type ParseJobLineStatus = z.infer<typeof parseJobLineStatusSchema>;

/**
 * One food the parse proposes — a NAME to resolve, never a binding (R19: there is no id field here, by
 * construction — `parseJobs.schema.test.ts` pins the key set, so one cannot appear un-argued).
 *
 * ⚠️ LOOSE, like every response component (GR-017 §17-c's default): a client must tolerate a field a newer
 * server adds, so response strictness is reserved for the argued exemptions (`RecipeNutritionResponse`).
 * What keeps internals off the wire is the SERVICE's projection (`projectProposal` builds the body field
 * by field), not rejection at the client.
 */
export const parseProposalFoodSchema = z.object({
    /** The food's identity in the source's own words (KTD-11b: adjectives stay in the name). */
    name: z.string().min(1),
    /** What is done TO the food (`chopped`, `boiling`), or `null` when the line says nothing. */
    prep: z.string().nullable(),
});

export type ParseProposalFood = z.infer<typeof parseProposalFoodSchema>;

/** The parsed proposal for one line — the wire PROJECTION of the worker's stored `ParsedLine`. Loose (see above). */
export const parseProposalSchema = z.object({
    /** The submitted line, byte-identical (HAZ-041). */
    raw: z.string(),
    /** How much the line calls for — recipe-core's one quantity union; `absent` is never a fabricated 1. */
    quantity: ingredientQuantitySchema,
    /** The canonicalised unit, or `null` when the line states none. */
    unit: z.string().nullable(),
    /** The measure phrase exactly as the source stated it (`"a handful"`), or `null`. */
    statedMeasure: z.string().nullable(),
    /** Every food the line named, in order. May be empty (a heading is a fact, not a failure). */
    foods: z.array(parseProposalFoodSchema),
    /** Why the line still wants a human's eye — opaque keys (see the module docstring). Empty = clean. */
    reviewReasons: z.array(z.string()),
});

export type ParseProposal = z.infer<typeof parseProposalSchema>;

/** One line of a job view. Loose, like every response component. */
export const parseJobLineSchema = z.object({
    /** The line's position within the job — with the job id, its identity. */
    lineIndex: z.number().int().min(0),
    /** The stored line (trimmed at admission; edits replace it and re-drive the parse). */
    sourceLine: z.string(),
    status: parseJobLineStatusSchema,
    /** The proposal, once one landed — `null` while pending/retryable, and for an exhausted line's absence of foods see `reviewReasons`. */
    proposal: parseProposalSchema.nullable(),
});

export type ParseJobLineView = z.infer<typeof parseJobLineSchema>;

/** The job view `POST` answers with (202) and `GET` polls. Loose, like every response component. */
export const parseJobResponseSchema = z.object({
    id: z.uuid(),
    status: parseJobStatusSchema,
    createdAt: z.iso.datetime(),
    /** When the TTL sweep will expire the job if abandoned. */
    expiresAt: z.iso.datetime(),
    /** Every submitted line, in submission order. */
    lines: z.array(parseJobLineSchema),
});

export type ParseJobResponse = z.infer<typeof parseJobResponseSchema>;
