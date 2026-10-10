/**
 * The one-page recipe editor's lifecycle (UI overhaul slice 7; owner decisions D1, D7, D9; blueprint A3/A4; ADR-0057,
 * ADR-0058) — create and edit alike, on web and native.
 *
 * Three things hold the cook's work, each with its own owner:
 *
 * - the **device draft** (`editor/draftStore.ts`): written one second after typing stops and at every checkpoint, for
 *   every recipe, and read back on reopen — so nothing is ever lost and × never asks;
 * - the **outbox** ({@link EditorWritePort}, the app's `SyncQueue`): every server write goes through it, so a screen never
 *   branches on connectivity. `editor/checkpointPolicy.ts` decides WHEN a change becomes a server write: a recipe not
 *   yet published at checkpoints (a section change, exit, hide, ten idle seconds, Publish), a published one only at Save
 *   changes (D1);
 * - the **server**, which answers through the outbox's settlement bus, correlated by the record's sequence number.
 *
 * ⛔ **The editor's state is one value moved by pure transitions** (`editor/editorCore.ts`): the draft, what the server
 * is known to hold (a discriminated union — a recipe never stored has a ref and nothing else), the rebind commands
 * waiting for the lane and an open conflict. It is held outside React beside the lane, so a handler that runs the next
 * write reads what the previous answer just taught rather than what the last render saw. What the containers read is a
 * pure projection of it (`editor/editorView.ts`); what is sent is built by `editor/editorIntents.ts`. This hook binds
 * those to the ports and to React, and decides nothing itself.
 *
 * ⛔ **One server write per recipe at a time** (`editor/writeLane.ts`). Each update carries the version the previous
 * answer returned — the editor owns the CAS token (ADR-0057) — so a checkpoint that meets a write on the wire, or a
 * rebind command in the lane, is deferred and runs when the answer lands. Updates start only once the create has
 * answered; before that a checkpoint re-submits the create, which the outbox coalesces.
 *
 * ⛔ **No stored recipe before the first input** (A4). A local ref is minted on the first change and keys the device draft
 * only; the server create waits for the draft floor (a title within the wire's bound). The ref is never sent as an id.
 *
 * ⛔ **Seeded once.** The draft, the version it is built on and the recipe it belongs to are captured at mount from the
 * seed (a settled recipe, a device draft, or neither). A later render's recipe only refreshes the publication status of
 * the SAME recipe, never the draft, so an edit is never clobbered.
 *
 * ⛔ **409 → conflict.** A parked write whose answer carries the conflict's sides opens the conflict view; one whose
 * sides already agree with the draft (a phantom) is withdrawn and resent at the server's version. Every resolution
 * withdraws the parked record first: a parked record leaves the outbox only that way.
 *
 * **The rebind command** (ADR-0045; `docs/design/rowEditorBlueprint.md` decision 7) re-points a stored line and
 * teaches a correction. It is a direct write, not an outbox intent: it runs only while the lane is empty, holds the lane
 * while it runs, and adopts the version it returns. On a never-published draft it runs at once (it makes no version,
 * ADR-0058). ⛔ On a PUBLISHED recipe it is HELD (blueprint A3's `pendingRebinds`, owner D1): the line shows its new food
 * at once, the device draft keeps the rebind, and Save changes drains the held rebinds through the same queue BEFORE its
 * one update, so Discard takes a re-pick back and nothing reaches the server before the cook says so. A held rebind
 * whose line the cook removed is dropped; one that fails stops the save and keeps the rest for Retry.
 *
 * ⛔ **A deferred Publish or Save changes is visible and checked again.** One pressed while a write is on the wire waits
 * for its answer: the bar reads finishing meanwhile, and the draft is validated again when the Publish runs, because
 * the cook may have changed it. A write that parks ends the wait; the cook decides.
 *
 * Refs: none. Answers arrive through subscriptions read by Effect Events, and timers are effects keyed on the draft.
 *
 * @pattern State machine — the edit lifecycle as a `status`-discriminated union over a pure reducer
 *     (`editor/editorCore.ts`); the platform containers bind it and decide nothing themselves
 * @pattern Memento — the device draft, written and restored here and opaque to everyone else
 * @pattern Strategy — the checkpoint policy, keyed on the recipe's lifecycle
 * @pattern Command processor client — every server write is an intent submitted to the outbox, its answer correlated by
 *     sequence number through a Single-Flight lane
 * @pattern Command queue — rebind commands run one at a time, each sent once (`onceLineCommand`) at the address read
 *     when it goes on the wire
 */
import type { Locale } from '@commise/i18n';
import { useMessages } from '@commise/i18n/react';
import type { RecipeDetail, VersionConflictSide } from '@kitchensink/recipe-core';
import { isVersionConflictError } from '@kitchensink/recipe-service-client';
import {
    isLocalRef,
    mintLocalRef,
    type FailureClass,
    type Intent,
    type SettlementEvent,
    type SyncFailure,
} from '@kitchensink/sync';
import {
    useCallback,
    useEffect,
    useEffectEvent,
    useMemo,
    useState,
    useSyncExternalStore,
    type Dispatch,
    type SetStateAction,
} from 'react';

import {
    DEVICE_SAVE_IDLE_MS,
    SERVER_CHECKPOINT_IDLE_MS,
    lifecycleOf,
    pasteOffered,
    pastedLineKeepsSource,
    serverWriteFor,
    type CheckpointTrigger,
    type RecipeLifecycle,
} from '../editor/checkpointPolicy.js';
import { toDraftValues, type DraftMemento, type DraftStore } from '../editor/draftStore.js';
import {
    commandAddressOf,
    createEditorCoreStore,
    heldOf,
    liveHeldRebinds,
    seedEditorCore,
    serverIdOf,
    serverValuesOf,
    type ConflictInfo,
    type ConflictView,
    type EditorCoreState,
    type EditorCoreStore,
} from '../editor/editorCore.js';
import { recipeWriteIntent } from '../editor/editorIntents.js';
import {
    conflictInfoOf,
    earlierParkedOf,
    editorViewOf,
    isFinishingTrigger,
    liveRecipeOf,
    outstandingOf,
} from '../editor/editorView.js';
import { gateOutcomeOf, type GateOutcome } from '../editor/gate.js';
import type { PasteHold } from '../editor/pasteHold.js';
import type { DraftKeep, MementoWrite, SaveStatus } from '../editor/saveStatus.js';
import { createLaneStore, type LaneStore, type OutstandingWrite } from '../editor/writeLane.js';
import type { DraftAction } from '../form/draftAction.js';
import { isStoredLine, persistedLineKeysOf, type IngredientLineKey } from '../form/lineKey.js';
import { draftFloorErrors, validateRecipeForm, type RecipeFormErrors } from '../form/validate.js';
import { defaultRecipeFormValues, recipeFormValuesEqual, type RecipeFormValues } from '../form/values.js';
import { toRecipeFormValues } from '../form/wire.js';
import { recipeMessages, type IngredientLineNameMessages } from '../messages.js';
import { composeConflictMerge, type RecipeMergeSelections } from '../versions/merge.js';
import {
    lineBindingOf,
    onceLineCommand,
    type LineCommandAddress,
    type LineCommandPort,
    type LineCommandSend,
    type LineCommandOutcome,
    type PendingRebind,
    type QueuedLineCommand,
    type RebindLineSend,
} from './lineCommit.js';

