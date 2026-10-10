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
 * ⛔ **One server write per recipe at a time** (`editor/writeLane.ts`). Each update carries the version the previous
 * answer returned — the editor owns the CAS token (ADR-0057) — so a checkpoint that meets a write on the wire is deferred
 * and runs when the answer lands. Updates start only once the create has answered; before that a checkpoint re-submits
 * the create, which the outbox coalesces.
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
 * Refs: none. Answers arrive through a subscription read by an Effect Event, and timers are effects keyed on the draft.
 *
 * @pattern State machine — the edit lifecycle as a `status`-discriminated union with a closed set of branches; the
 *     platform containers bind it and decide nothing themselves
 * @pattern Memento — the device draft, written and restored here and opaque to everyone else
 * @pattern Strategy — the checkpoint policy, keyed on the recipe's lifecycle
 * @pattern Command processor client — every server write is an intent submitted to the outbox, its answer correlated by
 *     sequence number through a Single-Flight lane
 * @pattern Command queue — rebind commands run one at a time, each sent once (`onceLineCommand`) at the address read
 *     when it goes on the wire
 */
import type { Locale } from '@commise/i18n';
import { useMessages } from '@commise/i18n/react';
import {
    RecipeStatus,
    type RecipeDetail,
    type RecipeSnapshot,
    type VersionConflictSide,
} from '@kitchensink/recipe-core';
import { isVersionConflictError } from '@kitchensink/recipe-service-client';
import {
    classifyFailure,
    isLocalRef,
    mintLocalRef,
    type FailureClass,
    type Intent,
    type SettlementEvent,
    type SyncFailure,
} from '@kitchensink/sync';
import { useCallback, useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';

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
import { gateOutcomeOf, type GateOutcome } from '../editor/gate.js';
import {
    saveStatusOf,
    type DraftKeep,
    type MementoWrite,
    type OutboxSlot,
    type SaveStatus,
} from '../editor/saveStatus.js';
import { createLaneStore, type OutstandingWrite } from '../editor/writeLane.js';
import type { DraftAction } from '../form/draftAction.js';
import { isStoredLine, persistedLineKeysOf, storedPositionOf, type IngredientLineKey } from '../form/lineKey.js';
import { applyDraftAction } from '../form/props.js';
import { draftFloorErrors, validateRecipeForm, type RecipeFormErrors } from '../form/validate.js';
import { defaultRecipeFormValues, recipeFormValuesEqual, type RecipeFormValues } from '../form/values.js';
import { toCreateRecipeInput, toRecipeFormValues, toUpdateRecipeInput } from '../form/wire.js';
import { recipeMessages } from '../messages.js';
import { computeConflictDiff, type ConflictDiff } from '../versions/conflictDiff.js';
import {
    applyServerSnapshotToRecipeDetail,
    composeConflictMerge,
    draftToSnapshot,
    type RecipeMergeSelections,
} from '../versions/merge.js';
import {
    lineBindingOf,
    onceLineCommand,
    type LineCommandAddress,
    type LineCommandPort,
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
    | {
          readonly status: 'conflict';
          /** The winning server copy as a displayable recipe, built from the 409's own `server` side. */
          readonly theirs: RecipeDetail;
          /** The draft that lost the race. */
          readonly draft: RecipeFormValues;
          readonly mergeSelections: RecipeMergeSelections;
          readonly server: VersionConflictSide;
          /** The version the draft was edited from, when the server still has it. A never-published draft has none. */
          readonly base?: VersionConflictSide;
          readonly mineSnapshot: RecipeSnapshot;
          readonly diff: ConflictDiff;
          /** `server.versionNumber - (base?.versionNumber ?? 0)`. */
          readonly versionsBehind: number;
          /** The recipe was never published: it has no versions (ADR-0058), and the view must not speak of history. */
          readonly neverPublished: boolean;
          /** A resolution's write is on its way. */
          readonly isResolving: boolean;
      }
    | { readonly status: 'done' };

/** The conflict's data, as the editor stores it: the parked write it came from, if it came from one. */
type ConflictInfo = Omit<Extract<EditorState, { status: 'conflict' }>, 'isResolving'> & {
    readonly parkedSeq: number | undefined;
    /** The trigger of the write that met the 409, so a resolution's resend keeps its intent (a Publish still publishes). */
    readonly trigger: CheckpointTrigger;
};

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
    /** Whether a pasted list is still joining the draft: it holds the server create (`serverWriteFor`). */
    readonly pastePending: boolean;
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

/** How a queued rebind command ended, before the editor adopts it. */
type LineCommandAnswer =
    | { readonly kind: 'recipe'; readonly detail: RecipeDetail; readonly address: LineCommandAddress }
    | { readonly kind: 'refused'; readonly server: VersionConflictSide; readonly base: VersionConflictSide | undefined }
    | { readonly kind: 'notStored' }
    | { readonly kind: 'overtaken' }
    | { readonly kind: 'failed' };

/** What the editor knows of the server: what a write is built against. */
interface ServerFacts {
    readonly serverId: string | undefined;
    /** The version the next update names (`expectedVersion`). */
    readonly baseVersion: number | null;
    /** What the server holds, as form values: a checkpoint with nothing new is not sent. */
    readonly serverValues: RecipeFormValues | undefined;
    readonly lifecycle: RecipeLifecycle;
    readonly recipeRef: string | undefined;
    /** The recipe the server last answered with, when the caller has it: a Save changes with nothing left hands off to it. */
    readonly recipe?: RecipeDetail;
}

/** What a checkpoint is built from, beyond this render's draft and facts. */
interface CheckpointOptions {
    readonly draft?: RecipeFormValues;
    /** What the server holds when the caller knows more than this render (an answer, a withdrawal). */
    readonly facts?: ServerFacts;
    /** The caller has just cleared the lane: this render's conflict and command readings are stale. */
    readonly fresh?: boolean;
}

/** The trigger a finishing write uses for a lifecycle. */
function finishingTrigger(lifecycle: RecipeLifecycle): CheckpointTrigger {
    return lifecycle === 'published' ? 'saveChanges' : 'publish';
}

/** Whether a trigger finishes the edit: its answer takes the cook to the recipe. */
function isFinishing(trigger: CheckpointTrigger | undefined): boolean {
    return trigger === 'publish' || trigger === 'saveChanges';
}

/** The held rebinds with one per line, the later of two for the same line winning, in the order first held. Pure. */
function coalesceRebinds(rebinds: readonly PendingRebind[]): readonly PendingRebind[] {
    const latest = new Map(rebinds.map((rebind) => [rebind.lineKey, rebind]));

    return [...latest.values()];
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
    const { port, drafts, onExit, onRecipeRef, rebindLine, pastePending } = opts;
    const now = opts.now ?? (() => new Date());

    // ── The seed, captured once ──────────────────────────────────────────────────────────────────────────────────────
    const [initial] = useState(() => {
        const stored = seed.recipe === undefined ? undefined : toRecipeFormValues(seed.recipe);
        const remembered = seed.memento === undefined ? undefined : { ...seed.memento.values, photos: [] };
        const values = remembered ?? stored ?? defaultRecipeFormValues();
        const deviceChanges =
            remembered !== undefined && stored !== undefined && !recipeFormValuesEqual(values, stored);

        return {
            values,
            ref: seed.memento?.recipeRef ?? seed.recipe?.id,
            // ⛔ The device draft's version, not the server's: a draft edited from version 4 must name 4, so a write after
            // another device's save meets the 409 that shows the cook what changed.
            baseVersion: seed.memento?.baseVersion ?? seed.recipe?.currentVersion ?? null,
            server: seed.recipe,
            serverValues: stored,
            resume:
                deviceChanges && lifecycleOf(seed.recipe) === 'published' && seed.memento !== undefined
                    ? { savedAt: seed.memento.savedAt }
                    : undefined,
        };
    });

    const [values, setValuesState] = useState<RecipeFormValues>(initial.values);
    const [errors, setErrors] = useState<RecipeFormErrors>({});
    const [publishAttempted, setPublishAttempted] = useState(false);
    const [recipeRef, setRecipeRef] = useState<string | undefined>(initial.ref);
    const [baseVersion, setBaseVersion] = useState<number | null>(initial.baseVersion);
    const [server, setServer] = useState<RecipeDetail | undefined>(initial.server);
    const [serverValues, setServerValues] = useState<RecipeFormValues | undefined>(initial.serverValues);
    const [resume, setResume] = useState<ResumeNotice | undefined>(initial.resume);
    // The lane lives outside React state: the outbox answers on its own schedule (`createLaneStore`).
    const [laneStore] = useState(() => createLaneStore<SettlementEvent<EditorWriteAnswer>>());
    const lane = useSyncExternalStore(laneStore.subscribe, laneStore.get, laneStore.get);
    const [mementoWrite, setMementoWrite] = useState<MementoWrite>(initial.resume === undefined ? 'none' : 'written');
    const [persistedKeys, setPersistedKeys] = useState<readonly IngredientLineKey[]>(() =>
        persistedLineKeysOf((initial.serverValues ?? initial.values).ingredients),
    );
    const [queuedCommands, setQueuedCommands] = useState<readonly QueuedLineCommand[]>([]);
    // A published recipe's re-picks, held until Save changes (blueprint A3), restored from the device draft.
    const [pendingRebinds, setPendingRebinds] = useState<readonly PendingRebind[]>(
        () => seed.memento?.pendingRebinds ?? [],
    );
    // A held rebind failed while Save changes drained it: the save stopped, and Retry runs it again.
    const [rebindFailed, setRebindFailed] = useState(false);
    // What the ingredient entry held when Publish or Save changes was pressed: a deferred one is validated with it.
    const [finishEntryText, setFinishEntryText] = useState('');
    const [conflict, setConflict] = useState<ConflictInfo | null>(null);
    const [resolving, setResolving] = useState(false);
    // Whether the draft has changed since the editor opened: the idle timers arm only then.
    const [touched, setTouched] = useState(false);

    // A newer read of the SAME recipe refreshes its status (published elsewhere); never its content.
    const live =
        seed.recipe !== undefined &&
        server !== undefined &&
        seed.recipe.id === server.id &&
        seed.recipe.currentVersion > server.currentVersion
            ? seed.recipe
            : server;
    const lifecycle = lifecycleOf(live);
    const serverId = server?.id;
    const commandBusy = queuedCommands.length > 0;
    const step = laneStore.dispatch;
    // Closed in the lane, which a same-tick trigger reads synchronously (`LaneState.closed`).
    const done = lane.closed === true;
    // A Publish or Save changes waits behind a write on the wire, or behind the held rebinds it drains: the bar finishes.
    const deferredFinishing = isFinishing(lane.deferred);
    const changedFromServer = serverValues === undefined || !recipeFormValuesEqual(values, serverValues);
    // What this render knows of the server; a write answered since passes its own (`runCheckpoint`'s `facts`).
    const factsNow: ServerFacts = { serverId, baseVersion, serverValues, lifecycle, recipeRef };
    // A write parked in an earlier session for this recipe stands in the lane until the cook decides (ADR-0057): the
    // outbox reports it, so it is read from there rather than copied into the lane.
    const earlierParked =
        lane.outstanding === undefined && recipeRef !== undefined
            ? port.failures.find((failure) => failure.entity === 'recipe' && failure.localId === recipeRef)
            : undefined;
    const outstanding: OutstandingWrite | undefined =
        lane.outstanding ??
        (earlierParked === undefined
            ? undefined
            : {
                  seq: earlierParked.seq,
                  kind: earlierParked.intentKind === 'create' ? 'create' : 'update',
                  sent: values,
                  finishing: false,
                  parked: true,
              });

    // ── The device draft ─────────────────────────────────────────────────────────────────────────────────────────────
    /** The ref the draft is kept under, minted on the first input of a new recipe (A4). @sideEffect */
    const ensureRef = (known: string | undefined = recipeRef): string => {
        if (known !== undefined) {
            return known;
        }

        const minted = mintLocalRef('recipe');
        setRecipeRef(minted);
        onRecipeRef?.(minted);

        return minted;
    };

    /** Write the draft to the device, or remove it once the server holds exactly this draft. @sideEffect */
    const writeDevice = (draft: RecipeFormValues, facts: ServerFacts = factsNow): void => {
        // A timer can fire after the hand-off and before the render that clears it: the draft is gone, not to be rewritten.
        if (laneStore.get().closed === true) {
            return;
        }

        if (facts.serverValues === undefined && recipeFormValuesEqual(draft, defaultRecipeFormValues())) {
            // No stored recipe before the first input: opening New recipe and leaving creates nothing.
            return;
        }

        if (facts.serverValues !== undefined && recipeFormValuesEqual(draft, facts.serverValues)) {
            if (facts.recipeRef !== undefined && mementoWrite !== 'none') {
                setMementoWrite('none');
                void drafts.discard(facts.recipeRef);
            }

            return;
        }

        const ref = ensureRef(facts.recipeRef);
        setMementoWrite('writing');
        drafts
            .save({
                recipeRef: ref,
                baseVersion: facts.baseVersion,
                values: toDraftValues(draft),
                pendingRebinds,
                savedAt: now().toISOString(),
            })
            .then(
                () => setMementoWrite((current) => (current === 'writing' ? 'written' : current)),
                () => setMementoWrite('failed'),
            );
    };

    // ── The server write, through the outbox ─────────────────────────────────────────────────────────────────────────
    /**
     * Write the device draft and, when the policy says so, submit the server write for `trigger`.
     *
     * `facts` is what is known of the server when the caller knows more than this render (an answer just landed, a
     * parked write was just withdrawn): its state updates have not rendered yet. Such a caller has just cleared the lane
     * itself, so the render's conflict and command readings it would otherwise check are stale (`fresh`).
     *
     * @sideEffect Writes the device draft, submits to the outbox and moves the lane.
     */
    const runCheckpoint = (trigger: CheckpointTrigger, options: CheckpointOptions = {}): void => {
        const draft = options.draft ?? values;
        const facts = options.facts ?? factsNow;
        const fresh = options.fresh === true;

        if (laneStore.get().closed === true) {
            return;
        }

        writeDevice(draft, facts);

        if ((!fresh && conflict !== null) || laneStore.get().outstanding?.parked === true) {
            return;
        }

        if (!fresh && earlierParked !== undefined) {
            return;
        }

        // A rebind command holds the lane: the trigger runs once it settles.
        if (!fresh && commandBusy) {
            step({ type: 'refusedInFlight', trigger });

            return;
        }

        // A published recipe's held re-picks go first, through the command queue; the Save changes runs once they drain.
        // ⛔ Each stays in `pendingRebinds` (so in the device draft) until its own rebind answers: a leave or a dead process
        // mid-drain must not lose a re-pick whose teaching never reached the server.
        if (trigger === 'saveChanges' && facts.lifecycle === 'published' && pendingRebinds.length > 0) {
            // Dropped: one whose line the cook removed (it would teach a correction for a line the update deletes), and
            // one back to the food the server already holds — which is also how one that just answered is recognised,
            // before React has rendered its removal.
            const storedBinding = (key: IngredientLineKey): string | null | undefined =>
                facts.serverValues?.ingredients.find((line) => line.key === key)?.ingredientId;
            const live = pendingRebinds.filter((rebind) =>
                draft.ingredients.some(
                    (line) => line.key === rebind.lineKey && line.ingredientId !== storedBinding(rebind.lineKey),
                ),
            );
            const queued = (rebind: PendingRebind): boolean =>
                queuedCommands.some((command) => command.held === rebind);

            if (live.length < pendingRebinds.length) {
                const dropped = pendingRebinds.filter((rebind) => !live.includes(rebind));

                setPendingRebinds((current) => current.filter((rebind) => !dropped.includes(rebind)));
            }

            if (live.length > 0) {
                setQueuedCommands((queue) => [
                    ...queue,
                    ...live
                        .filter((rebind) => !queued(rebind))
                        .map((rebind): QueuedLineCommand => ({
                            ...onceLineCommand(
                                rebind.lineKey,
                                (address) => rebindLine(address, rebind.target),
                                () => undefined,
                            ),
                            held: rebind,
                        })),
                ]);
                step({ type: 'refusedInFlight', trigger });

                return;
            }
        }

        const write = serverWriteFor({
            trigger,
            lifecycle: facts.lifecycle,
            draftFloorMet: Object.keys(draftFloorErrors(draft)).length === 0,
            changedSinceServerWrite:
                facts.serverValues === undefined || !recipeFormValuesEqual(draft, facts.serverValues),
            pastePending,
        });

        if (write.kind === 'none') {
            // Save changes whose held re-picks were all it had: the rebinds made the save, so the editor hands off.
            if (trigger === 'saveChanges' && facts.recipe !== undefined) {
                handOffSaved(facts.recipe);
            }

            return;
        }

        const ref = ensureRef(facts.recipeRef);
        const finishing = trigger === 'publish' || trigger === 'saveChanges';
        const status = write.publish ? RecipeStatus.PUBLISHED : undefined;
        // ⛔ Updates start only once the create has answered; before that the create is resent and the outbox coalesces.
        const intent: Intent =
            facts.serverId === undefined
                ? {
                      entity: 'recipe',
                      intentKind: 'create',
                      localId: ref,
                      produces: ref,
                      dependsOn: [],
                      payload: { input: toCreateRecipeInput(draft, status ?? RecipeStatus.DRAFT) },
                  }
                : {
                      entity: 'recipe',
                      intentKind: 'update',
                      localId: facts.serverId,
                      dependsOn: [],
                      payload: {
                          id: facts.serverId,
                          input: { ...toUpdateRecipeInput(draft, status), expectedVersion: facts.baseVersion ?? 0 },
                      },
                  };
        const kind = intent.intentKind === 'create' ? 'create' : 'update';

        void port.submitExclusive(intent).then(
            (outcome) => {
                if (outcome.kind === 'inFlight') {
                    step({ type: 'refusedInFlight', trigger });

                    return;
                }

                step({ type: 'queued', seq: outcome.seq, kind, sent: draft, finishing });

                if (outcome.kind === 'parked') {
                    // A write parked earlier stands in the way: the lane tracks it, so its failure shows and Retry can
                    // withdraw it with the cook's consent.
                    step({ type: 'parked', seq: outcome.seq });

                    return;
                }
            },
            () => setMementoWrite('failed'),
        );
    };

    /**
     * Run the trigger a write on the wire deferred, against what the server is now known to hold. A deferred Publish or
     * Save changes is validated again first, with the entry text it was pressed with: the cook may have changed the
     * draft while it waited, and a refusal then is a refused Publish like any other.
     *
     * @sideEffect Moves the lane, and may set the gate's errors or submit to the outbox.
     */
    const runDeferred = (facts: ServerFacts, draft: RecipeFormValues = values): void => {
        const { deferred } = laneStore.get();

        if (deferred === undefined || laneStore.get().outstanding !== undefined) {
            return;
        }

        step({ type: 'deferredTaken' });

        if (isFinishing(deferred)) {
            const found = validateRecipeForm(draft, finishEntryText);

            setErrors(found);

            if (gateOutcomeOf(found).kind === 'refused') {
                setPublishAttempted(true);

                return;
            }
        }

        runCheckpoint(deferred, { draft, facts, fresh: true });
    };

    // A conflict view for `draft` against a 409's sides, or `null` when the two already agree.
    const conflictOf = (
        server409: VersionConflictSide,
        base: VersionConflictSide | undefined,
        draft: RecipeFormValues,
        meta: Pick<ConflictInfo, 'parkedSeq' | 'trigger'>,
    ): ConflictInfo | null => {
        const mineSnapshot = draftToSnapshot(draft, base?.versionNumber ?? server409.versionNumber);
        const diff = computeConflictDiff(
            base?.snapshot,
            mineSnapshot,
            server409.snapshot,
            opts.locale,
            ingredientLineName,
        );

        if (diff.isEmpty || live === undefined) {
            return null;
        }

        return {
            status: 'conflict',
            theirs: applyServerSnapshotToRecipeDetail(live, server409),
            draft,
            mergeSelections: {},
            server: server409,
            ...(base === undefined ? {} : { base }),
            mineSnapshot,
            diff,
            versionsBehind: server409.versionNumber - (base?.versionNumber ?? 0),
            neverPublished: lifecycle !== 'published',
            ...meta,
        };
    };

    /** A synced answer for the outstanding write; answers what the server now holds. @sideEffect */
    const adoptWritten = (detail: RecipeDetail, sent: RecipeFormValues, finishing: boolean): ServerFacts => {
        const previousRef = recipeRef;
        const wasPublished = lifecycle === 'published';

        setServer(detail);
        setServerValues(sent);
        setBaseVersion(detail.currentVersion);
        setPersistedKeys(persistedLineKeysOf(sent.ingredients));
        setRecipeRef(detail.id);

        if (previousRef !== undefined && isLocalRef(previousRef)) {
            onRecipeRef?.(detail.id);
        }

        if (previousRef !== undefined) {
            void drafts.adopt(previousRef, { serverId: detail.id, version: detail.currentVersion });
        }

        const facts: ServerFacts = {
            serverId: detail.id,
            baseVersion: detail.currentVersion,
            serverValues: sent,
            lifecycle: lifecycleOf(detail),
            recipeRef: detail.id,
        };

        if (!finishing) {
            return facts;
        }

        // The recipe is on the server as the cook asked: the device draft has done its job.
        void drafts.discard(detail.id);
        step({ type: 'closed' });
        onExit(
            wasPublished
                ? { kind: 'changesSaved', recipe: detail }
                : { kind: 'published', recipe: detail, firstPublish: true },
        );

        return facts;
    };

    /** A Save changes the held rebinds completed on their own: the device draft is done, and the editor hands off. */
    function handOffSaved(detail: RecipeDetail): void {
        void drafts.discard(detail.id);
        step({ type: 'closed' });
        onExit({ kind: 'changesSaved', recipe: detail });
    }

    // ⛔ An Effect Event, so the subscription is made once and every answer is read against the editor as it is now. The
    // lane is read from its store, which a `queued` step updates at once: an answer that lands before React has rendered
    // the lane is still recognised as this write's.
    const onSettled = useEffectEvent((event: SettlementEvent<EditorWriteAnswer>): void => {
        const pending = laneStore.get().outstanding;

        if (pending === undefined || event.seq !== pending.seq) {
            // ⛔ The outbox may answer before `submitExclusive` has told the editor this record's number.
            if (event.entity === 'recipe') {
                laneStore.keepEarly(event.seq, event);
            }

            return;
        }

        if (event.outcome === 'synced') {
            step({ type: 'synced', seq: event.seq });

            if (event.answer?.kind === 'recipeWritten') {
                const facts = adoptWritten(event.answer.detail, pending.sent, pending.finishing);

                if (!pending.finishing) {
                    runDeferred(facts);
                }
            }

            return;
        }

        step({ type: 'parked', seq: event.seq });

        if (event.answer?.kind !== 'recipeConflict') {
            // A parked write waits for the cook, and so does whatever waited behind it: nothing publishes past them.
            step({ type: 'deferredTaken' });

            return;
        }

        const trigger = pending.finishing ? finishingTrigger(lifecycle) : 'sectionChange';
        const info = conflictOf(event.answer.server, event.answer.base, values, { parkedSeq: event.seq, trigger });

        if (info !== null) {
            step({ type: 'deferredTaken' });
        }

        if (info === null) {
            // A phantom: the server already holds the draft's content. Withdraw and resend at its version.
            const { versionNumber } = event.answer.server;

            void port.withdraw(event.seq).then(() => {
                step({ type: 'withdrawn', seq: event.seq });
                setBaseVersion(versionNumber);
                runCheckpoint(trigger, { facts: { ...factsNow, baseVersion: versionNumber }, fresh: true });
            });

            return;
        }

        setConflict(info);
    });

    useEffect(() => port.subscribe((event) => onSettled(event)), [port]);
    // An answer that came before the editor knew its record's number is handed back once the lane records it.
    useEffect(() => laneStore.subscribeEarly((event) => onSettled(event)), [laneStore]);

    const writeDeviceNow = useEffectEvent((): void => writeDevice(values));
    const checkpointNow = useEffectEvent((trigger: CheckpointTrigger): void => runCheckpoint(trigger));

    // ── Timers: the device draft after a pause, a never-published draft's server checkpoint after a longer one ─────────
    useEffect(() => {
        if (!touched || done) {
            return undefined;
        }

        const device = setTimeout(() => writeDeviceNow(), DEVICE_SAVE_IDLE_MS);
        const server = setTimeout(() => checkpointNow('checkpointIdle'), SERVER_CHECKPOINT_IDLE_MS);

        return () => {
            clearTimeout(device);
            clearTimeout(server);
        };
    }, [values, touched, done]);

    // ── The draft's public mutators ──────────────────────────────────────────────────────────────────────────────────
    const setValues = useCallback((next: RecipeFormValues): void => {
        setTouched(true);
        setValuesState(next);
    }, []);

    const setField = useCallback(<K extends keyof RecipeFormValues>(field: K, value: RecipeFormValues[K]): void => {
        setTouched(true);
        setValuesState((current) => ({ ...current, [field]: value }));
    }, []);

    const dispatch = useCallback((action: DraftAction): void => {
        setTouched(true);
        setValuesState((current) => applyDraftAction(current, action));
    }, []);

    // ── Publish and Save changes ─────────────────────────────────────────────────────────────────────────────────────
    const finish = (pendingEntryText: string, trigger: CheckpointTrigger): GateOutcome => {
        if (commandBusy || (outstanding?.finishing ?? false) || deferredFinishing) {
            return { kind: 'busy' };
        }

        const found = validateRecipeForm(values, pendingEntryText);
        const outcome = gateOutcomeOf(found);

        setErrors(found);
        setFinishEntryText(pendingEntryText);
        setRebindFailed(false);

        if (outcome.kind === 'refused') {
            setPublishAttempted(true);

            return outcome;
        }

        setResume(undefined);
        runCheckpoint(trigger);

        return outcome;
    };

    // ── The rebind command (ADR-0045) ────────────────────────────────────────────────────────────────────────────────
    const adoptCommandAnswer = useEffectEvent((command: QueuedLineCommand, answer: LineCommandAnswer): void => {
        if (!command.claim()) {
            return;
        }

        const rest = queuedCommands.filter((queued) => queued !== command);

        setQueuedCommands((queue) => queue.filter((queued) => queued !== command));

        /**
         * A held rebind that did not land stops the Save changes it was drained for: nothing more is sent. It and the held
         * rebinds queued behind it never left `pendingRebinds`, so only their commands go. @sideEffect
         */
        const stopDrain = (failed: boolean): void => {
            if (command.held === undefined) {
                return;
            }

            setQueuedCommands((queue) => queue.filter((queued) => queued.held === undefined));
            step({ type: 'deferredTaken' });

            if (failed) {
                setRebindFailed(true);
            }
        };

        /** The queue is empty: what waited for it runs, against `draft` (this answer's state has not rendered). @sideEffect */
        const afterLast = (facts: ServerFacts, draft: RecipeFormValues = values): void => {
            if (rest.length === 0) {
                runDeferred(facts, draft);
            }
        };

        if (answer.kind === 'overtaken') {
            command.settle({ kind: 'conflict' });
            stopDrain(false);

            return;
        }

        if (answer.kind === 'refused') {
            const info = conflictOf(answer.server, answer.base, values, {
                parkedSeq: undefined,
                trigger: command.held === undefined ? 'sectionChange' : 'saveChanges',
            });

            if (info === null) {
                // The draft already agrees with the server: adopt its version so the next pick is not refused again.
                // ⛔ Never the phantom resend: that would turn a Change food into a save, which teaches nothing.
                setBaseVersion(answer.server.versionNumber);
                command.settle({ kind: 'failed' });
                stopDrain(true);

                return;
            }

            setConflict(info);
            command.settle({ kind: 'conflict' });
            stopDrain(false);

            return;
        }

        if (answer.kind === 'notStored') {
            // Nothing to re-point on the server; a held one's line goes in the update as drafted.
            command.settle({ kind: 'failed' });
            afterLast(factsNow);

            return;
        }

        if (answer.kind !== 'recipe') {
            command.settle({ kind: 'failed' });
            stopDrain(true);

            if (command.held === undefined) {
                afterLast(factsNow);
            }

            return;
        }

        const { detail, address } = answer;
        const line = toRecipeFormValues(detail).ingredients[address.position];
        // A rebind makes at most one version; an answer further on means another writer's save landed in between, and
        // adopting it would let the next write overwrite theirs. The next write meets the 409 instead.
        const adoptable =
            detail.currentVersion === address.expectedVersion || detail.currentVersion === address.expectedVersion + 1;

        if (!adoptable || line === undefined || !isStoredLine(line)) {
            command.settle({ kind: 'failed' });
            stopDrain(true);

            if (command.held === undefined) {
                afterLast(factsNow);
            }

            return;
        }

        const binding = lineBindingOf(line);
        const rebind: DraftAction = { kind: 'rebindIngredient', key: command.key, binding };
        const nextServerValues = serverValues === undefined ? undefined : applyDraftAction(serverValues, rebind);

        setBaseVersion(detail.currentVersion);
        setServer(detail);
        setServerValues(nextServerValues);
        setValuesState((current) => applyDraftAction(current, rebind));

        if (command.held !== undefined) {
            const { held } = command;

            // Answered: it leaves the device draft now, and not before. A newer re-pick of the same line stays.
            setPendingRebinds((current) => current.filter((pending) => pending !== held));
        }

        command.settle({ kind: 'committed', binding });
        afterLast(
            { ...factsNow, baseVersion: detail.currentVersion, serverValues: nextServerValues, recipe: detail },
            applyDraftAction(values, rebind),
        );
    });

    // Where the first command goes, read when it is SENT: the write it waited for may have moved the version.
    const commandAddressOf = useEffectEvent((command: QueuedLineCommand): LineCommandAddress | undefined => {
        const position = storedPositionOf(persistedKeys, command.key);

        if (position === undefined || serverId === undefined || baseVersion === null) {
            return undefined;
        }

        return { recipeId: serverId, position, expectedVersion: baseVersion };
    });

    const firstCommand = queuedCommands[0];
    const commandSettleable = firstCommand !== undefined && outstanding === undefined;
    const overtaken = conflict !== null;

    useEffect(() => {
        if (!commandSettleable) {
            return;
        }

        const address = overtaken ? undefined : commandAddressOf(firstCommand);
        const answered: Promise<LineCommandAnswer> = overtaken
            ? Promise.resolve({ kind: 'overtaken' })
            : address === undefined
              ? Promise.resolve({ kind: 'notStored' })
              : firstCommand.send(address).then(
                    (detail): LineCommandAnswer => ({ kind: 'recipe', detail, address }),
                    (error: unknown): LineCommandAnswer =>
                        isVersionConflictError(error) && error.server !== undefined
                            ? { kind: 'refused', server: error.server, base: error.base }
                            : { kind: 'failed' },
                );

        void answered.then((answer) => adoptCommandAnswer(firstCommand, answer));
    }, [commandSettleable, overtaken, firstCommand]);

    const lineCommand: LineCommandPort = {
        persistedKeys,
        holdsRebinds: lifecycle === 'published',
        hold: (rebind, binding) => {
            setTouched(true);
            setPendingRebinds((current) => coalesceRebinds([...current, rebind]));
            setValuesState((current) =>
                applyDraftAction(current, { kind: 'rebindIngredient', key: rebind.lineKey, binding }),
            );
        },
        run: (key, send) => {
            // The conflict view replaces the form, so nothing picks while it is open.
            if (conflict !== null) {
                return Promise.resolve({ kind: 'conflict' });
            }

            return new Promise((settleCommand) => {
                const command = onceLineCommand(key, send, settleCommand);

                setQueuedCommands((queue) => [...queue, command]);
            });
        },
    };

    // ── Conflict resolutions ─────────────────────────────────────────────────────────────────────────────────────────
    /** Withdraw the conflict's parked write (if it came from one), then run `then`. @sideEffect */
    const leaveConflict = (info: ConflictInfo, then: () => void): void => {
        setResolving(true);

        const withdrawn = info.parkedSeq === undefined ? Promise.resolve() : port.withdraw(info.parkedSeq);

        void withdrawn.then(
            () => {
                if (info.parkedSeq !== undefined) {
                    step({ type: 'withdrawn', seq: info.parkedSeq });
                }

                setResolving(false);
                setConflict(null);
                then();
            },
            () => setResolving(false),
        );
    };

    const resend = (info: ConflictInfo, draft: RecipeFormValues): void => {
        const version = info.server.versionNumber;

        leaveConflict(info, () => {
            setBaseVersion(version);
            setValuesState(draft);
            runCheckpoint(info.trigger, { draft, facts: { ...factsNow, baseVersion: version }, fresh: true });
        });
    };

    const handOffToRecipe = (): void => {
        const id = serverId ?? recipeRef;

        if (recipeRef !== undefined) {
            void drafts.discard(recipeRef);
        }

        step({ type: 'closed' });

        if (id !== undefined && !isLocalRef(id)) {
            onExit({ kind: 'leftForRecipe', recipeId: id });
        } else {
            onExit({ kind: 'discarded' });
        }
    };

    const resolutions: UseRecipeEditorResult['resolutions'] = {
        overwrite: () => {
            if (conflict !== null && !resolving) {
                resend(conflict, conflict.draft);
            }
        },
        keepServer: () => {
            if (conflict !== null && !resolving) {
                leaveConflict(conflict, handOffToRecipe);
            }
        },
        merge: (selections) => {
            if (conflict !== null && !resolving) {
                resend(conflict, composeConflictMerge(conflict.draft, toRecipeFormValues(conflict.theirs), selections));
            }
        },
        setMergeSelections: (selections) => {
            setConflict((current) => (current === null ? current : { ...current, mergeSelections: selections }));
        },
    };

    // The escape hatch stays available while a resolution is on its way: a hung withdrawal must not trap the cook.
    const discardAndClose = (): void => {
        if (conflict === null) {
            return;
        }

        const info = conflict;
        setConflict(null);

        if (info.parkedSeq !== undefined) {
            void port.withdraw(info.parkedSeq).then(() => step({ type: 'withdrawn', seq: info.parkedSeq as number }));
        }

        handOffToRecipe();
    };

    // ── Retry and discard ────────────────────────────────────────────────────────────────────────────────────────────
    const retry = (): void => {
        if (rebindFailed) {
            finish(finishEntryText, 'saveChanges');

            return;
        }

        const parked = outstanding;

        if (parked === undefined || !parked.parked) {
            return;
        }

        const trigger = parked.finishing ? finishingTrigger(lifecycle) : 'sectionChange';

        void port.withdraw(parked.seq).then(() => {
            step({ type: 'withdrawn', seq: parked.seq });
            runCheckpoint(trigger, { fresh: true });
        });
    };

    const discard = (): void => {
        const ref = recipeRef;

        step({ type: 'closed' });

        if (lifecycle === 'published' && serverId !== undefined) {
            void drafts.discard(serverId);
            onExit({ kind: 'leftForRecipe', recipeId: serverId });

            return;
        }

        if (ref !== undefined) {
            void drafts.discard(ref);
        }

        const parkedSeq = outstanding?.parked === true ? outstanding.seq : undefined;
        // The cook confirmed the discard, which is the consent a parked record needs before it may go.
        const cleared = parkedSeq === undefined ? Promise.resolve() : port.withdraw(parkedSeq);

        // A recipe that reached (or is on its way to) the server is deleted through the outbox; the delete supersedes a
        // create still queued, so a never-sent recipe leaves no trace.
        if (ref !== undefined && (serverId !== undefined || outstanding !== undefined)) {
            const id = serverId ?? ref;

            // ⛔ While the create is on its way the delete names its local ref as a dependency, so it drains after the
            // create and is sent with the id the create returns. A server id is never a dependency (`appendIntent`).
            void cleared.then(() =>
                port.submit({
                    entity: 'recipe',
                    intentKind: 'delete',
                    localId: id,
                    dependsOn: isLocalRef(id) ? [id] : [],
                    payload: { id },
                }),
            );
        }

        onExit({ kind: 'discarded' });
    };

    // ── What the containers read ─────────────────────────────────────────────────────────────────────────────────────
    const parkedFailure =
        outstanding?.parked === true ? port.failures.find((failure) => failure.seq === outstanding.seq) : undefined;
    const parked: UseRecipeEditorResult['parked'] =
        outstanding?.parked === true
            ? {
                  failure: parkedFailure === undefined ? 'unknown' : classifyFailure(parkedFailure),
                  kind: outstanding.kind,
              }
            : rebindFailed
              ? { failure: 'transient', kind: 'update' }
              : undefined;
    const outboxSlot: OutboxSlot =
        parked !== undefined
            ? { kind: 'parked', failure: parked.failure }
            : outstanding === undefined
              ? { kind: 'none' }
              : { kind: 'pending' };
    const saveStatus = saveStatusOf({
        lifecycle,
        durableDevice: opts.keep,
        memento: mementoWrite,
        outbox: outboxSlot,
        serverCurrent: serverValues !== undefined && !changedFromServer && outstanding === undefined,
    });

    const state: EditorState = done
        ? { status: 'done' }
        : conflict !== null
          ? (({ parkedSeq: _seq, trigger: _trigger, ...view }) => ({ ...view, isResolving: resolving }))(conflict)
          : (outstanding?.finishing === true && !outstanding.parked) ||
              (deferredFinishing && outstanding?.parked !== true)
            ? { status: 'finishing' }
            : { status: 'editing' };

    return {
        state,
        values,
        errors,
        publishAttempted,
        lifecycle,
        recipeId: serverId,
        saveStatus,
        parked,
        hasUnsavedChanges: changedFromServer,
        resume,
        pasteAvailable: pasteOffered(lifecycle),
        pasteKeepsSource: pastedLineKeepsSource({ lifecycle, createSubmitted: outstanding?.kind === 'create' }),
        setValues,
        setField,
        dispatch,
        checkpoint: (trigger) => runCheckpoint(trigger),
        publish: (pendingEntryText) => finish(pendingEntryText, 'publish'),
        saveChanges: (pendingEntryText) => finish(pendingEntryText, 'saveChanges'),
        retry,
        discard,
        lineCommand,
        discardAndClose,
        resolutions,
    };
}
