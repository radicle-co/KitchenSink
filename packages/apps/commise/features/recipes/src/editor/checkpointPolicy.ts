/**
 * @module @commise/features-recipes/editor — when an editor change becomes a SERVER write.
 *
 * Every trigger writes the device draft (`draftStore.ts`); this module decides only whether the server is asked as
 * well, and for what. One Strategy per recipe lifecycle, chosen in one place:
 *
 * - **Unsaved** — no server record yet. The first checkpoint at which the draft floor passes CREATES it (blueprint
 *   A4). Until then the recipe exists only on the device.
 * - **Never published** — a draft on the server. Checkpoints UPDATE it in place. A save of a never-published draft
 *   makes no version (ADR-0058), which is what makes a checkpoint every few seconds affordable.
 * - **Published** — only the cook's own Save changes writes (owner ruling D1). Every save of a published recipe makes
 *   a version, so a change waits on the device until the cook says it is done.
 *
 * ⚠️ The lifecycle is read from `status`. The server keys versioning on `first_published_at` instead, because a
 * published recipe can be set back to draft through the API; no client does that (`useRecipeEditor`'s Save Draft never
 * downgrades a published recipe), so on every recipe a client can produce the two agree. ADR-0058 records this.
 *
 * @pattern Strategy keyed on the lifecycle, expressed as a Policy — one pure decision over plain inputs
 */
import type { RecipeStatus } from '@kitchensink/recipe-core';

/** How long typing must pause before the draft is written to the device, in milliseconds. */
export const DEVICE_SAVE_IDLE_MS = 1_000;

/**
 * How long typing must pause before a never-published draft is checkpointed to the server, in milliseconds.
 *
 * Judgement, not measurement (blueprint "Verified vs assumed" 7): long enough that a cook typing a step does not send
 * a request per sentence, short enough that a crash on web loses little.
 */
export const SERVER_CHECKPOINT_IDLE_MS = 10_000;

/** What happened in the editor. */
export type CheckpointTrigger =
    /** Typing paused for `DEVICE_SAVE_IDLE_MS`. */
    | 'typingIdle'
    /** A field lost focus. */
    | 'fieldBlur'
    /** The cook moved to another section. */
    | 'sectionChange'
    /** The cook left the editor. */
    | 'editorExit'
    /** The app went to the background, or the tab was hidden. */
    | 'appHidden'
    /** Typing paused for `SERVER_CHECKPOINT_IDLE_MS`. */
    | 'checkpointIdle'
    /** The cook pressed Save changes. */
    | 'saveChanges'
    /** The cook pressed Publish. */
    | 'publish';

/** Where the recipe stands on the server. */
export type RecipeLifecycle = 'unsaved' | 'neverPublished' | 'published';

/** What the server is asked to do. */
export type ServerWrite =
    | { readonly kind: 'none' }
    | { readonly kind: 'create'; readonly publish: boolean }
    | { readonly kind: 'update'; readonly publish: boolean };

/** The facts the decision needs. */
export interface CheckpointInput {
    readonly trigger: CheckpointTrigger;
    readonly lifecycle: RecipeLifecycle;
    /**
     * Whether the draft passes the floor a server write needs (a title, within the wire's bound). A write it fails
     * would be refused with a `400`, and a checkpoint that asked for one would ask again at every trigger.
     */
    readonly draftFloorMet: boolean;
    /** Whether the draft differs from what the server was last sent. */
    readonly changedSinceServerWrite: boolean;
}

/** The triggers at which a recipe that is not yet published reaches the server. */
const DRAFT_CHECKPOINTS: ReadonlySet<CheckpointTrigger> = new Set([
    'sectionChange',
    'editorExit',
    'appHidden',
    'checkpointIdle',
    'saveChanges',
    'publish',
]);

const NONE: ServerWrite = { kind: 'none' };

/**
 * The server write a trigger calls for.
 *
 * @param input - The trigger and the recipe's state.
 * @returns What to ask the server for. Pure.
 */
export function serverWriteFor(input: CheckpointInput): ServerWrite {
    const { trigger, lifecycle, draftFloorMet, changedSinceServerWrite } = input;

    if (!draftFloorMet) {
        return NONE;
    }

    switch (lifecycle) {
        case 'unsaved':
            return DRAFT_CHECKPOINTS.has(trigger) ? { kind: 'create', publish: trigger === 'publish' } : NONE;

        case 'neverPublished':
            if (trigger === 'publish') {
                return { kind: 'update', publish: true };
            }

            return DRAFT_CHECKPOINTS.has(trigger) && changedSinceServerWrite
                ? { kind: 'update', publish: false }
                : NONE;

        case 'published':
            // A Publish of a recipe that is already published is a Save changes: there is no status left to change.
            return (trigger === 'saveChanges' || trigger === 'publish') && changedSinceServerWrite
                ? { kind: 'update', publish: false }
                : NONE;

        default: {
            const unreachable: never = lifecycle;

            return unreachable;
        }
    }
}

/**
 * The lifecycle of the recipe the editor holds.
 *
 * @param recipe - The server's recipe, or `undefined` before the server create.
 * @returns Its lifecycle. Pure.
 */
export function lifecycleOf(recipe: { readonly status: RecipeStatus } | undefined): RecipeLifecycle {
    if (recipe === undefined) {
        return 'unsaved';
    }

    return recipe.status === 'published' ? 'published' : 'neverPublished';
}