/** A recipe write's answer, as the outbox's sender reports it (the app's `SyncAnswer`, structurally). */
export type EditorWriteAnswer =
    | { readonly kind: 'recipeWritten'; readonly detail: RecipeDetail }
    | { readonly kind: 'recipeConflict'; readonly server: VersionConflictSide; readonly base?: VersionConflictSide };

/** What `submitExclusive` did (the app's `ExclusiveSubmit`, structurally). */
export type EditorSubmitOutcome =
    | { readonly kind: 'queued'; readonly seq: number }
    | { readonly kind: 'inFlight'; readonly seq: number }
    | { readonly kind: 'parked'; readonly seq: number; readonly status?: number };

/** A parked write, as the outbox reports it (the app's `ParkedFailure`, structurally). */
export interface EditorParkedWrite extends SyncFailure {
    readonly seq: number;
}

/**
 * The editor's port to the offline write path: the subset of the app's `SyncQueue` (`@commise/query/sync`) it uses.
 * Injected by the container, so this package does not depend on the app layer and a test drives it with a fake.
 */
export interface EditorWritePort {
    readonly submit: (intent: Intent) => Promise<{ readonly queued: true }>;
    readonly submitExclusive: (intent: Intent) => Promise<EditorSubmitOutcome>;
    readonly withdraw: (seq: number) => Promise<void>;
    readonly subscribe: (listener: (event: SettlementEvent<EditorWriteAnswer>) => void) => () => void;
    readonly failures: readonly EditorParkedWrite[];
}

/** What the editor opens with. */
export interface EditorSeed {
    /** The recipe the server holds (edit), from the container's settled read. Absent for a new recipe. */
    readonly recipe?: RecipeDetail;
    /** The device draft for this recipe, if one was kept. */
    readonly memento?: DraftMemento;
}

/**
 * The edit lifecycle. `editing` is the form; `finishing` while a Publish or Save changes waits for its answer (the
 * primary is busy and the bar locks); `conflict` after a 409 with sides; `done` once the editor has handed off.
 */
export type EditorState =
    | { readonly status: 'editing' }
    | { readonly status: 'finishing' }
    | ({
          readonly status: 'conflict';
          /** A resolution's write is on its way. */
          readonly isResolving: boolean;
      } & ConflictView)
    | { readonly status: 'done' };

/** How the editor handed off. */
export type EditorExit =
    | { readonly kind: 'published'; readonly recipe: RecipeDetail; readonly firstPublish: boolean }
    | { readonly kind: 'changesSaved'; readonly recipe: RecipeDetail }
    /** The cook kept the server's copy, or discarded the published recipe's device changes. */
    | { readonly kind: 'leftForRecipe'; readonly recipeId: string }
    /** The cook discarded a recipe that was never published. */
    | { readonly kind: 'discarded' };

/** Options for {@link useRecipeEditor}. */
export interface UseRecipeEditorOptions {
    /** The active locale, for the conflict diff's quantity formatting. */
    readonly locale: Locale;
    /** The offline write port (the app's `SyncQueue`). */
    readonly port: EditorWritePort;
    /** The device draft store for the signed-in cook (`draftStoreFor`). */
    readonly drafts: DraftStore;
    /** Where the device draft is kept: on disk (native) or in this tab (web, D7). */
    readonly keep: DraftKeep;
    /** Called once when the editor hands off: the container navigates. */
    readonly onExit: (exit: EditorExit) => void;
    /** Called with a new recipe's local ref once minted, and with its server id once created (the web's URL keeps it). */
    readonly onRecipeRef?: (ref: string) => void;
    /** Sends one rebind command: how Save changes drains a published recipe's held re-picks (`useRebindIngredientLine`). */
    readonly rebindLine: RebindLineSend;
    /**
     * Whether a pasted list is still joining the draft: it holds the server create (`serverWriteFor`).
     *
     * @deprecated Pass {@link pasteHold} instead: a value passed here is copied through render, one render late.
     */
    readonly pastePending?: boolean;
    /**
     * The shared paste hold (`editor/pasteHold.ts`), made BEFORE the editor and the paste and handed to both: the paste
     * writes it where its own state changes, and a checkpoint reads it when it runs. Either it or {@link pastePending}
     * holding is enough to hold the create.
     */
    readonly pasteHold?: PasteHold;
    /** The clock, for the draft's `savedAt`. */
    readonly now?: () => Date;
}

/** The resume notice: a published recipe has device changes from an earlier visit (build spec §7.3). */
export interface ResumeNotice {
    /** When the device changes were written, ISO 8601. */
    readonly savedAt: string;
}

/** The triggers a container reports; the editor raises the timed ones, Publish and Save changes itself. */
export type ReportedTrigger = Extract<CheckpointTrigger, 'fieldBlur' | 'sectionChange' | 'editorExit' | 'appHidden'>;

