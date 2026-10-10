/**
 * @module @commise/features-recipes/editor — the editor's state core: the draft, what the server is known to hold, the
 * rebind commands waiting for the lane, and an open conflict, as ONE value moved by pure transitions.
 *
 * ⛔ THE SERVER FACTS CHANGE TOGETHER OR NOT AT ALL. The recipe the server answered with, the form values it holds, the
 * version the next write names, the ref the device draft is kept under and the re-picks held for Save changes used to
 * be seven separate React state slots, set one by one, so a render could see a server id with no server values, held
 * re-picks on a recipe the server has never stored, or a version from one answer beside the values of another.
 * {@link ServerFacts} is a discriminated union instead: a recipe the server has never stored has a ref and nothing
 * else, and a stored one has every fact at once. Which lines the server stores (`persistedLineKeysOf`) is DERIVED from
 * the values it holds, never kept beside them.
 *
 * ⛔ HELD OUTSIDE REACT, BESIDE THE LANE (`writeLane.ts`), FOR THE LANE'S REASON. The outbox and the rebind command
 * answer on their own schedule, and a handler that runs the next write must read what the previous answer just taught,
 * not what the last render saw. A store read with `get()` is current the moment `dispatch` returns, so no caller has to
 * thread "the facts I know better than this render" through, and none can forget to.
 *
 * Pure and platform-agnostic: no React, no platform APIs. The one impure piece, {@link createEditorCoreStore}, only
 * holds the value and notifies.
 *
 * @pattern State machine — a pure reducer over a discriminated-union state (`ServerFacts`: unsaved | stored)
 * @pattern Observer — {@link createEditorCoreStore}, read through `useSyncExternalStore`
 */
import type { RecipeDetail, RecipeSnapshot, VersionConflictSide } from '@kitchensink/recipe-core';

import type { DraftAction } from '../form/draftAction.js';
import type { LineBinding } from '../form/lineBinding.js';
import { persistedLineKeysOf, seedLineKey, storedPositionOf, type IngredientLineKey } from '../form/lineKey.js';
import { applyDraftAction } from '../form/props.js';
import { defaultRecipeFormValues, recipeFormValuesEqual, type RecipeFormValues } from '../form/values.js';
import { toRecipeFormValues } from '../form/wire.js';
import type { LineCommandAddress, PendingRebind, QueuedLineCommand } from '../hooks/lineCommit.js';
import type { ConflictDiff } from '../versions/conflictDiff.js';
import type { RecipeMergeSelections } from '../versions/merge.js';
import type { CheckpointTrigger } from './checkpointPolicy.js';
import { lifecycleOf } from './checkpointPolicy.js';
import type { DraftMemento } from './draftStore.js';

/** What the editor knows of the server: what a write is built against. */
export type ServerFacts =
    /** The server holds no record of this recipe yet. */
    | {
          readonly kind: 'unsaved';
          /** The local ref the device draft is kept under, minted at the first input (A4); absent before it. */
          readonly ref: string | undefined;
          /** The version a device draft remembered, if any. A create names none. */
          readonly baseVersion: number | null;
      }
    /** The server holds the recipe. */
    | {
          readonly kind: 'stored';
          /** The ref the device draft is kept under: the server id once the editor has adopted an answer. */
          readonly ref: string;
          /** The recipe the server last answered with. */
          readonly recipe: RecipeDetail;
          /** What the server holds, as form values: a checkpoint with nothing new is not sent. */
          readonly values: RecipeFormValues;
          /** The version the next update names (`expectedVersion`, ADR-0057: the editor owns the CAS token). */
          readonly baseVersion: number;
          /** A published recipe's re-picks, held until Save changes (blueprint A3), oldest first, one per line. */
          readonly held: readonly PendingRebind[];
          /** A held re-pick failed while Save changes drained it: the save stopped, and Retry runs it again. */
          readonly drainFailed: boolean;
      };

/** The conflict's data, as the conflict view shows it. */
export interface ConflictView {
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
}

