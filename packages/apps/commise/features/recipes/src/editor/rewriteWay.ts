/**
 * @module @commise/features-recipes/editor — the rewrite seam (heldPublicSave U2, "Rewrite seam contract").
 *
 * Decides only whether the blocked-save sheet OFFERS the rewrite way and which line from a closed set it shows. The
 * server decides the outcome at Save. The stub is the production binding until P4b's signed plan replaces `adapter`
 * below; nothing else turns the way on.
 *
 * @pattern Port — `RewriteWay` is the seam P4b binds an adapter to
 * @pattern Null Object — `unavailableRewriteWay` always answers unavailable
 * @pattern Decorator — `failClosedRewriteWay` adds the deadline and fail-closed reading to any adapter
 */
import { safeHttpUrl, type SafeHttpUrl } from '@kitchensink/recipe-core/external-url';
import type { SaveRefusalCause } from '@kitchensink/recipe-core/recipe-state';
import { z } from 'zod';

/** Why a save or publish is blocked; 020 adds its own facts per kind without changing the policy's shape. */
export interface BlockCause {
    readonly kind: SaveRefusalCause;
}

/** The message keys the rewrite way's line may use. A closed set: never free text (designer DH24, DH26). */
export const REWRITE_WAY_LINE_KEYS = ['keepPublicInOwnWords'] as const;

/** One of {@link REWRITE_WAY_LINE_KEYS}. */
export type RewriteWayLineKey = (typeof REWRITE_WAY_LINE_KEYS)[number];

/** What the port is asked: no source facts, which the client does not hold. */
export interface RewriteWayInput {
    readonly recipeId: string;
    readonly door: 'save' | 'publish';
    readonly cause: BlockCause;
}

/** Whether to offer the way. `link` is the source link, present only if it passed `safeHttpUrl`. */
export type RewriteWayAnswer =
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'available'; readonly wayLineKey: RewriteWayLineKey; readonly link?: SafeHttpUrl };

/** What an adapter hands back: untrusted until the wrapper parses it. */
export interface RewriteWayPort {
    readonly answer: (input: RewriteWayInput, signal: AbortSignal) => Promise<unknown>;
}

/** The seam the sheet asks: always a parsed answer. */
export interface RewriteWay {
    readonly answer: (input: RewriteWayInput, signal: AbortSignal) => Promise<RewriteWayAnswer>;
}

/** The raw shape an adapter may answer with; the link is a plain string until it passes the safe-link check. */
export const rewriteWayRawSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('unavailable') }),
    z.object({
        kind: z.literal('available'),
        wayLineKey: z.enum(REWRITE_WAY_LINE_KEYS),
        sourceUrl: z.string().optional(),
    }),
]);

const UNAVAILABLE: RewriteWayAnswer = { kind: 'unavailable' };

/** Parses an adapter's answer. Anything outside the contract is `unavailable`; a refused URL drops only the link. */
export function parseRewriteWayAnswer(raw: unknown): RewriteWayAnswer {
    const parsed = rewriteWayRawSchema.safeParse(raw);

    if (!parsed.success || parsed.data.kind === 'unavailable') {
        return UNAVAILABLE;
    }

    const link = parsed.data.sourceUrl === undefined ? null : safeHttpUrl(parsed.data.sourceUrl);

    return { kind: 'available', wayLineKey: parsed.data.wayLineKey, ...(link === null ? {} : { link }) };
}

/** The stub: the way is never offered. */
export const unavailableRewriteWay: RewriteWayPort = { answer: () => Promise.resolve(UNAVAILABLE) };

/** The longest the sheet waits for an adapter before it opens without the way (U5: about 1 s or less). */
export const REWRITE_WAY_DEADLINE_MS = 1000;

/**
 * Wraps an adapter so a throw, a rejection, an abort, no answer within the deadline, or an answer outside the contract
 * reads as `unavailable`. The port gets its own signal, aborted once the wrapper settles.
 *
 * @sideEffect starts and clears a timer and listens on the caller's signal.
 */
export function failClosedRewriteWay(port: RewriteWayPort, deadlineMs: number = REWRITE_WAY_DEADLINE_MS): RewriteWay {
    return {
        answer: async (input, signal) => {
            if (signal.aborted) {
                return UNAVAILABLE;
            }

            const own = new AbortController();
            let timer: ReturnType<typeof setTimeout> | undefined;
            let onAbort: (() => void) | undefined;
            const stop = new Promise<RewriteWayAnswer>((resolve) => {
                timer = setTimeout(() => resolve(UNAVAILABLE), deadlineMs);
                onAbort = () => resolve(UNAVAILABLE);
                signal.addEventListener('abort', onAbort, { once: true });
            });

            try {
                return await Promise.race([port.answer(input, own.signal).then(parseRewriteWayAnswer), stop]);
            } catch {
                return UNAVAILABLE;
            } finally {
                clearTimeout(timer);

                if (onAbort !== undefined) {
                    signal.removeEventListener('abort', onAbort);
                }

                own.abort();
            }
        },
    };
}

/** The production binding, one for both apps. P4b replaces the inner adapter here. */
export const rewriteWay: RewriteWay = failClosedRewriteWay(unavailableRewriteWay);