/** What the editor exposes to its containers. */
export interface UseRecipeEditorResult {
    readonly state: EditorState;
    readonly values: RecipeFormValues;
    /** Field errors from the last refused Publish or Save changes (empty until then). */
    readonly errors: RecipeFormErrors;
    /** Whether Publish (or Save changes) has been refused in this editor: the section index then shows "Fix". */
    readonly publishAttempted: boolean;
    readonly lifecycle: RecipeLifecycle;
    /** The recipe's server id, once it has one. */
    readonly recipeId: string | undefined;
    readonly saveStatus: SaveStatus;
    /** The parked write the cook has to decide on, with its class; `undefined` while nothing is parked. */
    readonly parked: { readonly failure: FailureClass; readonly kind: 'create' | 'update' } | undefined;
    /** Whether the draft differs from what the server holds: a published recipe's Save changes needs it. */
    readonly hasUnsavedChanges: boolean;
    /** The resume notice, while a published recipe's device changes from an earlier visit stand. */
    readonly resume: ResumeNotice | undefined;
    /** Whether a list may be pasted into Ingredients: until the recipe's first publish (owner D10, `pasteOffered`). */
    readonly pasteAvailable: boolean;
    /** Whether a pasted line joining now keeps its source: only until the create is submitted (`pastedLineKeepsSource`). */
    readonly pasteKeepsSource: boolean;
    /**
     * Whether a Discard now may leave a copy on the server that nothing can delete: the only server state is a create
     * whose outcome is unknown (it may have reached the server). The container tells the cook when it asks them to
     * confirm (code-reviewer High 1); the editor never guesses a delete for it.
     */
    readonly discardMayLeaveServerCopy: boolean;
    readonly setValues: (values: RecipeFormValues) => void;
    readonly setField: <K extends keyof RecipeFormValues>(field: K, value: RecipeFormValues[K]) => void;
    /** Apply one draft transition to the draft as it is when it lands. Stable. */
    readonly dispatch: (action: DraftAction) => void;
    /** A checkpoint happened: a field lost focus, the section changed, the app hid, or the cook left. */
    readonly checkpoint: (trigger: ReportedTrigger) => void;
    /** Validate the whole draft and publish it. `pendingEntryText` is what an ingredient entry holds uncommitted. */
    readonly publish: (pendingEntryText: string) => GateOutcome;
    /** A published recipe's Save changes: the same gate, then one update. */
    readonly saveChanges: (pendingEntryText: string) => GateOutcome;
    /** Withdraw the parked write and send the draft again: the cook's consent to a parked record (ADR-0057). */
    readonly retry: () => void;
    /**
     * Discard: a recipe never published is deleted (its server row too, through the outbox); a published recipe's device
     * changes are dropped. The container confirms with the cook first.
     */
    readonly discard: () => void;
    /** The rebind command's port, for `useLineCommit`. */
    readonly lineCommand: LineCommandPort;
    /** Abandon an open conflict without resolving it (the conflict view's "Discard and close"). */
    readonly discardAndClose: () => void;
    readonly resolutions: {
        /** "Yours win": the draft is resent at the server's version. */
        readonly overwrite: () => void;
        /** Keep the server's copy: the draft is dropped and the editor hands off to the recipe. */
        readonly keepServer: () => void;
        /** Compose the merged draft and send it at the server's version. */
        readonly merge: (selections: RecipeMergeSelections) => void;
        readonly setMergeSelections: (selections: RecipeMergeSelections) => void;
    };
}

/** An answer on the settlement bus. */
type Settlement = SettlementEvent<EditorWriteAnswer>;

/** How a queued rebind command ended, before the editor adopts it. */
type LineCommandAnswer =
    | { readonly kind: 'recipe'; readonly detail: RecipeDetail; readonly address: LineCommandAddress }
    | { readonly kind: 'refused'; readonly server: VersionConflictSide; readonly base: VersionConflictSide | undefined }
    | { readonly kind: 'notStored' }
    | { readonly kind: 'overtaken' }
    | { readonly kind: 'failed' };

/** What the last Publish or Save changes left: its errors, whether one was refused, and the entry text it had. */
interface GateState {
    readonly errors: RecipeFormErrors;
    readonly attempted: boolean;
    /** What the ingredient entry held when Publish or Save changes was pressed: a deferred one is validated with it. */
    readonly entryText: string;
}

/**
 * Everything the editor's commands work against, rebuilt each render. The stores are the same objects for the editor's
 * life and are read with `get()`, so a command reads the current state; the rest is this render's options and setters.
 */
interface EditorContext {
    readonly core: EditorCoreStore;
    readonly lane: LaneStore<Settlement>;
    readonly opts: UseRecipeEditorOptions;
    /** The container's current read: a newer read of the same recipe refreshes its status (`liveRecipeOf`). */
    readonly seedRecipe: RecipeDetail | undefined;
    readonly now: () => Date;
    readonly lineNames: IngredientLineNameMessages;
    readonly memento: MementoWrite;
    readonly setMemento: Dispatch<SetStateAction<MementoWrite>>;
    readonly gate: GateState;
    readonly setGate: Dispatch<SetStateAction<GateState>>;
    readonly clearResume: () => void;
}

/** What a checkpoint knows beyond the stores. */
interface CheckpointOptions {
    /** A parked record the caller has just withdrawn: the outbox may still list it. */
    readonly withdrawn?: number;
    /** The held re-picks a Save changes drained have just landed: a save with nothing else to send hands off. */
    readonly drained?: boolean;
}

/** The trigger a finishing write uses for a lifecycle. Pure. */
function finishingTrigger(lifecycle: RecipeLifecycle): CheckpointTrigger {
    return lifecycle === 'published' ? 'saveChanges' : 'publish';
}

/** The lifecycle as of now. */
function lifecycleNow(ctx: EditorContext): RecipeLifecycle {
    return lifecycleOf(liveRecipeOf(ctx.core.get().server, ctx.seedRecipe));
}

/** Whether the editor has handed off: closed in the lane, which a same-tick trigger reads synchronously. */
function isClosed(ctx: EditorContext): boolean {
    return ctx.lane.get().closed === true;
}

/** The write the editor waits on as of now, an earlier session's parked record included. */
function outstandingNow(ctx: EditorContext, withdrawn?: number): OutstandingWrite | undefined {
    const lane = ctx.lane.get();
    const { server, draft } = ctx.core.get();
    const earlier = earlierParkedOf({ failures: ctx.opts.port.failures, lane, ref: server.ref, withdrawn });

    return outstandingOf(lane, earlier, draft);
}

/** Whether a paste is still joining: it holds the create. */
function pasteHeld(ctx: EditorContext): boolean {
    return ctx.opts.pastePending === true || ctx.opts.pasteHold?.get() === true;
}