/** The conflict as the editor keeps it: the parked write it came from, if any, and the trigger to resend with. */
export interface ConflictInfo extends ConflictView {
    readonly parkedSeq: number | undefined;
    /** The trigger of the write that met the 409, so a resolution's resend keeps its intent (a Publish still publishes). */
    readonly trigger: CheckpointTrigger;
}

/** An open conflict, and whether a resolution's write is on its way. */
export interface OpenConflict {
    readonly info: ConflictInfo;
    readonly resolving: boolean;
}

/** The editor's state core. */
export interface EditorCoreState {
    /** The cook's draft. */
    readonly draft: RecipeFormValues;
    /** Whether the cook has changed the draft since the editor opened: the idle timers arm only then. */
    readonly touched: boolean;
    readonly server: ServerFacts;
    /** The rebind commands waiting for the lane, first to send first (ADR-0045). */
    readonly commands: readonly QueuedLineCommand[];
    readonly conflict: OpenConflict | undefined;
}

/** What happened to the editor. */
export type EditorCoreEvent =
    /** The cook replaced the draft (or one field of it). */
    | { readonly type: 'draftReplaced'; readonly draft: RecipeFormValues }
    /** A draft transition, applied to the draft as it is now. */
    | { readonly type: 'draftActed'; readonly action: DraftAction }
    /** A conflict resolution put a draft back: it is the cook's draft again, but no new edit. */
    | { readonly type: 'draftRestored'; readonly draft: RecipeFormValues }
    /** A ref was minted for a recipe the server has never stored (A4). */
    | { readonly type: 'refMinted'; readonly ref: string }
    /** A recipe write answered: the server holds `sent`, at the answer's version. */
    | { readonly type: 'written'; readonly detail: RecipeDetail; readonly sent: RecipeFormValues }
    /** The server is at `version` and already holds the draft's content (a phantom 409, an agreeing refusal, a resend). */
    | { readonly type: 'versionAdopted'; readonly version: number }
    /** A rebind command answered with `detail`, which re-points the line `key` to `binding`. */
    | {
          readonly type: 'rebound';
          readonly detail: RecipeDetail;
          readonly key: IngredientLineKey;
          readonly binding: LineBinding;
          /** The held re-pick this command drained, if it was one. */
          readonly held: PendingRebind | undefined;
      }
    /** A published recipe's re-pick, held until Save changes, shown on its line at once. */
    | { readonly type: 'rebindHeld'; readonly rebind: PendingRebind; readonly binding: LineBinding }
    /** Held re-picks a Save changes will not send (their line is gone, or the server already holds their food). */
    | { readonly type: 'heldDropped'; readonly dropped: readonly PendingRebind[] }
    /** A held re-pick did not land: the Save changes stopped. */
    | { readonly type: 'drainFailed' }
    /** A Publish or Save changes starts again. */
    | { readonly type: 'drainReset' }
    | { readonly type: 'commandsQueued'; readonly commands: readonly QueuedLineCommand[] }
    | { readonly type: 'commandDone'; readonly command: QueuedLineCommand }
    /** The drain stopped: every queued drain command goes; a command run at once stays. */
    | { readonly type: 'drainCommandsCleared' }
    | { readonly type: 'conflictOpened'; readonly info: ConflictInfo }
    | { readonly type: 'conflictResolving'; readonly resolving: boolean }
    | { readonly type: 'conflictClosed' }
    | { readonly type: 'mergeSelected'; readonly selections: RecipeMergeSelections };

/** What the editor opens with (the hook's `EditorSeed`, structurally). */
export interface EditorCoreSeed {
    readonly recipe?: RecipeDetail;
    readonly memento?: DraftMemento;
}

/** The seeded core, and what the seed says beyond it. */
export interface SeededEditor {
    readonly core: EditorCoreState;
    /** When the device changes of a published recipe were written, if the editor opens on them (the resume notice). */
    readonly resumeSavedAt: string | undefined;
}

