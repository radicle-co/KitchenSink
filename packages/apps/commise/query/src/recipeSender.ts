/**
 * @module @commise/query — the sender that makes the outbox actually send.
 *
 * ⛔ WITHOUT THIS THE QUEUE IS PLUMBING WITH THE WATER OFF. `SyncProvider` shipped mounted in both apps with
 * a sender that threw, so the provider ran, the notice rendered, and `pendingCount` sat at 0 forever — a
 * complete, tested layer that did nothing. This is the map from a queued intent to the real client call.
 *
 * ⛔ THE CLIENT IS RESOLVED PER CALL, NOT CAPTURED. `RecipeServiceClient` is built inside React and rebuilt
 * when the signed-in cook changes, so the accessor is injected and read at invocation time. A drain already running
 * still holds the previous cook's sender; that client's token proxy refuses to mint for the new cook (ADR-0054), and
 * the record parks (`SESSION_ENDED`).
 *
 * ⛔ THIS SENDER DOES NOT THROW FOR A RECORD IT CANNOT SEND, AND THAT IS A CORRECTNESS RULE, NOT A STYLE.
 * `drain` catches a throwing sender and parks the record as an UNKNOWN outcome: a create is then never re-sent and the
 * cook is asked to confirm a write that, for a record this sender refused, never left. So a refusal is a statused
 * result. An earlier version threw on an unsupported intent kind, and before that the drain did not catch at all, so a
 * throw at record N discarded the successful sends of records 1..N-1 and the next drain RE-SENT them — at-least-once
 * delivery, which `drainer.ts`'s own header states never happens and on which the whole "no client-minted id, no
 * `ON CONFLICT` upsert, no server change" argument rests.
 *
 * @pattern Adapter — it translates the domain's intent vocabulary into one service client's methods, and is
 *     the only module that knows both.
 */
import { isSessionSubjectChangedError, isTokenMintFailedError } from '@commise/features-account';
import {
    isInvalidRequestError,
    isRecipeNotFoundError,
    isRecipeServiceClientError,
    isSourceUnavailableError,
    isVersionConflictError,
    type RecipeServiceClient,
} from '@kitchensink/recipe-service-client';
import type { OutboxRecord, SendResult, Sender } from '@kitchensink/sync';

import type { SyncAnswer } from './syncAnswer.js';

/** What this sender reports: a send result whose answer is a recipe write's. */
type RecipeSendResult = SendResult<SyncAnswer>;

/** Resolves the client to send with, at the moment of sending. */
export type ClientAccessor = () => RecipeServiceClient | undefined;

/**
 * A refusal this sender produces itself, for a record it has no call for.
 *
 * ⛔ A TERMINAL STATUS, CHOSEN SO `classifyFailure` PARKS IT. `501` is not `409`, so it is not a conflict,
 * and `classifyFailure` does not class it `transient`, so it is not retried — it parks and surfaces in
 * `failures` for the cook. Reporting `failed` with NO status would classify `unknown`, which
 * `itemStatus.ts` defines as "may have been processed server-side", and that is the one thing this case
 * provably is not: nothing was sent at all.
 */
const NOT_IMPLEMENTED: RecipeSendResult = { outcome: 'failed', status: 501 };

/**
 * A refusal the client's token proxy produced, because the record's cook is no longer the signed-in one (ADR-0054), or
 * because it could not mint a token at all (`TokenMintFailedError`).
 *
 * ⛔ PARKED, FOR THE REASON `NOT_IMPLEMENTED` IS: nothing was sent, so it is not `unknown`, and re-sending it inside
 * this drain only meets the same refusal, so it is not transient. `401` names what happened: there is no credential for
 * this record's cook. The record stays in its cook's outbox and drains when that cook signs in again, because a drain
 * re-sends parked records.
 */
const SESSION_ENDED: RecipeSendResult = { outcome: 'failed', status: 401 };

/**
 * The service's own statement that it did NOTHING: `502 SOURCE_UNAVAILABLE`, a route that needed the food service and
 * could not ask it. Reported as `503`, the sync vocabulary for "not processed" (`@kitchensink/retry-after`), so the drain
 * retries it. A gateway's code-less 502/504 keeps its own status, which `classifyFailure` reads as unknown, because only
 * the service's code distinguishes the two.
 */
const NOT_PROCESSED: RecipeSendResult = { outcome: 'failed', status: 503 };

/**
 * Dispatch one record to the client call its entity and kind name.
 *
 * ⛔ KEYED ON `entity` AS WELL AS `intentKind`. Switching on the kind alone sent a `collection` `create` to
 * `client.createRecipe` — a write into the wrong domain, reported as a success.
 *
 * @param client - The authenticated client.
 * @param record - The record to send.
 * @returns The server id on success, or a refusal for a record this sender has no call for.
 * @sideEffect Makes an HTTP call.
 */