// ── The device draft ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The ref the draft is kept under, minted on the first input of a new recipe (A4). @sideEffect */
function ensureRef(ctx: EditorContext): string {
    const { server } = ctx.core.get();

    if (server.ref !== undefined) {
        return server.ref;
    }

    const minted = mintLocalRef('recipe');
    ctx.core.dispatch({ type: 'refMinted', ref: minted });
    ctx.opts.onRecipeRef?.(minted);

    return minted;
}

/** Keep the draft on the device. @sideEffect */
function saveDevice(ctx: EditorContext, draft: RecipeFormValues): void {
    const ref = ensureRef(ctx);
    const { server } = ctx.core.get();

    ctx.setMemento('writing');
    void ctx.opts.drafts
        .save({
            recipeRef: ref,
            baseVersion: server.baseVersion,
            values: toDraftValues(draft),
            pendingRebinds: heldOf(server),
            savedAt: ctx.now().toISOString(),
        })
        .then(
            () => {
                ctx.setMemento((current) => (current === 'writing' ? 'written' : current));
            },
            () => {
                ctx.setMemento('failed');
            },
        );
}

/** Write the draft to the device, or remove it once the server holds exactly this draft. @sideEffect */
function writeDevice(ctx: EditorContext): void {
    // A timer can fire after the hand-off and before the render that clears it: the draft is gone, not to be rewritten.
    if (isClosed(ctx)) {
        return;
    }

    const { draft, server } = ctx.core.get();

    if (server.kind === 'unsaved' && recipeFormValuesEqual(draft, defaultRecipeFormValues())) {
        // No stored recipe before the first input: opening New recipe and leaving creates nothing.
        return;
    }

    if (server.kind === 'unsaved' || !recipeFormValuesEqual(draft, server.values)) {
        saveDevice(ctx, draft);

        return;
    }

    if (ctx.memento !== 'none') {
        ctx.setMemento('none');
        void ctx.opts.drafts.discard(server.ref);
    }
}

// ── The server write, through the outbox ─────────────────────────────────────────────────────────────────────────────

/** Whether something already stands in the lane that only the cook can clear: a conflict, or a parked write. */
function laneHeldForCook(ctx: EditorContext, withdrawn: number | undefined): boolean {
    return (
        ctx.core.get().conflict !== undefined ||
        ctx.lane.get().outstanding?.parked === true ||
        outstandingNow(ctx, withdrawn)?.parked === true
    );
}

/** A held re-pick's rebind command, for the drain. */
function drainCommand(ctx: EditorContext, rebind: PendingRebind): QueuedLineCommand {
    return {
        ...onceLineCommand(
            rebind.lineKey,
            (address) => ctx.opts.rebindLine(address, rebind.target),
            () => undefined,
        ),
        held: rebind,
    };
}

/**
 * A published recipe's held re-picks go first, through the command queue; the Save changes runs once they drain.
 * ⛔ Each stays held (so in the device draft) until its own rebind answers: a leave or a dead process mid-drain must not
 * lose a re-pick whose teaching never reached the server.
 *
 * @returns Whether re-picks are draining: the Save changes waits for them. @sideEffect Queues their commands.
 */
function drainHeld(ctx: EditorContext): boolean {
    const { server, draft, commands } = ctx.core.get();
    const held = heldOf(server);

    if (lifecycleNow(ctx) !== 'published' || held.length === 0) {
        return false;
    }

    const live = liveHeldRebinds(server, draft);
    const dropped = held.filter((rebind) => !live.includes(rebind));

    if (dropped.length > 0) {
        ctx.core.dispatch({ type: 'heldDropped', dropped });
    }

    if (live.length === 0) {
        return false;
    }

    const unqueued = live.filter((rebind) => !commands.some((command) => command.held === rebind));

    ctx.core.dispatch({ type: 'commandsQueued', commands: unqueued.map((rebind) => drainCommand(ctx, rebind)) });

    return true;
}

/** Record what the outbox did with a submitted write. @sideEffect Moves the lane. */
function recordSubmit(
    ctx: EditorContext,
    outcome: EditorSubmitOutcome,
    sent: Omit<OutstandingWrite, 'seq' | 'parked'> & {
        readonly trigger: CheckpointTrigger;
    },
): void {
    if (outcome.kind === 'inFlight') {
        ctx.lane.dispatch({ type: 'refusedInFlight', trigger: sent.trigger });

        return;
    }

    ctx.lane.dispatch({
        type: 'queued',
        seq: outcome.seq,
        kind: sent.kind,
        sent: sent.sent,
        finishing: sent.finishing,
    });

    if (outcome.kind === 'parked') {
        // A write parked earlier stands in the way: the lane tracks it, so its failure shows and Retry can withdraw it
        // with the cook's consent.
        ctx.lane.dispatch({ type: 'parked', seq: outcome.seq });
    }
}

/** A Save changes the held rebinds completed on their own: the device draft is done, and the editor hands off. */
function handOffSaved(ctx: EditorContext, detail: RecipeDetail): void {
    void ctx.opts.drafts.discard(detail.id);
    ctx.lane.dispatch({ type: 'closed' });
    ctx.opts.onExit({ kind: 'changesSaved', recipe: detail });
}

/** Submit the server write the policy asks for, if any. @sideEffect Submits to the outbox and moves the lane. */
function submitWrite(ctx: EditorContext, trigger: CheckpointTrigger, drained: boolean): void {
    const { draft, server } = ctx.core.get();
    const serverValues = serverValuesOf(server);
    const write = serverWriteFor({
        trigger,
        lifecycle: lifecycleNow(ctx),
        draftFloorMet: Object.keys(draftFloorErrors(draft)).length === 0,
        changedSinceServerWrite: serverValues === undefined || !recipeFormValuesEqual(draft, serverValues),
        pastePending: pasteHeld(ctx),
    });

    if (write.kind === 'none') {
        // Save changes whose held re-picks were all it had: the rebinds made the save, so the editor hands off.
        if (trigger === 'saveChanges' && drained && server.kind === 'stored') {
            handOffSaved(ctx, server.recipe);
        }

        return;
    }

    const intent = recipeWriteIntent({ server, draft, ref: ensureRef(ctx), publish: write.publish });
    const kind = intent.intentKind === 'create' ? 'create' : 'update';
    const finishing = isFinishingTrigger(trigger);

    void ctx.opts.port.submitExclusive(intent).then(
        (outcome) => {
            recordSubmit(ctx, outcome, { trigger, kind, sent: draft, finishing });
        },
        () => {
            ctx.setMemento('failed');
        },
    );
}