/**
 * What the server holds, as form values, keyed the way the draft is.
 *
 * A line's key names the version it was read at (`seedLineKey`). A device draft edited from version 3 keys its lines
 * `v3.*`, while a fresh read of version 4 keys them `v4.*`, so a draft built on an older version than the read would
 * find none of its lines in what the server holds: every held re-pick would look unsent, and every stored line
 * unstored. Keyed at the draft's version, the read answers for the same lines — exactly right when the newer version
 * changed no line's position, which a rebind never does (and a write built on the older version meets a 409 anyway).
 * Pure.
 */
function serverValuesFor(recipe: RecipeDetail, memento: DraftMemento | undefined): RecipeFormValues {
    const stored = toRecipeFormValues(recipe);
    const base = memento?.baseVersion;

    if (base === undefined || base === null || base === recipe.currentVersion) {
        return stored;
    }

    return {
        ...stored,
        ingredients: stored.ingredients.map((line, index) => ({ ...line, key: seedLineKey(base, index) })),
    };
}

/**
 * The editor as it opens: the device draft if one was kept, else the server's recipe, else a blank draft.
 *
 * ⛔ The device draft's version, not the server's: a draft edited from version 4 must name 4, so a write after another
 * device's save meets the 409 that shows the cook what changed.
 *
 * @param seed - The settled recipe and the device draft, if any.
 * @returns The core, and the resume notice's time. Pure.
 */
export function seedEditorCore(seed: EditorCoreSeed): SeededEditor {
    const { recipe, memento } = seed;
    const remembered = memento === undefined ? undefined : { ...memento.values, photos: [] };
    const serverValues = recipe === undefined ? undefined : serverValuesFor(recipe, memento);
    const draft = remembered ?? serverValues ?? defaultRecipeFormValues();
    const deviceChanges =
        remembered !== undefined && serverValues !== undefined && !recipeFormValuesEqual(draft, serverValues);
    const server: ServerFacts =
        recipe === undefined || serverValues === undefined
            ? { kind: 'unsaved', ref: memento?.recipeRef, baseVersion: memento?.baseVersion ?? null }
            : {
                  kind: 'stored',
                  ref: memento?.recipeRef ?? recipe.id,
                  recipe,
                  values: serverValues,
                  baseVersion: memento?.baseVersion ?? recipe.currentVersion,
                  held: memento?.pendingRebinds ?? [],
                  drainFailed: false,
              };

    return {
        core: { draft, touched: false, server, commands: [], conflict: undefined },
        resumeSavedAt:
            deviceChanges && lifecycleOf(recipe) === 'published' && memento !== undefined ? memento.savedAt : undefined,
    };
}

/** The held re-picks with one per line, the later of two for the same line winning, in the order first held. Pure. */
function coalesceRebinds(rebinds: readonly PendingRebind[]): readonly PendingRebind[] {
    const latest = new Map(rebinds.map((rebind) => [rebind.lineKey, rebind]));

    return [...latest.values()];
}

/**
 * Whether a re-pick of `key` newer than `answered` is held: the cook picked the line again while the older one drained,
 * so the line shows the newer food. Pure.
 */
function newerHoldOf(server: ServerFacts, key: IngredientLineKey, answered: PendingRebind | undefined): boolean {
    return server.kind === 'stored' && server.held.some((held) => held.lineKey === key && held !== answered);
}

/** A rebind command's answer: the server moves to `detail`, the line to its binding, the held re-pick is answered. */
function rebound(state: EditorCoreState, event: Extract<EditorCoreEvent, { type: 'rebound' }>): EditorCoreState {
    const { server } = state;

    if (server.kind !== 'stored') {
        return state;
    }

    const rebind: DraftAction = { kind: 'rebindIngredient', key: event.key, binding: event.binding };
    // ⛔ A newer re-pick of the same line, held while this one drained, stays on the line (code-reviewer Medium 5): the
    // answer re-points what the SERVER holds, and the newer pick is sent after it, before the update.
    const draft = newerHoldOf(server, event.key, event.held) ? state.draft : applyDraftAction(state.draft, rebind);
    const { held } = event;

    return {
        ...state,
        draft,
        server: {
            ...server,
            recipe: event.detail,
            values: applyDraftAction(server.values, rebind),
            baseVersion: event.detail.currentVersion,
            // Answered: it leaves the device draft now, and not before.
            held: held === undefined ? server.held : server.held.filter((pending) => pending !== held),
        },
    };
}

