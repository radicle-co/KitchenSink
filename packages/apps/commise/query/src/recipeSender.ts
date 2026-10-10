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
 * `drain` does not wrap `await send(…)`, and `flush` calls `saveOutbox` only AFTER `drain` returns — so a
 * throw at record N discards the successful sends of records 1..N-1 and the next drain RE-SENDS them. That
 * is at-least-once delivery, which `drainer.ts`'s own header states never happens and on which the whole
 * "no client-minted id, no `ON CONFLICT` upsert, no server change" argument rests. An earlier version threw
 * on an unsupported intent kind to avoid "a silent success"; parking the record is how you refuse WITHOUT
 * re-delivering everything sent before it.
 *
 * @pattern Adapter — it translates the domain's intent vocabulary into one service client's methods, and is
 *     the only module that knows both.
 */
import { isSessionSubjectChangedError } from '@commise/features-account';
import {
    isInvalidRequestError,
    isRecipeServiceClientError,
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
 * and it is not in the transient set (`429/502/503/504`), so it is not retried — it parks and surfaces in
 * `failures` for the cook. Reporting `failed` with NO status would classify `unknown`, which
 * `itemStatus.ts` defines as "may have been processed server-side", and that is the one thing this case
 * provably is not: nothing was sent at all.
 */
const NOT_IMPLEMENTED: RecipeSendResult = { outcome: 'failed', status: 501 };

/**
 * A refusal the client's token proxy produced, because the record's cook is no longer the signed-in one (ADR-0054).
 *
 * ⛔ PARKED, FOR THE REASON `NOT_IMPLEMENTED` IS: nothing was sent, so it is not `unknown`, and re-sending it inside
 * this drain only meets the same refusal, so it is not transient. `401` names what happened: there is no credential for
 * this record's cook. The record stays in its cook's outbox and drains when that cook signs in again, because a drain
 * re-sends parked records.
 */
const SESSION_ENDED: RecipeSendResult = { outcome: 'failed', status: 401 };

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
            await client.deleteRecipe(id);

            return { outcome: 'ok', serverId: id };
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

    if (isSessionSubjectChangedError(error)) {
        return SESSION_ENDED;
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
            // ⛔ THE ONE REMAINING THROW, AND IT IS SAFE FOR A REASON WORTH STATING. `clientOf` closes over a
            // value that does not change during a drain, so this fires on the FIRST record or not at all —
            // there are no earlier successes to discard. It stays a throw because "we had no client for a
            // moment" is our problem, not a decision to park in front of the cook.
            throw new Error('recipeSender: no client available to send with');
        }

        try {
            return await dispatch(client, record);
        } catch (error) {
            return failureFor(error);
        }
    };
}