/**
 * Write the device draft and, when the policy says so, submit the server write for `trigger`. A write already in the
 * lane, a rebind command, or the held re-picks a Save changes drains first, defer it.
 *
 * @sideEffect Writes the device draft, submits to the outbox and moves the lane.
 */
function runCheckpoint(ctx: EditorContext, trigger: CheckpointTrigger, options: CheckpointOptions = {}): void {
    if (isClosed(ctx)) {
        return;
    }

    writeDevice(ctx);

    if (laneHeldForCook(ctx, options.withdrawn)) {
        return;
    }

    if (ctx.core.get().commands.length > 0 || (trigger === 'saveChanges' && drainHeld(ctx))) {
        ctx.lane.dispatch({ type: 'refusedInFlight', trigger });

        return;
    }

    submitWrite(ctx, trigger, options.drained === true);
}

/**
 * Validate the draft for a Publish or Save changes, recording the errors (and the refusal) for the form.
 *
 * @returns The gate's outcome. @sideEffect Sets the gate's state.
 */
function checkGate(ctx: EditorContext, entryText: string): Exclude<GateOutcome, { readonly kind: 'busy' }> {
    const found = validateRecipeForm(ctx.core.get().draft, entryText);
    const outcome = gateOutcomeOf(found);

    ctx.setGate((gate) => ({ errors: found, attempted: gate.attempted || outcome.kind === 'refused', entryText }));

    return outcome;
}

/**
 * Run the trigger a write on the wire deferred. A deferred Publish or Save changes is validated again first, with the
 * entry text it was pressed with: the cook may have changed the draft while it waited, and a refusal then is a refused
 * Publish like any other.
 *
 * @sideEffect Moves the lane, and may set the gate's errors or submit to the outbox.
 */
function runDeferred(ctx: EditorContext, options: CheckpointOptions = {}): void {
    const { deferred, outstanding } = ctx.lane.get();

    if (deferred === undefined || outstanding !== undefined) {
        return;
    }

    ctx.lane.dispatch({ type: 'deferredTaken' });

    if (isFinishingTrigger(deferred) && checkGate(ctx, ctx.gate.entryText).kind === 'refused') {
        return;
    }

    runCheckpoint(ctx, deferred, options);
}

// ── Answers ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The conflict view for the draft as it is now, or `null` when the sides already agree. */
function conflictFor(
    ctx: EditorContext,
    server: VersionConflictSide,
    base: VersionConflictSide | undefined,
    meta: Pick<ConflictInfo, 'parkedSeq' | 'trigger'>,
): ConflictInfo | null {
    return conflictInfoOf({
        server,
        base,
        draft: ctx.core.get().draft,
        live: liveRecipeOf(ctx.core.get().server, ctx.seedRecipe),
        lifecycle: lifecycleNow(ctx),
        locale: ctx.opts.locale,
        lineNames: ctx.lineNames,
        ...meta,
    });
}

/** A synced answer for the outstanding write: the server facts move, and a finishing write hands off. @sideEffect */
function adoptWritten(ctx: EditorContext, detail: RecipeDetail, pending: OutstandingWrite): void {
    const previousRef = ctx.core.get().server.ref;
    const wasPublished = lifecycleNow(ctx) === 'published';

    ctx.core.dispatch({ type: 'written', detail, sent: pending.sent });

    if (previousRef !== undefined && isLocalRef(previousRef)) {
        ctx.opts.onRecipeRef?.(detail.id);
    }

    if (previousRef !== undefined) {
        void ctx.opts.drafts.adopt(previousRef, { serverId: detail.id, version: detail.currentVersion });
    }

    if (!pending.finishing) {
        return;
    }

    // The recipe is on the server as the cook asked: the device draft has done its job.
    void ctx.opts.drafts.discard(detail.id);
    ctx.lane.dispatch({ type: 'closed' });
    ctx.opts.onExit(
        wasPublished
            ? { kind: 'changesSaved', recipe: detail }
            : { kind: 'published', recipe: detail, firstPublish: true },
    );
}

/** A phantom 409: the server already holds the draft's content. Withdraw and resend at its version. @sideEffect */
function resendPhantom(ctx: EditorContext, seq: number, version: number, trigger: CheckpointTrigger): void {
    void ctx.opts.port.withdraw(seq).then(() => {
        ctx.lane.dispatch({ type: 'withdrawn', seq });
        ctx.core.dispatch({ type: 'versionAdopted', version });
        runCheckpoint(ctx, trigger, { withdrawn: seq });
    });
}

/** A parked answer for the outstanding write. @sideEffect */
function onParked(ctx: EditorContext, event: Settlement, pending: OutstandingWrite): void {
    ctx.lane.dispatch({ type: 'parked', seq: event.seq });

    if (event.answer?.kind !== 'recipeConflict') {
        // A parked write waits for the cook, and so does whatever waited behind it: nothing publishes past them.
        ctx.lane.dispatch({ type: 'deferredTaken' });

        return;
    }

    const trigger = pending.finishing ? finishingTrigger(lifecycleNow(ctx)) : 'sectionChange';
    const info = conflictFor(ctx, event.answer.server, event.answer.base, { parkedSeq: event.seq, trigger });

    if (info === null) {
        resendPhantom(ctx, event.seq, event.answer.server.versionNumber, trigger);

        return;
    }

    ctx.lane.dispatch({ type: 'deferredTaken' });
    ctx.core.dispatch({ type: 'conflictOpened', info });
}

/** An answer on the settlement bus. @sideEffect */
function onSettled(ctx: EditorContext, event: Settlement): void {
    const pending = ctx.lane.get().outstanding;

    if (pending === undefined || event.seq !== pending.seq) {
        // ⛔ The outbox may answer before `submitExclusive` has told the editor this record's number.
        if (event.entity === 'recipe') {
            ctx.lane.keepEarly(event.seq, event);
        }

        return;
    }

    if (event.outcome !== 'synced') {
        onParked(ctx, event, pending);

        return;
    }

    ctx.lane.dispatch({ type: 'synced', seq: event.seq });

    if (event.answer?.kind === 'recipeWritten') {
        adoptWritten(ctx, event.answer.detail, pending);

        if (!pending.finishing) {
            runDeferred(ctx);
        }
    }
}

// ── The rebind command (ADR-0045) ────────────────────────────────────────────────────────────────────────────────────

/**
 * A held rebind that did not land stops the Save changes it was drained for: nothing more is sent. It and the held
 * rebinds queued behind it stay held, so only their commands go. @sideEffect
 */
