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
import type { SaveRefusalCause } from '@kitchensink/recipe-core/recipe-state';

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

/** Whether to offer the way. `host` is a source link, only if it passes the existing safe-link check. */
export type RewriteWayAnswer =
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'available'; readonly wayLineKey: RewriteWayLineKey; readonly host?: string };

/** The seam. An adapter answers only and writes nothing. */
export interface RewriteWay {
    readonly answer: (input: RewriteWayInput, signal: AbortSignal) => Promise<RewriteWayAnswer>;
}

const UNAVAILABLE: RewriteWayAnswer = { kind: 'unavailable' };

/** The stub: the way is never offered. */
export const unavailableRewriteWay: RewriteWay = { answer: () => Promise.resolve(UNAVAILABLE) };

/** The longest the sheet waits for an adapter before it opens without the way. */
export const REWRITE_WAY_DEADLINE_MS = 1500;

function isCompleteAnswer(answer: RewriteWayAnswer): boolean {
    if (answer.kind === 'unavailable') {
        return true;
    }

    return answer.kind === 'available' && REWRITE_WAY_LINE_KEYS.includes(answer.wayLineKey);
}

/**
 * Wraps an adapter so a throw, a rejection, an abort, no answer within the deadline, or an answer outside the contract
 * reads as `unavailable`. The port gets its own signal, aborted once the wrapper settles.
 *
 * @sideEffect starts and clears a timer and listens on the caller's signal.
 */
export function failClosedRewriteWay(port: RewriteWay, deadlineMs: number = REWRITE_WAY_DEADLINE_MS): RewriteWay {
    return {
        answer: async (input, signal) => {
            if (signal.aborted) {
                return UNAVAILABLE;
            }

            const own = new AbortController();
            let timer: ReturnType<typeof setTimeout> | undefined;
            const giveUp = (): void => own.abort();
            const stop = new Promise<RewriteWayAnswer>((resolve) => {
                timer = setTimeout(() => resolve(UNAVAILABLE), deadlineMs);
                signal.addEventListener('abort', () => resolve(UNAVAILABLE), { once: true });
            });

            try {
                const answer = await Promise.race([port.answer(input, own.signal), stop]);

                return isCompleteAnswer(answer) ? answer : UNAVAILABLE;
            } catch {
                return UNAVAILABLE;
            } finally {
                clearTimeout(timer);
                giveUp();
            }
        },
    };
}

/** The production binding, one for both apps. P4b replaces the inner adapter here. */
export const rewriteWay: RewriteWay = failClosedRewriteWay(unavailableRewriteWay);
