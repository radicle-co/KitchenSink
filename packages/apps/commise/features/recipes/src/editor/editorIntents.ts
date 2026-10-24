/**
 * @module @commise/features-recipes/editor — the outbox intents the editor submits: a recipe write, and what a Discard
 * leaves behind. `checkpointPolicy.ts` decides WHEN the server is asked; this module decides WHAT is asked.
 *
 * Pure and platform-agnostic. No React, no platform APIs.
 *
 * @pattern Command — each intent is a self-describing write the outbox sends later (ADR-0057)
 * @pattern Policy — {@link discardPlanOf}, one pure decision of what a Discard withdraws and deletes
 */
import { RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { isLocalRef, type FailureClass, type Intent } from '@kitchensink/sync';

import { effectiveVisibility, type PrivateRefusal } from '../actions/privateGate.js';
import type { RecipeFormValues } from '../form/values.js';
import { toCreateRecipeInput, toUpdateRecipeInput } from '../form/wire.js';
import type { RecipeLifecycle } from './checkpointPolicy.js';
import { serverIdOf, type ServerFacts } from './editorCore.js';
import type { OutstandingWrite } from './writeLane.js';

/** What {@link recipeWriteIntent} builds from. */
export interface RecipeWriteInput {
    readonly server: ServerFacts;
    readonly draft: RecipeFormValues;
    /** The ref the recipe is kept under (`ensureRef`): a create's local id. */
    readonly ref: string;
    /** Whether the write publishes. */
    readonly publish: boolean;
    /**
     * Why the server would refuse a change to private for this cook, if it is known to (`privateRefusalOf`). REQUIRED: a
     * create is the one queued write that carries visibility, so every caller has to say whether a Private may go out.
     */
    readonly privateRefusal: PrivateRefusal | undefined;
}

/**
 * The recipe write for a checkpoint. ⛔ Updates start only once the create has answered; before that the create is
 * resent and the outbox coalesces. Each update names the version the editor holds (ADR-0057: the editor owns the CAS
 * token). Pure.
 *
 * ⛔ A create never carries a Private the server is known to refuse: it would park behind a Try again that cannot
 * succeed. It goes out public — a draft is the owner's alone whatever its visibility — and the publish-time follow-up
 * says why it stayed public (`visibilityFollowUp`). Try again builds a fresh intent, so a parked create heals the same way.
 *
 * @param input - What the server holds, the draft, the ref and whether to publish.
 * @returns The intent.
 */
export function recipeWriteIntent(input: RecipeWriteInput): Intent {
    const { server, draft, ref } = input;
    const status = input.publish ? RecipeStatus.PUBLISHED : undefined;

    if (server.kind !== 'stored') {
        const create = toCreateRecipeInput(draft, status ?? RecipeStatus.DRAFT);

        return {
            entity: 'recipe',
            intentKind: 'create',
            localId: ref,
            produces: ref,
            dependsOn: [],
            // A recipe the server has never stored holds nothing private, so the held visibility is Public.
            payload: {
                input: {
                    ...create,
                    visibility: effectiveVisibility(input.privateRefusal, RecipeVisibility.PUBLIC, draft.visibility),
                },
            },
        };
    }

    const id = server.recipe.id;

    return {
        entity: 'recipe',
        intentKind: 'update',
        localId: id,
        dependsOn: [],
        payload: { id, input: { ...toUpdateRecipeInput(draft, status), expectedVersion: server.baseVersion } },
    };
}

/** What {@link discardPlanOf} decides from. */
export interface DiscardInput {
    readonly lifecycle: RecipeLifecycle;
    readonly server: ServerFacts;
    /** The ref the device draft is kept under. */
    readonly ref: string | undefined;
    /** The write the editor waits on, an earlier session's parked record included. */
    readonly outstanding: OutstandingWrite | undefined;
    /** The class of the parked write's failure, when it is parked. */
    readonly parkedFailure: FailureClass | undefined;
    /** Whether a drain re-sends the parked write by itself (`resendsWhenParked`): it may then land at any moment. */
    readonly parkedResends: boolean;
}

/** How a Discard hands off. */
export type DiscardExit =
    { readonly kind: 'leftForRecipe'; readonly recipeId: string } | { readonly kind: 'discarded' };

/** The delete a Discard queues, and how. */
export type DiscardRemove =
    /** The server holds the recipe: its delete goes behind whatever of it is still queued (`supersede`). */
    | { readonly kind: 'byId'; readonly intent: Intent }
    /**
     * Only a create can have made it, and it may be queued, on the wire, parked, synced or never sent — which only the
     * outbox knows. The delete is submitted exclusively (`appendExclusive`), and a create on the wire is waited for.
     */
    | { readonly kind: 'ofCreate'; readonly intent: Intent };

/** What a Discard does. */
export interface DiscardPlan {
    /** The device draft to drop. */
    readonly draftRef: string | undefined;
    /**
     * The parked record to withdraw: the cook's confirmed Discard is the consent it needs (ADR-0057). Where a delete is
     * queued too, `SyncQueue.discard` withdraws it with the delete in one change.
     */
    readonly withdraw: number | undefined;
    /** The delete to queue once the withdrawal is done, if the server holds (or may come to hold) the recipe. */
    readonly remove: DiscardRemove | undefined;
    /**
     * The only server state is a parked create that may exist on the server — its outcome is unknown, or a drain re-sends
     * it by itself and may claim it before the Discard acts — and nothing can name it to delete it. The container tells
     * the cook before they confirm (code-reviewer High 1).
     */
    readonly mayLeaveServerCopy: boolean;
    /**
     * A published recipe's parked Save changes may land whatever the Discard does: its outcome is unknown (it may already
     * have), or a drain re-sends it by itself and may claim it before the Discard acts. The confirm then cannot promise
     * those changes are gone, and says so (`discard.changesMayStandBody`).
     */
    readonly savedChangesMayStand: boolean;
    readonly exit: DiscardExit;
}

/**
 * A delete of the recipe the server knows as `id`; a local ref names the create it waits for. Pure.
 *
 * @param id - The server id, or the create's local ref.
 * @returns The intent.
 */
export function recipeDeleteIntent(id: string): Intent {
    // ⛔ A server id is never a dependency (`appendIntent` refuses it); a local ref is, so the delete drains after the
    // create and is sent with the id the create returns.
    return {
        entity: 'recipe',
        intentKind: 'delete',
        localId: id,
        dependsOn: isLocalRef(id) ? [id] : [],
        payload: { id },
    };
}

/** The delete for a recipe the server knows as `serverId`, or that a create of `ref` may still make. Pure. */
function removeOf(serverId: string | undefined, ref: string | undefined): DiscardRemove | undefined {
    if (serverId !== undefined) {
        return { kind: 'byId', intent: recipeDeleteIntent(serverId) };
    }

    return ref === undefined ? undefined : { kind: 'ofCreate', intent: recipeDeleteIntent(ref) };
}

/**
 * What a Discard does: a published recipe's device changes are dropped, and so is an earlier Save changes that parked
 * (the Discard is the consent); a recipe never published is deleted through the outbox if the server holds it or a
 * create may still make it.
 *
 * ⛔ A PARKED CREATE IS NOT ON ITS WAY. Withdrawing it removes the only record that could produce the server id, so a
 * delete naming its local ref would wait for it forever and "not synced" would never clear (code-reviewer High 1). No
 * delete is queued; if its outcome is unknown the recipe may exist on the server, and the plan says so rather than
 * guessing.
 *
 * ⛔ ANY OTHER RECIPE THE SERVER MAY NOT HOLD YET IS ASKED OF THE OUTBOX, whatever this editor's lane says: a create
 * another editor of the recipe queued (an exit checkpoint, then Back and Forward) is invisible to this lane. The
 * outbox removes a queued create, reports one on the wire to wait for, and queues nothing for a ref nothing produced.
 *
 * @param input - The lifecycle, the server facts, the ref, the outstanding write and its failure class.
 * @returns The plan. Pure.
 */
export function discardPlanOf(input: DiscardInput): DiscardPlan {
    const { server, ref, outstanding } = input;
    const serverId = serverIdOf(server);

    const parked = outstanding?.parked === true ? outstanding : undefined;

    if (input.lifecycle === 'published' && serverId !== undefined) {
        // ⛔ AN EARLIER SAVE CHANGES THAT PARKED GOES WITH THE DISCARD: it is work the cook was told about, and their
        // confirmed Discard is the consent to withdraw it. Left, it outlived the editor as "Syncing 1" for ever. One on
        // its way (pending or on the wire) is left alone: it is not parked, and only the drain may settle it. ⛔ The
        // outbox decides the withdrawal when it acts (`applyDiscard`), so the confirm promises only what holds then: a
        // write a drain re-sends by itself may be claimed first, and is told as one that may stand.
        return {
            draftRef: serverId,
            withdraw: parked?.seq,
            remove: undefined,
            mayLeaveServerCopy: false,
            savedChangesMayStand: parked !== undefined && (input.parkedFailure === 'unknown' || input.parkedResends),
            exit: { kind: 'leftForRecipe', recipeId: serverId },
        };
    }

    const parkedCreate = serverId === undefined && parked?.kind === 'create';

    return {
        draftRef: ref,
        withdraw: parked?.seq,
        remove: removeOf(serverId, parkedCreate ? undefined : ref),
        // ⛔ As for a published save: a parked create a drain re-sends by itself may be claimed before the Discard acts.
        mayLeaveServerCopy: parkedCreate && (input.parkedFailure === 'unknown' || input.parkedResends),
        savedChangesMayStand: false,
        exit: { kind: 'discarded' },
    };
}