function stopDrain(ctx: EditorContext, command: QueuedLineCommand, failed: boolean): void {
    if (command.held === undefined) {
        return;
    }

    ctx.core.dispatch({ type: 'drainCommandsCleared' });
    ctx.lane.dispatch({ type: 'deferredTaken' });

    if (failed) {
        ctx.core.dispatch({ type: 'drainFailed' });
    }
}

/** The queue is empty: what waited for it runs. @sideEffect */
function afterLastCommand(ctx: EditorContext, options: CheckpointOptions = {}): void {
    if (ctx.core.get().commands.length === 0) {
        runDeferred(ctx, options);
    }
}

/** A command that changed nothing. @sideEffect */
function commandFailed(ctx: EditorContext, command: QueuedLineCommand): void {
    command.settle({ kind: 'failed' });
    stopDrain(ctx, command, true);

    if (command.held === undefined) {
        afterLastCommand(ctx);
    }
}

/** A command the server refused with a 409. @sideEffect */
function commandRefused(
    ctx: EditorContext,
    command: QueuedLineCommand,
    answer: Extract<LineCommandAnswer, { kind: 'refused' }>,
): void {
    const info = conflictFor(ctx, answer.server, answer.base, {
        parkedSeq: undefined,
        trigger: command.held === undefined ? 'sectionChange' : 'saveChanges',
    });

    if (info === null) {
        // The draft already agrees with the server: adopt its version so the next pick is not refused again.
        // ⛔ Never the phantom resend: that would turn a Change food into a save, which teaches nothing.
        ctx.core.dispatch({ type: 'versionAdopted', version: answer.server.versionNumber });
        command.settle({ kind: 'failed' });
        stopDrain(ctx, command, true);

        return;
    }

    ctx.core.dispatch({ type: 'conflictOpened', info });
    command.settle({ kind: 'conflict' });
    stopDrain(ctx, command, false);
}

/** A command that made a version: the line and the server facts move, and what waited runs. @sideEffect */
function commandLanded(
    ctx: EditorContext,
    command: QueuedLineCommand,
    { detail, address }: Extract<LineCommandAnswer, { kind: 'recipe' }>,
): void {
    const line = toRecipeFormValues(detail).ingredients[address.position];
    // A rebind makes at most one version; an answer further on means another writer's save landed in between, and
    // adopting it would let the next write overwrite theirs. The next write meets the 409 instead.
    const adoptable =
        detail.currentVersion === address.expectedVersion || detail.currentVersion === address.expectedVersion + 1;

    // ⚠️ `line` is an index read (`noUncheckedIndexedAccess` is off): the guard is live, whatever a linter says.
    if (!adoptable || line === undefined || !isStoredLine(line)) {
        commandFailed(ctx, command);

        return;
    }

    const binding = lineBindingOf(line);

    ctx.core.dispatch({ type: 'rebound', detail, key: command.key, binding, held: command.held });
    command.settle({ kind: 'committed', binding });
    afterLastCommand(ctx, { drained: true });
}

/** Adopt a command's answer, once. @sideEffect */
function adoptCommandAnswer(ctx: EditorContext, command: QueuedLineCommand, answer: LineCommandAnswer): void {
    if (!command.claim()) {
        return;
    }

    ctx.core.dispatch({ type: 'commandDone', command });

    switch (answer.kind) {
        case 'overtaken':
            command.settle({ kind: 'conflict' });
            stopDrain(ctx, command, false);

            return;
        case 'refused':
            commandRefused(ctx, command, answer);

            return;
        case 'notStored':
            // Nothing to re-point on the server; a held one's line goes in the update as drafted.
            command.settle({ kind: 'failed' });
            afterLastCommand(ctx);

            return;
        case 'failed':
            commandFailed(ctx, command);

            return;
        case 'recipe':
            commandLanded(ctx, command, answer);

            return;

        default: {
            const unreachable: never = answer;

            return unreachable;
        }
    }
}

/**
 * Send the first queued command to where it goes now, and say how it ended.
 *
 * @sideEffect Sends the command (once, however often this runs: `onceLineCommand`).
 */
function sendCommand(
    command: QueuedLineCommand,
    address: LineCommandAddress | undefined,
    overtaken: boolean,
): Promise<LineCommandAnswer> {
    if (overtaken) {
        return Promise.resolve({ kind: 'overtaken' });
    }

    if (address === undefined) {
        return Promise.resolve({ kind: 'notStored' });
    }

    return command.send(address).then(
        (detail): LineCommandAnswer => ({ kind: 'recipe', detail, address }),
        (error: unknown): LineCommandAnswer =>
            isVersionConflictError(error) && error.server !== undefined
                ? { kind: 'refused', server: error.server, base: error.base }
                : { kind: 'failed' },
    );
}

/** Queue a rebind command run at once; the conflict view replaces the form, so nothing picks while it is open. */
function runLineCommand(
    core: EditorCoreStore,
    key: IngredientLineKey,
    send: LineCommandSend,
): Promise<LineCommandOutcome> {
    if (core.get().conflict !== undefined) {
        return Promise.resolve({ kind: 'conflict' });
    }

    return new Promise((resolve) => {
        core.dispatch({ type: 'commandsQueued', commands: [onceLineCommand(key, send, resolve)] });
    });
}

// ── Publish, Save changes, Retry and Discard ─────────────────────────────────────────────────────────────────────────

/** Publish or Save changes: the gate, then the finishing write. @sideEffect */
function finish(ctx: EditorContext, entryText: string, trigger: CheckpointTrigger): GateOutcome {
    const lane = ctx.lane.get();

    if (
        ctx.core.get().commands.length > 0 ||
        lane.outstanding?.finishing === true ||
        isFinishingTrigger(lane.deferred)
    ) {
        return { kind: 'busy' };
    }

    const outcome = checkGate(ctx, entryText);

    ctx.core.dispatch({ type: 'drainReset' });

    if (outcome.kind === 'refused') {
        return outcome;
    }

    ctx.clearResume();
    runCheckpoint(ctx, trigger);

    return outcome;
}

