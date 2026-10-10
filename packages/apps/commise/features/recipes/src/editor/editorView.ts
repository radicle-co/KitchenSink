/**
 * @module @commise/features-recipes/editor — what the editor shows, projected from its state core (`editorCore.ts`),
 * its lane (`writeLane.ts`) and the outbox's parked records. Every function here is a pure projection the editor hook
 * calls once per render, so the hook itself decides nothing about how its state reads.
 *
 * Pure and platform-agnostic. No React, no platform APIs.
 *
 * @pattern Policy — pure projections of the editor's sources into what its containers read
 */
import type { Locale } from '@commise/i18n';
import type { RecipeDetail, VersionConflictSide } from '@kitchensink/recipe-core';
import { classifyFailure, type FailureClass, type SyncFailure } from '@kitchensink/sync';

import { recipeFormValuesEqual, type RecipeFormValues } from '../form/values.js';
import type { IngredientLineNameMessages } from '../messages.js';
import { computeConflictDiff } from '../versions/conflictDiff.js';
import { applyServerSnapshotToRecipeDetail, draftToSnapshot } from '../versions/merge.js';
import { lifecycleOf, type CheckpointTrigger, type RecipeLifecycle } from './checkpointPolicy.js';
import { serverIdOf, serverValuesOf, type ConflictInfo, type EditorCoreState, type ServerFacts } from './editorCore.js';
import { discardPlanOf, type DiscardPlan } from './editorIntents.js';
import { saveStatusOf, type DraftKeep, type MementoWrite, type OutboxSlot, type SaveStatus } from './saveStatus.js';
import type { LaneState, OutstandingWrite } from './writeLane.js';

/** A parked outbox record, as the outbox reports it (the app's `ParkedFailure`, structurally). */
export type ParkedRecord = SyncFailure & { readonly seq: number };

/** The write a parked record stands for, and how it failed. */
export interface ParkedView {
    readonly failure: FailureClass;
    readonly kind: 'create' | 'update';
}

/**
 * The recipe the editor is about: the server's last answer, or a newer read of the SAME recipe, which refreshes its
 * status (published elsewhere) and never its content. Pure.
 *
 * @param server - What the server is known to hold.
 * @param seedRecipe - The container's current read.
 * @returns The recipe to read the lifecycle from, or `undefined` before the server create.
 */
export function liveRecipeOf(server: ServerFacts, seedRecipe: RecipeDetail | undefined): RecipeDetail | undefined {
    if (server.kind !== 'stored') {
        return undefined;
    }

    const known = server.recipe;

    return seedRecipe !== undefined && seedRecipe.id === known.id && seedRecipe.currentVersion > known.currentVersion
        ? seedRecipe
        : known;
}

/** What {@link earlierParkedOf} reads. */
export interface EarlierParkedInput {
    readonly failures: readonly ParkedRecord[];
    readonly lane: LaneState;
    /** The ref the recipe's writes are recorded under. */
    readonly ref: string | undefined;
    /** A record the caller has just withdrawn: the outbox may still list it until its next read. */
    readonly withdrawn?: number;
}

/**
 * A write parked in an earlier session for this recipe. It stands in the lane until the cook decides (ADR-0057): the
 * outbox reports it, so it is read from there rather than copied into the lane. Pure.
 *
 * @param input - The outbox's parked records, the lane, the recipe's ref and a record just withdrawn.
 * @returns The record, or `undefined`.
 */
export function earlierParkedOf(input: EarlierParkedInput): ParkedRecord | undefined {
    const { failures, lane, ref, withdrawn } = input;

    if (lane.outstanding !== undefined || ref === undefined) {
        return undefined;
    }

    return failures.find(
        (failure) => failure.entity === 'recipe' && failure.localId === ref && failure.seq !== withdrawn,
    );
}