/** A recipe write's answer: every server fact from it at once. */
function written(state: EditorCoreState, detail: RecipeDetail, sent: RecipeFormValues): EditorCoreState {
    const { server } = state;

    return {
        ...state,
        server: {
            kind: 'stored',
            ref: detail.id,
            recipe: detail,
            values: sent,
            baseVersion: detail.currentVersion,
            held: server.kind === 'stored' ? server.held : [],
            drainFailed: server.kind === 'stored' && server.drainFailed,
        },
    };
}

/** The stored facts with `change` applied; an unsaved recipe has none to change. */
function withStored(
    state: EditorCoreState,
    change: (server: Extract<ServerFacts, { kind: 'stored' }>) => Extract<ServerFacts, { kind: 'stored' }>,
): EditorCoreState {
    return state.server.kind === 'stored' ? { ...state, server: change(state.server) } : state;
}

/** The transitions that move the server facts. */
function serverTransition(state: EditorCoreState, event: EditorCoreEvent): EditorCoreState {
    switch (event.type) {
        case 'refMinted':
            return state.server.kind === 'unsaved' && state.server.ref === undefined
                ? { ...state, server: { ...state.server, ref: event.ref } }
                : state;
        case 'written':
            return written(state, event.detail, event.sent);
        case 'versionAdopted':
            return { ...state, server: { ...state.server, baseVersion: event.version } };
        case 'rebound':
            return rebound(state, event);
        case 'rebindHeld':
            // A hold needs a stored line to re-point; an unsaved recipe has none, so the pick is a draft change there.
            return state.server.kind === 'stored'
                ? {
                      ...state,
                      touched: true,
                      draft: applyDraftAction(state.draft, {
                          kind: 'rebindIngredient',
                          key: event.rebind.lineKey,
                          binding: event.binding,
                      }),
                      server: { ...state.server, held: coalesceRebinds([...state.server.held, event.rebind]) },
                  }
                : state;
        case 'heldDropped':
            return withStored(state, (server) => ({
                ...server,
                held: server.held.filter((rebind) => !event.dropped.includes(rebind)),
            }));
        case 'drainFailed':
            return withStored(state, (server) => ({ ...server, drainFailed: true }));
        case 'drainReset':
            return withStored(state, (server) => (server.drainFailed ? { ...server, drainFailed: false } : server));
        default:
            return state;
    }
}

/** The transitions that move the command queue and the conflict. */
function laneSideTransition(state: EditorCoreState, event: EditorCoreEvent): EditorCoreState {
    switch (event.type) {
        case 'commandsQueued':
            return event.commands.length === 0 ? state : { ...state, commands: [...state.commands, ...event.commands] };
        case 'commandDone':
            return { ...state, commands: state.commands.filter((queued) => queued !== event.command) };
        case 'drainCommandsCleared':
            return { ...state, commands: state.commands.filter((queued) => queued.held === undefined) };
        case 'conflictOpened':
            return { ...state, conflict: { info: event.info, resolving: false } };
        case 'conflictResolving':
            return state.conflict === undefined
                ? state
                : { ...state, conflict: { ...state.conflict, resolving: event.resolving } };
        case 'conflictClosed':
            return state.conflict === undefined ? state : { ...state, conflict: undefined };
        case 'mergeSelected':
            return state.conflict === undefined
                ? state
                : {
                      ...state,
                      conflict: {
                          ...state.conflict,
                          info: { ...state.conflict.info, mergeSelections: event.selections },
                      },
                  };
        default:
            return serverTransition(state, event);
    }
}

/**
 * The editor after an event.
 *
 * @param state - The editor.
 * @param event - What happened.
 * @returns The new editor; the same object when the event changes nothing it can. Pure.
 */
