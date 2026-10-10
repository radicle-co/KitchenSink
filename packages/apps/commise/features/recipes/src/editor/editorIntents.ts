/**
 * @module @commise/features-recipes/editor — the outbox intents the editor submits: a recipe write, and what a Discard
 * leaves behind. `checkpointPolicy.ts` decides WHEN the server is asked; this module decides WHAT is asked.
 *
 * Pure and platform-agnostic. No React, no platform APIs.
 *
 * @pattern Command — each intent is a self-describing write the outbox sends later (ADR-0057)
 * @pattern Policy — {@link discardPlanOf}, one pure decision of what a Discard withdraws and deletes
 */
import { RecipeStatus } from '@kitchensink/recipe-core';
import { isLocalRef, type FailureClass, type Intent } from '@kitchensink/sync';

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
}

/**
 * The recipe write for a checkpoint. ⛔ Updates start only once the create has answered; before that the create is
 * resent and the outbox coalesces. Each update names the version the editor holds (ADR-0057: the editor owns the CAS
 * token). Pure.
 *
 * @param input - What the server holds, the draft, the ref and whether to publish.
 * @returns The intent.
 */
export function recipeWriteIntent(input: RecipeWriteInput): Intent {
    const { server, draft, ref } = input;
    const status = input.publish ? RecipeStatus.PUBLISHED : undefined;

    if (server.kind !== 'stored') {
        return {
            entity: 'recipe',
            intentKind: 'create',
            localId: ref,
            produces: ref,
            dependsOn: [],
            payload: { input: toCreateRecipeInput(draft, status ?? RecipeStatus.DRAFT) },
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
}

/** How a Discard hands off. */
export type DiscardExit =
    { readonly kind: 'leftForRecipe'; readonly recipeId: string } | { readonly kind: 'discarded' };

/** What a Discard does. */
export interface DiscardPlan {
    /** The device draft to drop. */
    readonly draftRef: string | undefined;
    /** The parked record to withdraw first: the cook's confirmed Discard is the consent it needs (ADR-0057). */
    readonly withdraw: number | undefined;
    /** The delete to queue once the withdrawal is done, if the server holds (or will hold) the recipe. */
    readonly remove: Intent | undefined;
    /**
     * The only server state was a create whose outcome is unknown: it may exist on the server, and nothing can name it
     * to delete it. The container tells the cook before they confirm (code-reviewer High 1).
     */
    readonly mayLeaveServerCopy: boolean;
    readonly exit: DiscardExit;
}

/** A delete of the recipe the server knows as `id`; a local ref names the create it waits for. Pure. */
function deleteOf(id: string): Intent {
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

/**
 * What a Discard does: a published recipe's device changes are dropped and nothing else; a recipe never published is
 * deleted through the outbox if the server holds it or a create is on its way to it.
 *
 * ⛔ A PARKED CREATE IS NOT ON ITS WAY. Withdrawing it removes the only record that could produce the server id, so a
 * delete naming its local ref would wait for it forever and "not synced" would never clear (code-reviewer High 1). No
 * delete is queued; if its outcome is unknown the recipe may exist on the server, and the plan says so rather than
 * guessing.
 *
 * @param input - The lifecycle, the server facts, the ref, the outstanding write and its failure class.
 * @returns The plan. Pure.
 */
export function discardPlanOf(input: DiscardInput): DiscardPlan {
    const { server, ref, outstanding } = input;
    const serverId = serverIdOf(server);

    if (input.lifecycle === 'published' && serverId !== undefined) {
        return {
            draftRef: serverId,
            withdraw: undefined,
            remove: undefined,
            mayLeaveServerCopy: false,
            exit: { kind: 'leftForRecipe', recipeId: serverId },
        };
    }

    const parked = outstanding?.parked === true ? outstanding : undefined;
    const parkedCreate = serverId === undefined && parked?.kind === 'create';
    const createOnItsWay = outstanding !== undefined && parked === undefined;
    const target = serverId ?? (createOnItsWay ? ref : undefined);

    return {
        draftRef: ref,
        withdraw: parked?.seq,
        remove: target === undefined ? undefined : deleteOf(target),
        mayLeaveServerCopy: parkedCreate && input.parkedFailure === 'unknown',
        exit: { kind: 'discarded' },
    };
}