/**
 * The write the editor waits on: the lane's, or an earlier session's parked record standing in it. Pure.
 *
 * @param lane - The lane.
 * @param earlier - An earlier session's parked record ({@link earlierParkedOf}).
 * @param draft - The draft, which a parked earlier record stands in for.
 * @returns The outstanding write, or `undefined`.
 */
export function outstandingOf(
    lane: LaneState,
    earlier: ParkedRecord | undefined,
    draft: RecipeFormValues,
): OutstandingWrite | undefined {
    if (lane.outstanding !== undefined || earlier === undefined) {
        return lane.outstanding;
    }

    return {
        seq: earlier.seq,
        kind: earlier.intentKind === 'create' ? 'create' : 'update',
        sent: draft,
        finishing: false,
        parked: true,
    };
}

/**
 * The parked write the cook has to decide on: an outbox record, or a held re-pick whose drain failed. Pure.
 *
 * @param outstanding - The outstanding write.
 * @param failures - The outbox's parked records, for the failure's class.
 * @param drainFailed - A held re-pick failed while Save changes drained it.
 * @returns What is parked, or `undefined`.
 */
export function parkedOf(
    outstanding: OutstandingWrite | undefined,
    failures: readonly ParkedRecord[],
    drainFailed: boolean,
): ParkedView | undefined {
    if (outstanding?.parked === true) {
        const record = failures.find((failure) => failure.seq === outstanding.seq);

        return { failure: record === undefined ? 'unknown' : classifyFailure(record), kind: outstanding.kind };
    }

    return drainFailed ? { failure: 'transient', kind: 'update' } : undefined;
}

/**
 * This recipe's server write in the outbox, for the save status. Pure.
 *
 * @param parked - What is parked ({@link parkedOf}).
 * @param outstanding - The outstanding write.
 * @returns The slot.
 */
export function outboxSlotOf(parked: ParkedView | undefined, outstanding: OutstandingWrite | undefined): OutboxSlot {
    if (parked !== undefined) {
        return { kind: 'parked', failure: parked.failure };
    }

    return outstanding === undefined ? { kind: 'none' } : { kind: 'pending' };
}

/** What {@link editorStatusOf} reads. */
export interface EditorStatusInput {
    /** The editor handed off. */
    readonly done: boolean;
    readonly conflictOpen: boolean;
    readonly outstanding: OutstandingWrite | undefined;
    /** A Publish or Save changes waits behind a write on the wire, or behind the held re-picks it drains. */
    readonly deferredFinishing: boolean;
}

/**
 * The edit lifecycle's branch: `done` once handed off, `conflict` while the view is open, `finishing` while a Publish or
 * Save changes waits for its answer (a write that parks ends the wait: the cook decides), else `editing`. Pure.
 *
 * @param input - The hand-off, the conflict, the outstanding write and a deferred finish.
 * @returns The branch.
 */
export function editorStatusOf(input: EditorStatusInput): 'done' | 'conflict' | 'finishing' | 'editing' {
    const { done, conflictOpen, outstanding, deferredFinishing } = input;

    if (done) {
        return 'done';
    }

    if (conflictOpen) {
        return 'conflict';
    }

    const parked = outstanding?.parked === true;
    const finishingWrite = outstanding?.finishing === true && !parked;

    return finishingWrite || (deferredFinishing && !parked) ? 'finishing' : 'editing';
}

/** What a conflict view is built from. */
export interface ConflictInput {
    /** The 409's `server` side. */
    readonly server: VersionConflictSide;
    /** The 409's `base` side, when the server still has the version the draft was edited from. */
    readonly base: VersionConflictSide | undefined;
    readonly draft: RecipeFormValues;
    /** The recipe the editor is about ({@link liveRecipeOf}). */
    readonly live: RecipeDetail | undefined;
    readonly lifecycle: RecipeLifecycle;
    readonly locale: Locale;
    readonly lineNames: IngredientLineNameMessages;
    readonly parkedSeq: number | undefined;
    readonly trigger: ConflictInfo['trigger'];
}

