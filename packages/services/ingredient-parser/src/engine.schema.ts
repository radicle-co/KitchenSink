/**
 * THE CRF ENGINE'S WIRE CONTRACT — what a caller may ask it, and what it is allowed to answer.
 *
 * DESIGN PATTERN: **parse, don't validate**, at an inbound boundary (ADR-0015 §3, GR-016). The response
 * does not become a value until it has been through {@link parseEngineResponse}; there is no path from an
 * `InvokeCommand` payload to a `ParsedRow` that skips this module.
 *
 * ## Why an ADR-0014 INVERSE case, with no `packages/schemas/*` copy and no OpenAPI document
 *
 * ADR-0014's normal case is an HTTP service whose controller validates against zod authored beside it, with
 * a generated schema package carrying a `CONTRACT_HASH` and a derived `openapi.yaml`. Two things here are
 * different, and both point the same way:
 *
 * - **There is no HTTP surface.** The engine is reached by `lambda:InvokeFunction`, so there is no path, no
 *   method and no status code to describe. An OpenAPI document for a function that serves no HTTP API would
 *   be a document nobody can conform to — the same reason ADR-0014 forbids writing one for `usda-client`.
 * - **The answer's CONTENT is a third party's.** `handler.py` flattens whatever `ingredient-parser-nlp`
 *   returned. We own the envelope; we do not own the reading inside it, and the library's shape moves
 *   between releases. That is exactly the inverse case ADR-0014 names: validate the raw upstream shape at
 *   the boundary and declare your own type.
 *
 * So the zod is authored here, in the service that serves it, and consumers import it from this package
 * rather than redeclaring the shape. See ADR-0025.
 *
 * ## ⛔ `strictObject`, and what it is refusing
 *
 * The engine can attach a Food Data Central match to each name (`foundation_foods`). It must NEVER be
 * consumed: it would be a SECOND, unowned ingredient-resolution authority beside `resolutionCascade.ts`,
 * and it is measurably wrong — it mis-mapped soy flour in the sample. A permissive object would report
 * success and silently drop the key, which is how such a field travels one layer further each release until
 * somebody reads it. `strictObject` makes its appearance a loud failure instead.
 */
import { z } from 'zod';

/**
 * Most lines one invocation may carry.
 *
 * ⚠️ The SAME knowledge as `MAX_LINES` in `handler.py`, which enforces it at run time. Nothing in the
 * toolchain can see both — eslint does not read `.py` and the typecheck project excludes it — so
 * `__tests__/engine.schema.test.ts` parses the handler's AST and asserts the two agree.
 */
export const MAX_LINES = 200;

/** Longest single line one invocation may carry. Same cross-language seam as {@link MAX_LINES}. */
export const MAX_LINE_CHARS = 512;

/** What a caller may ask the engine. */
export const engineRequestSchema = z.strictObject({
    /**
     * The ingredient lines to read, in the order the answer will echo them back.
     *
     * Bounded at both ends on purpose: an empty batch is a caller defect (it costs a cold start to answer
     * nothing), and an unbounded batch makes the function's duration the caller's choice rather than ours.
     */
    lines: z.array(z.string().min(1).max(MAX_LINE_CHARS)).min(1).max(MAX_LINES),
});

/** One line the engine read. Every field is the parser's OWN text, never re-rendered by us. */
const parsedRowSchema = z.strictObject({
    status: z.literal('parsed'),
    /** The parser's NORMALISED sentence — what every other field below was read out of. */
    sentence: z.string(),
    /** The parser's own amount text, joined when it read several. Empty when it read none. */
    measure: z.string(),
    /** The parser's own name texts, in the order it produced them. */
    names: z.array(z.string()),
    /** `large`/`small` — an adjective the answer shape has no slot for; the comparator canonicalises it. */
    size: z.string().nullable(),
    preparation: z.string().nullable(),
    /** Trailing matter the parser declined to call a name or a preparation. */
    comment: z.string().nullable(),
});

/**
 * One line the engine could not read.
 *
 * ⛔ Failure is PER LINE. A batch of 200 must not lose 199 parses to one sentence the CRF chokes on, so the
 * result array is a discriminated union rather than the whole invocation failing.
 *
 * `reason` is the failure's CLASS NAME, never its message: a parser's message can echo the submitted line,
 * and the line is user-typed recipe text.
 */
const failedRowSchema = z.strictObject({
    status: z.literal('failed'),
    sentence: z.string(),
    reason: z.string(),
});

/** One entry in the engine's answer. */
export const engineResultSchema = z.discriminatedUnion('status', [parsedRowSchema, failedRowSchema]);

/** What the engine is allowed to answer. */
export const engineResponseSchema = z.strictObject({
    /** Which engine answered. A second engine's answer must not be mistaken for this one's. */
    engine: z.literal('crf'),
    /**
     * The engine distribution's own version, read from its installed metadata.
     *
     * Carried because it participates in the parse cache key: a CRF version bump re-partitions the CRF rows
     * and must not silently reuse the previous model's answers.
     */
    engineVersion: z.string().min(1),
    /** One result per submitted line, in the order they were submitted. */
    results: z.array(engineResultSchema),
});

/** The engine's answer, once it has been through the boundary. */
export type EngineResponse = z.infer<typeof engineResponseSchema>;

/** One line the engine read or refused. */
export type EngineResult = z.infer<typeof engineResultSchema>;

/** A request the engine will accept. */
export type EngineRequest = z.infer<typeof engineRequestSchema>;

/**
 * Read an engine response at the boundary.
 *
 * ⛔ Throws rather than returning a refusal, and the value never travels unvalidated. An
 * `InvokeCommand`'s `Payload` is untyped at the SDK, so a throttle, a truncated body or another function's
 * answer all arrive here looking like data; letting one through would put a shape nobody checked into the
 * parse cache, where it would be served to every later caller.
 *
 * @param value - The decoded invocation payload.
 * @returns The validated response. Pure.
 * @throws {Error} naming the failing paths, so "the engine changed shape" is distinguishable from "the
 *   invoke returned something else entirely".
 */
export function parseEngineResponse(value: unknown): EngineResponse {
    const parsed = engineResponseSchema.safeParse(value);

    if (!parsed.success) {
        const reasons = parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; ');

        throw new Error(`ingredient-parser: engine response is not the contracted shape (${reasons})`);
    }

    return parsed.data;
}
