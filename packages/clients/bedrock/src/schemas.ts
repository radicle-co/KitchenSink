/**
 * Zod over the RAW `Converse` response — the boundary validation GR-015 §15-d requires of a third-party API.
 *
 * ⛔ WHY THIS EXISTS AT ALL, when the SDK already ships `ConverseCommandOutput` types. Those are TYPES: they
 * are erased at runtime and assert nothing about the object that actually arrives. `ConverseCommandOutput`
 * additionally declares almost everything optional (`output?`, `usage?`, `stopReason?`), so reading
 * `response.output.message.content[0].text` off it is a chain of assertions the compiler is happy to accept
 * and the wire is free to violate. Parsing gives the client a value whose shape is a fact.
 *
 * ⛔ AND WHY IT IS SPLIT IN TWO. {@link usageSchema} is parsed INDEPENDENTLY of {@link converseOutputSchema},
 * which looks redundant and is the point: ADR-0024's settlement is costed from `usage`, so a response whose
 * CONTENT is unreadable must still yield its token counts. Validating the whole body as one object would
 * throw both away together — and a billed response we cannot cost is the one shape that forces the counter to
 * keep a worst-case charge standing rather than settle honestly.
 *
 * ⚠️ `stopReason` is NOT restated here. The SDK ships the authoritative `StopReason` enum — including
 * `malformed_model_output` and `malformed_tool_use` — and a second copy in this file would be a list that
 * silently stops matching the service. A `stopReason` outside the enum is passed through as the string it
 * was, because the client's job is to report what happened, not to police the enum.
 */
import { z } from 'zod';

/**
 * `TokenUsage`, exactly as the API reference marks it.
 *
 * `inputTokens`, `outputTokens` and `totalTokens` are `Required: Yes`; `cacheReadInputTokens` and
 * `cacheWriteInputTokens` are `Required: No`, so they are `.optional()` and are NOT defaulted to zero here.
 * That distinction is load-bearing twice over: the counter must be able to tell "absent" from "zero" for the
 * ADR-0024 §5 alert, and the settlement must be able to tell "cost unknown" from "cost nothing".
 *
 * ⚠️ Both cache fields are unreachable at this prompt size on every candidate model — prompt-cache minimums
 * are in the low thousands of tokens (4,096 for Claude Haiku 4.5) against ~660 here. They are modelled
 * because the wire may carry them, not because we expect them.
 */
export const usageSchema = z
    .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
        cacheReadInputTokens: z.number().int().nonnegative().optional(),
        cacheWriteInputTokens: z.number().int().nonnegative().optional(),
    })
    .readonly();

/** The token counts a settlement is costed from. */
export type BedrockTokenUsage = z.infer<typeof usageSchema>;

/**
 * The single assistant text block this gate asks for.
 *
 * `z.object` (not `strictObject`): a content block may legitimately carry fields we do not read
 * (`citationsContent`, `reasoningContent`, a `cachePoint`), and refusing a response because AWS added a field
 * would turn a forward-compatible service change into a DLQ full of poison messages. What is enforced is that
 * the field we ACT on is there and is a string.
 */
const textBlockSchema = z.object({ text: z.string() });

/**
 * The `output.message.content` envelope, reduced to what the gate reads.
 *
 * The FIRST text block wins. A model may emit reasoning or tool blocks alongside the answer, and concatenating
 * them would feed the verdict parser text the model did not mean as its answer.
 */
export const converseOutputSchema = z
    .object({
        output: z.object({
            message: z.object({
                content: z.array(z.unknown()).min(1),
            }),
        }),
        stopReason: z.string().min(1),
    })
    .readonly();

/**
 * The first text block in a content array, or `undefined` when there is none.
 *
 * @param content - The validated (but still opaque) content blocks.
 * @returns The first block's text, or `undefined`. Pure.
 */
export function firstTextIn(content: readonly unknown[]): string | undefined {
    for (const block of content) {
        const parsed = textBlockSchema.safeParse(block);

        if (parsed.success) {
            return parsed.data.text;
        }
    }

    return undefined;
}
