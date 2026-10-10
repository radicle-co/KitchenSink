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
 * ⛔ The lifecycle is keyed on the FIRST PUBLISH (`firstPublishedAt`), the fact the server versions by (ADR-0058 rule 1),
 * never on `status`: the API takes `PATCH { status: 'draft' }` on a published recipe, and every save of that recipe
 * still makes a version. A read without the field falls back to `status = published`, which the service's own CHECK
 * makes imply a first publish.
 *
 * The same lifecycle gates Paste a list (owner D10: offered until the first publish) and decides whether a pasted line
 * may carry its source (blueprint A5: only into the create).
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
    /**
     * Whether a pasted list is still joining the draft. It holds the CREATE: a line that joined after the create was
     * sent would keep its source in the draft and lose it in the next update, which strips it (`form/wire.ts`).
     */
    readonly pastePending: boolean;
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
    const { trigger, lifecycle, draftFloorMet, changedSinceServerWrite, pastePending } = input;

    if (!draftFloorMet) {
        return NONE;
    }

    switch (lifecycle) {
        case 'unsaved':
            // A paste still joining holds the create, except on the way out: the paste ends with the editor, and a titled
            // recipe is still created when the cook leaves.
            if (pastePending && trigger !== 'editorExit') {
                return NONE;
            }

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

/** What the lifecycle is read from: the server's recipe. */
export interface LifecycleFacts {
    readonly status: RecipeStatus;
    /** When the recipe was first published, ISO 8601; absent until then, and on a read that predates the field. */
    readonly firstPublishedAt?: string;
}

/**
 * The lifecycle of the recipe the editor holds.
 *
 * @param recipe - The server's recipe, or `undefined` before the server create.
 * @returns Its lifecycle: published once it was EVER published, whatever its status is now. Pure.
 */
export function lifecycleOf(recipe: LifecycleFacts | undefined): RecipeLifecycle {
    if (recipe === undefined) {
        return 'unsaved';
    }

    return recipe.firstPublishedAt !== undefined || recipe.status === 'published' ? 'published' : 'neverPublished';
}

/**
 * Whether Paste a list is offered: while the recipe is being created, which lasts until its first publish (owner D10,
 * 2026-10-09). Autosave stores a draft as soon as it has a title, so the gate is the first publish, not the first save.
 *
 * @param lifecycle - The recipe's lifecycle.
 * @returns Whether the editor offers paste. Pure.
 */
export function pasteOffered(lifecycle: RecipeLifecycle): boolean {
    return lifecycle !== 'published';
}

/** What decides whether a pasted line keeps its source. */
export interface PastedLineSourceInput {
    readonly lifecycle: RecipeLifecycle;
    /** Whether the create has been submitted: it carries the draft as it was then, and every later write is an update. */
    readonly createSubmitted: boolean;
}

/**
 * Whether a pasted line joining now may carry what it was read from (`sourceLine`, `sourcePhrase`). Only the create
 * carries them; a PATCH cannot (blueprint A5, ADR-0023's shape), so a line that joins once the create is SUBMITTED — not
 * once it answers — is stored as an authored line, which D10 accepts.
 *
 * @param input - The lifecycle, and whether the create is submitted.
 * @returns Whether the line keeps its source. Pure.
 */
export function pastedLineKeepsSource(input: PastedLineSourceInput): boolean {
    return input.lifecycle === 'unsaved' && !input.createSubmitted;
}