async function dispatch(client: RecipeServiceClient, record: OutboxRecord): Promise<RecipeSendResult> {
    const payload = record.payload as { readonly id?: string; readonly input?: Record<string, unknown> };
    const id = payload.id ?? record.localId;

    if (record.entity !== 'recipe') {
        return NOT_IMPLEMENTED;
    }

    switch (record.intentKind) {
        case 'create': {
            const created = await client.createRecipe((payload.input ?? {}) as never);

            return { outcome: 'ok', serverId: created.id, answer: { kind: 'recipeWritten', detail: created } };
        }

        case 'update': {
            const updated = await client.updateRecipe(id, (payload.input ?? {}) as never);

            return { outcome: 'ok', serverId: updated.id, answer: { kind: 'recipeWritten', detail: updated } };
        }

        case 'delete': {
            try {
                await client.deleteRecipe(id);
            } catch (error) {
                // ⛔ A DELETE THAT MEETS THE SERVICE'S OWN "NO SUCH RECIPE" IS DONE: its goal state is "the recipe
                // is gone", and a re-sent delete whose first copy landed (an unknown outcome the drain sends again)
                // answers exactly that. THIS RESTS ON THERE BEING NO ROUTE THAT UNDELETES A RECIPE (a delete is soft, a
                // second one gets `404 RECIPE_NOT_FOUND`): the day one exists, that answer could mean "not there yet"
                // and this mapping must go. ⛔ ANY OTHER 404 STAYS A FAILURE: the shared ALB's code-less 404 for a host
                // with no rule (a torn-down `recipe-pr-{N}`) says nothing about the recipe, and read as done it would
                // settle away every parked write of a recipe that still exists. Create and update keep every 404 as a
                // failure — there, an absent recipe means the write did not happen.
                if (!isRecipeNotFoundError(error)) {
                    throw error;
                }
            }

            return { outcome: 'ok', serverId: id, answer: { kind: 'recipeDeleted', id } };
        }

        // ⛔ ENUMERATED, NOT SWEPT UP BY `default`. `IntentKind` has seven members and this sender implements
        // three; naming the other four means ADDING an eighth is a COMPILE error at the `never` below rather
        // than a silent fall-through to a refusal nobody chose. The previous `default: throw` both hid that
        // and caused the re-delivery described in this module's header.
        case 'setVisibility':
        case 'createFreeform':
        case 'upload':
        case 'addMember':
            return NOT_IMPLEMENTED;

        default: {
            const unreachable: never = record.intentKind;

            return unreachable;
        }
    }
}

/**
 * Map a rejection onto the domain's failure vocabulary.
 *
 * ⛔ THROUGH THE CLIENT'S OWN TYPE GUARDS, never a structural `(error as {status}).status` read. The cast
 * threw a `TypeError` inside the catch for a non-object rejection (`Promise.reject(null)`), which escaped
 * the sender as a throw and took the re-delivery path this module's header describes.
 *
 * ⛔ AND `InvalidRequestError` IS TERMINAL, NOT `unknown`. The client throws it from `request()` when the
 * payload fails its published zod — BEFORE any HTTP call — and it carries no status, so the structural read
 * classified it `unknown`: "may have been processed server-side, so replaying it could write twice". A body
 * the client refused locally provably never left the process, and polluting `unknown` is dangerous in the
 * one direction that matters, because `unknown` is what the no-blind-retry rule keys on.
 *
 * @param error - The rejection.
 * @returns The failure to report. Pure.
 */
function failureFor(error: unknown): RecipeSendResult {
    // ⛔ A conflict's two sides travel as data: the queued write is the only thing that saw this response, and the
    // conflict view is built from them. One with no server side is a plain 409 — nothing to build a view from.
    if (isVersionConflictError(error) && error.server !== undefined) {
        return {
            outcome: 'failed',
            status: 409,
            answer: {
                kind: 'recipeConflict',
                server: error.server,
                ...(error.base === undefined ? {} : { base: error.base }),
            },
        };
    }

    if (isInvalidRequestError(error)) {
        return { outcome: 'failed', status: 400 };
    }

    // ⛔ A TOKEN THAT COULD NOT BE MINTED SENT NOTHING, the same fact as a session that ended: the proxy mints before the
    // request leaves. Reported as a statusless failure it was an UNKNOWN outcome, parked for the cook and, for a create,
    // never sent again; as `401` it drains when a credential is back (a phone offline when its token expired).
    if (isSessionSubjectChangedError(error) || isTokenMintFailedError(error)) {
        return SESSION_ENDED;
    }

    if (isSourceUnavailableError(error)) {
        return NOT_PROCESSED;
    }

    if (isRecipeServiceClientError(error) && typeof error.status === 'number') {
        return { outcome: 'failed', status: error.status };
    }

    // No status: nothing answered, or something answered in a shape the client could not read. Genuinely
    // unknown — the record parks and the cook decides, which is exactly what `unknown` is reserved for.
    return { outcome: 'failed' };
}

/**
 * Build the sender for recipe intents.
 *
 * @param clientOf - Resolves the current authenticated client.
 * @returns A {@link Sender}. @sideEffect The returned function makes HTTP calls.
 */
export function recipeSender(clientOf: ClientAccessor): Sender<SyncAnswer> {
    return async (record: OutboxRecord): Promise<RecipeSendResult> => {
        const client = clientOf();

        if (client === undefined) {
            // ⛔ NOTHING WAS SENT, so this is not an unknown outcome (a throw would be parked as one, and a create is
            // never re-sent from there). It is the same fact as a session that ended: no credential for this record,
            // re-sent when one is back.
            return SESSION_ENDED;
        }

        try {
            return await dispatch(client, record);
        } catch (error) {
            return failureFor(error);
        }
    };
}