/** Withdraw the parked write and send the draft again, or run a stopped Save changes again. @sideEffect */
function retry(ctx: EditorContext): void {
    const { server } = ctx.core.get();

    if (server.kind === 'stored' && server.drainFailed) {
        finish(ctx, ctx.gate.entryText, 'saveChanges');

        return;
    }

    const parked = outstandingNow(ctx);

    if (parked?.parked !== true) {
        return;
    }

    const trigger = parked.finishing ? finishingTrigger(lifecycleNow(ctx)) : 'sectionChange';

    void ctx.opts.port.withdraw(parked.seq).then(() => {
        ctx.lane.dispatch({ type: 'withdrawn', seq: parked.seq });
        runCheckpoint(ctx, trigger, { withdrawn: parked.seq });
    });
}

/** Discard, as `discardPlanOf` decides it. @sideEffect */
function discard(ctx: EditorContext): void {
    const plan = editorViewOf({
        core: ctx.core.get(),
        lane: ctx.lane.get(),
        failures: ctx.opts.port.failures,
        seedRecipe: ctx.seedRecipe,
        keep: ctx.opts.keep,
        memento: ctx.memento,
    }).discard;

    ctx.lane.dispatch({ type: 'closed' });

    if (plan.draftRef !== undefined) {
        void ctx.opts.drafts.discard(plan.draftRef);
    }

    // The cook confirmed the discard, which is the consent a parked record needs before it may go.
    const cleared = plan.withdraw === undefined ? Promise.resolve() : ctx.opts.port.withdraw(plan.withdraw);
    const { remove } = plan;

    if (remove !== undefined) {
        void cleared.then(() => ctx.opts.port.submit(remove));
    }

    ctx.opts.onExit(plan.exit);
}

// ── Conflict resolutions ─────────────────────────────────────────────────────────────────────────────────────────────

/** Leave the conflict for the recipe: the device draft goes, and the editor hands off. @sideEffect */
function handOffToRecipe(ctx: EditorContext): void {
    const { server } = ctx.core.get();
    const id = serverIdOf(server) ?? server.ref;

    if (server.ref !== undefined) {
        void ctx.opts.drafts.discard(server.ref);
    }

    ctx.lane.dispatch({ type: 'closed' });
    ctx.opts.onExit(
        id !== undefined && !isLocalRef(id) ? { kind: 'leftForRecipe', recipeId: id } : { kind: 'discarded' },
    );
}

/** Withdraw the conflict's parked write (if it came from one), then run `then`. @sideEffect */
function leaveConflict(ctx: EditorContext, info: ConflictInfo, then: () => void): void {
    const { parkedSeq } = info;

    ctx.core.dispatch({ type: 'conflictResolving', resolving: true });

    const withdrawn = parkedSeq === undefined ? Promise.resolve() : ctx.opts.port.withdraw(parkedSeq);

    void withdrawn.then(
        () => {
            if (parkedSeq !== undefined) {
                ctx.lane.dispatch({ type: 'withdrawn', seq: parkedSeq });
            }

            ctx.core.dispatch({ type: 'conflictClosed' });
            then();
        },
        () => {
            ctx.core.dispatch({ type: 'conflictResolving', resolving: false });
        },
    );
}

/** Send `draft` at the server's version, after leaving the conflict. @sideEffect */
function resend(ctx: EditorContext, info: ConflictInfo, draft: RecipeFormValues): void {
    leaveConflict(ctx, info, () => {
        ctx.core.dispatch({ type: 'versionAdopted', version: info.server.versionNumber });
        ctx.core.dispatch({ type: 'draftRestored', draft });
        runCheckpoint(ctx, info.trigger, { withdrawn: info.parkedSeq });
    });
}

/** The open conflict, unless a resolution is already on its way. */
function conflictToResolve(ctx: EditorContext): ConflictInfo | undefined {
    const { conflict } = ctx.core.get();

    return conflict === undefined || conflict.resolving ? undefined : conflict.info;
}

/** The conflict resolutions. */
function resolutionsOf(ctx: EditorContext): UseRecipeEditorResult['resolutions'] {
    return {
        overwrite: () => {
            const info = conflictToResolve(ctx);

            if (info !== undefined) {
                resend(ctx, info, info.draft);
            }
        },
        keepServer: () => {
            const info = conflictToResolve(ctx);

            if (info !== undefined) {
                leaveConflict(ctx, info, () => {
                    handOffToRecipe(ctx);
                });
            }
        },
        merge: (selections) => {
            const info = conflictToResolve(ctx);

            if (info !== undefined) {
                resend(ctx, info, composeConflictMerge(info.draft, toRecipeFormValues(info.theirs), selections));
            }
        },
        setMergeSelections: (selections) => {
            ctx.core.dispatch({ type: 'mergeSelected', selections });
        },
    };
}

/** "Discard and close": the escape hatch stays available while a resolution is on its way. @sideEffect */
function discardAndClose(ctx: EditorContext): void {
    const { conflict } = ctx.core.get();

    if (conflict === undefined) {
        return;
    }

    const { parkedSeq } = conflict.info;

    ctx.core.dispatch({ type: 'conflictClosed' });

    if (parkedSeq !== undefined) {
        void ctx.opts.port.withdraw(parkedSeq).then(() => {
            ctx.lane.dispatch({ type: 'withdrawn', seq: parkedSeq });
        });
    }

    handOffToRecipe(ctx);
}

/** The edit lifecycle's state: its branch, and the open conflict's view when the branch is the conflict. Pure. */
function editorStateOf(status: 'done' | 'finishing' | 'editing' | 'conflict', core: EditorCoreState): EditorState {
    const { conflict } = core;

    if (status !== 'conflict' || conflict === undefined) {
        // `editorStatusOf` answers `conflict` only while one is open, so the second half never holds.
        return { status: status === 'conflict' ? 'editing' : status };
    }

    const { parkedSeq: _seq, trigger: _trigger, ...view } = conflict.info;

    return { status: 'conflict', ...view, isResolving: conflict.resolving };
}

/** The editor's stores, made once at mount from the seed. */
function createEditorStores(seed: EditorSeed) {
    const seeded = seedEditorCore(seed);

    return {
        core: createEditorCoreStore(seeded.core),
        lane: createLaneStore<Settlement>(),
        resume: seeded.resumeSavedAt === undefined ? undefined : { savedAt: seeded.resumeSavedAt },
    };
}