/**
 * The conflict view for a draft against a 409's sides, or `null` when the two already agree (a phantom). Pure.
 *
 * @param input - The sides, the draft, the recipe and where the conflict came from.
 * @returns The conflict, or `null`.
 */
export function conflictInfoOf(input: ConflictInput): ConflictInfo | null {
    const { server, base, draft, live } = input;
    const mineSnapshot = draftToSnapshot(draft, base?.versionNumber ?? server.versionNumber);
    const diff = computeConflictDiff(base?.snapshot, mineSnapshot, server.snapshot, input.locale, input.lineNames);

    if (diff.isEmpty || live === undefined) {
        return null;
    }

    return {
        theirs: applyServerSnapshotToRecipeDetail(live, server),
        draft,
        mergeSelections: {},
        server,
        ...(base === undefined ? {} : { base }),
        mineSnapshot,
        diff,
        versionsBehind: server.versionNumber - (base?.versionNumber ?? 0),
        neverPublished: input.lifecycle !== 'published',
        parkedSeq: input.parkedSeq,
        trigger: input.trigger,
    };
}

/** What {@link editorViewOf} projects. */
export interface EditorViewInput {
    readonly core: EditorCoreState;
    readonly lane: LaneState;
    readonly failures: readonly ParkedRecord[];
    /** The container's current read (`liveRecipeOf`). */
    readonly seedRecipe: RecipeDetail | undefined;
    readonly keep: DraftKeep;
    readonly memento: MementoWrite;
}

/** What the editor's containers read, projected once per render. */
export interface EditorView {
    readonly lifecycle: RecipeLifecycle;
    readonly serverId: string | undefined;
    readonly outstanding: OutstandingWrite | undefined;
    readonly parked: ParkedView | undefined;
    /** Whether the draft differs from what the server holds. */
    readonly changedFromServer: boolean;
    readonly saveStatus: SaveStatus;
    readonly status: ReturnType<typeof editorStatusOf>;
    readonly discard: DiscardPlan;
}

/**
 * Everything the editor shows, from its state core, its lane and the outbox's parked records. Pure.
 *
 * @param input - The sources.
 * @returns The view.
 */
export function editorViewOf(input: EditorViewInput): EditorView {
    const { core, lane, failures } = input;
    const { server, draft } = core;
    const lifecycle = lifecycleOf(liveRecipeOf(server, input.seedRecipe));
    const outstanding = outstandingOf(lane, earlierParkedOf({ failures, lane, ref: server.ref }), draft);
    const parked = parkedOf(outstanding, failures, server.kind === 'stored' && server.drainFailed);
    const serverValues = serverValuesOf(server);
    const changedFromServer = serverValues === undefined || !recipeFormValuesEqual(draft, serverValues);

    return {
        lifecycle,
        serverId: serverIdOf(server),
        outstanding,
        parked,
        changedFromServer,
        saveStatus: saveStatusOf({
            lifecycle,
            durableDevice: input.keep,
            memento: input.memento,
            outbox: outboxSlotOf(parked, outstanding),
            serverCurrent: serverValues !== undefined && !changedFromServer && outstanding === undefined,
        }),
        status: editorStatusOf({
            done: lane.closed === true,
            conflictOpen: core.conflict !== undefined,
            outstanding,
            deferredFinishing: isFinishingTrigger(lane.deferred),
        }),
        discard: discardPlanOf({
            lifecycle,
            server,
            ref: server.ref,
            outstanding,
            parkedFailure: outstanding?.parked === true ? parkedOf(outstanding, failures, false)?.failure : undefined,
        }),
    };
}

/** Whether a trigger finishes the edit: its answer takes the cook to the recipe. Pure. */
export function isFinishingTrigger(trigger: CheckpointTrigger | undefined): boolean {
    return trigger === 'publish' || trigger === 'saveChanges';
}