export function editorCoreReducer(state: EditorCoreState, event: EditorCoreEvent): EditorCoreState {
    switch (event.type) {
        case 'draftReplaced':
            return { ...state, draft: event.draft, touched: true };
        case 'draftActed':
            return { ...state, draft: applyDraftAction(state.draft, event.action), touched: true };
        case 'draftRestored':
            return { ...state, draft: event.draft };
        default:
            return laneSideTransition(state, event);
    }
}

// ── Selectors ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The recipe's server id, once it has one. Pure. */
export function serverIdOf(server: ServerFacts): string | undefined {
    return server.kind === 'stored' ? server.recipe.id : undefined;
}

/** What the server holds, as form values; `undefined` before the server create. Pure. */
export function serverValuesOf(server: ServerFacts): RecipeFormValues | undefined {
    return server.kind === 'stored' ? server.values : undefined;
}

/** The stored lines' keys, in stored order: none before the server create. Pure. */
export function persistedKeysOf(server: ServerFacts): readonly IngredientLineKey[] {
    return server.kind === 'stored' ? persistedLineKeysOf(server.values.ingredients) : [];
}

/**
 * Where a rebind command for the line `key` goes, read when it is SENT: the write it waited for may have moved the
 * version. `undefined` when the server stores no such line. Pure.
 *
 * @param server - What the server holds.
 * @param key - The line.
 * @returns The address, or `undefined`.
 */
export function commandAddressOf(server: ServerFacts, key: IngredientLineKey): LineCommandAddress | undefined {
    if (server.kind !== 'stored') {
        return undefined;
    }

    const position = storedPositionOf(persistedKeysOf(server), key);

    return position === undefined
        ? undefined
        : { recipeId: server.recipe.id, position, expectedVersion: server.baseVersion };
}

/** The re-picks held for Save changes. Pure. */
export function heldOf(server: ServerFacts): readonly PendingRebind[] {
    return server.kind === 'stored' ? server.held : [];
}

/**
 * The held re-picks a Save changes still sends. Dropped:
 *
 * - one whose line the cook removed — it would teach a correction for a line the update deletes;
 * - one whose line the server does not store — there is nothing to re-point, and the line goes in the update as drafted
 *   (another device removed it, so the update meets the 409 that shows the cook). ⛔ Kept, it would be queued, refused
 *   as unstored and queued again forever;
 * - one back to the food the server already holds — which is also how one that just answered, or one that landed in an
 *   earlier session and was never recorded, is recognised.
 *
 * Pure.
 *
 * @param server - What the server holds.
 * @param draft - The cook's draft.
 * @returns The re-picks to send, in the order held.
 */
export function liveHeldRebinds(server: ServerFacts, draft: RecipeFormValues): readonly PendingRebind[] {
    if (server.kind !== 'stored') {
        return [];
    }

    const persisted = persistedKeysOf(server);

    return server.held.filter((rebind) => {
        const drafted = draft.ingredients.find((line) => line.key === rebind.lineKey);
        const stored = persisted.includes(rebind.lineKey)
            ? server.values.ingredients.find((line) => line.key === rebind.lineKey)
            : undefined;

        return drafted !== undefined && stored !== undefined && drafted.ingredientId !== stored.ingredientId;
    });
}

/** The editor core, held outside React state (see the module doc). */
export interface EditorCoreStore {
    readonly get: () => EditorCoreState;
    readonly dispatch: (event: EditorCoreEvent) => void;
    readonly subscribe: (listener: () => void) => () => void;
}

/**
 * A store over {@link editorCoreReducer}.
 *
 * @param initial - The seeded core.
 * @returns The store. @sideEffect Its `dispatch` notifies subscribers when the state changes.
 */
export function createEditorCoreStore(initial: EditorCoreState): EditorCoreStore {
    let state = initial;
    const listeners = new Set<() => void>();

    return {
        get: () => state,
        dispatch: (event) => {
            const next = editorCoreReducer(state, event);

            if (next === state) {
                return;
            }

            state = next;

            for (const listener of [...listeners]) {
                listener();
            }
        },
        subscribe: (listener) => {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
    };
}