/** The idle timers: the device draft after a pause, a never-published draft's server checkpoint after a longer one. */
function useIdleTimers(ctx: EditorContext, draft: RecipeFormValues, armed: boolean): void {
    const writeDeviceNow = useEffectEvent((): void => {
        writeDevice(ctx);
    });
    const checkpointNow = useEffectEvent((): void => {
        runCheckpoint(ctx, 'checkpointIdle');
    });

    useEffect(() => {
        if (!armed) {
            return undefined;
        }

        const device = setTimeout(() => {
            writeDeviceNow();
        }, DEVICE_SAVE_IDLE_MS);
        const server = setTimeout(() => {
            checkpointNow();
        }, SERVER_CHECKPOINT_IDLE_MS);

        return () => {
            clearTimeout(device);
            clearTimeout(server);
        };
    }, [draft, armed]);
}

/** The settlement subscriptions: the outbox's bus, and the answers that came before the lane recorded their record. */
function useSettlements(ctx: EditorContext, port: EditorWritePort): void {
    // ⛔ An Effect Event, so the subscription is made once and every answer is read against the editor as it is now.
    const settled = useEffectEvent((event: Settlement): void => {
        onSettled(ctx, event);
    });
    const { lane } = ctx;

    useEffect(
        () =>
            port.subscribe((event) => {
                settled(event);
            }),
        [port],
    );
    useEffect(
        () =>
            lane.subscribeEarly((event) => {
                settled(event);
            }),
        [lane],
    );
}

/** The command queue's runner: the first command goes once nothing else holds the lane. */
function useCommandRunner(ctx: EditorContext, core: EditorCoreState, outstanding: OutstandingWrite | undefined): void {
    const firstCommand = core.commands[0];
    const settleable = firstCommand !== undefined && outstanding === undefined;
    const overtaken = core.conflict !== undefined;
    const adopt = useEffectEvent((command: QueuedLineCommand, answer: LineCommandAnswer): void => {
        adoptCommandAnswer(ctx, command, answer);
    });
    // Where the first command goes, read when it is SENT: the write it waited for may have moved the version.
    const addressOf = useEffectEvent((command: QueuedLineCommand): LineCommandAddress | undefined =>
        commandAddressOf(ctx.core.get().server, command.key),
    );

    useEffect(() => {
        if (!settleable) {
            return;
        }

        void sendCommand(firstCommand, overtaken ? undefined : addressOf(firstCommand), overtaken).then((answer) => {
            adopt(firstCommand, answer);
        });
    }, [settleable, overtaken, firstCommand]);
}

/**
 * The one-page editor's lifecycle.
 *
 * @param seed - The settled recipe (edit) and the device draft, if any. Captured once, at mount.
 * @param opts - The write port, the draft store, where drafts are kept, and the hand-off.
 * @returns The state, the controlled draft, and the editor's commands.
 */
export function useRecipeEditor(seed: EditorSeed, opts: UseRecipeEditorOptions): UseRecipeEditorResult {
    const { ingredientLineName } = useMessages(recipeMessages);
    const [stores] = useState(() => createEditorStores(seed));
    const core = useSyncExternalStore(stores.core.subscribe, stores.core.get, stores.core.get);
    const lane = useSyncExternalStore(stores.lane.subscribe, stores.lane.get, stores.lane.get);
    const [resume, setResume] = useState<ResumeNotice | undefined>(stores.resume);
    const [memento, setMemento] = useState<MementoWrite>(stores.resume === undefined ? 'none' : 'written');
    const [gate, setGate] = useState<GateState>({ errors: {}, attempted: false, entryText: '' });
    const ctx: EditorContext = {
        core: stores.core,
        lane: stores.lane,
        opts,
        seedRecipe: seed.recipe,
        now: opts.now ?? (() => new Date()),
        lineNames: ingredientLineName,
        memento,
        setMemento,
        gate,
        setGate,
        clearResume: () => {
            setResume(undefined);
        },
    };
    const view = editorViewOf({
        core,
        lane,
        failures: opts.port.failures,
        seedRecipe: seed.recipe,
        keep: opts.keep,
        memento,
    });
    const serverValues = serverValuesOf(core.server);
    const persistedKeys = useMemo(() => persistedLineKeysOf(serverValues?.ingredients ?? []), [serverValues]);

    useSettlements(ctx, opts.port);
    useIdleTimers(ctx, core.draft, core.touched && view.status !== 'done');
    useCommandRunner(ctx, core, view.outstanding);

    // ── The draft's public mutators ──────────────────────────────────────────────────────────────────────────────────
    const setValues = useCallback(
        (next: RecipeFormValues): void => {
            stores.core.dispatch({ type: 'draftReplaced', draft: next });
        },
        [stores],
    );
    const setField = useCallback(
        <K extends keyof RecipeFormValues>(field: K, value: RecipeFormValues[K]): void => {
            stores.core.dispatch({ type: 'draftReplaced', draft: { ...stores.core.get().draft, [field]: value } });
        },
        [stores],
    );
    const dispatch = useCallback(
        (action: DraftAction): void => {
            stores.core.dispatch({ type: 'draftActed', action });
        },
        [stores],
    );

    return {
        state: editorStateOf(view.status, core),
        values: core.draft,
        errors: gate.errors,
        publishAttempted: gate.attempted,
        lifecycle: view.lifecycle,
        recipeId: view.serverId,
        saveStatus: view.saveStatus,
        parked: view.parked,
        hasUnsavedChanges: view.changedFromServer,
        resume,
        pasteAvailable: pasteOffered(view.lifecycle),
        pasteKeepsSource: pastedLineKeepsSource({
            lifecycle: view.lifecycle,
            createSubmitted: view.outstanding?.kind === 'create',
        }),
        discardMayLeaveServerCopy: view.discard.mayLeaveServerCopy,
        setValues,
        setField,
        dispatch,
        checkpoint: (trigger) => {
            runCheckpoint(ctx, trigger);
        },
        publish: (pendingEntryText) => finish(ctx, pendingEntryText, 'publish'),
        saveChanges: (pendingEntryText) => finish(ctx, pendingEntryText, 'saveChanges'),
        retry: () => {
            retry(ctx);
        },
        discard: () => {
            discard(ctx);
        },
        lineCommand: {
            persistedKeys,
            holdsRebinds: view.lifecycle === 'published',
            hold: (rebind, binding) => {
                stores.core.dispatch({ type: 'rebindHeld', rebind, binding });
            },
            run: (key, send) => runLineCommand(stores.core, key, send),
        },
        discardAndClose: () => {
            discardAndClose(ctx);
        },
        resolutions: resolutionsOf(ctx),
    };
}
