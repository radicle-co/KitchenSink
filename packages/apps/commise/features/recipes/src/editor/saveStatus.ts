/**
 * @module @commise/features-recipes/editor — the one save status the editor shows.
 *
 * Three things can hold a cook's latest change: the device draft (`draftStore.ts`), the outbox queue, and the server.
 * The status is derived from all three, in an order where the first true thing wins:
 *
 * 1. a server write that PARKED — the cook has to act; the draft is still kept on the device;
 * 2. the server holds the current draft — saved;
 * 3. a server write is queued — syncing;
 * 4. otherwise what the device draft says: failed, writing, written (and what it waits for), or nothing yet.
 *
 * ⛔ THE STATUS CARRIES WHERE THE DRAFT IS KEPT, NOT WHAT TO SAY ABOUT IT. On mobile the draft is on disk; on web it
 * is in `sessionStorage` and ends with the tab (owner ruling D7). "Saved on this device" is true on one and false on
 * the other, so the copy is per platform, and it is the UX engineer's to write.
 *
 * {@link closingTabLosesWork} reads the same status for the web's unload prompt.
 *
 * @pattern Policy — a pure projection of three sources into one discriminated union
 */
import type { FailureClass } from '@kitchensink/sync';

import { defaultRecipeFormValues, recipeFormValuesEqual, type RecipeFormValues } from '../form/values.js';
import type { RecipeLifecycle } from './checkpointPolicy.js';

/** Where the device draft is kept: on disk (mobile), or for this browser tab only (web). */
export type DraftKeep = 'disk' | 'tabSession';

/** The device draft's last write of the current change. */
export type MementoWrite = 'none' | 'writing' | 'written' | 'failed';

/** This recipe's server write in the outbox. */
export type OutboxSlot =
    | { readonly kind: 'none' }
    | { readonly kind: 'pending' }
    | { readonly kind: 'parked'; readonly failure: FailureClass };

/** The facts the status is derived from. */
export interface SaveStatusInput {
    readonly lifecycle: RecipeLifecycle;
    readonly durableDevice: DraftKeep;
    readonly memento: MementoWrite;
    readonly outbox: OutboxSlot;
    /** Whether the server has acknowledged the draft as it is now. */
    readonly serverCurrent: boolean;
}

/** What the editor shows. */
export type SaveStatus =
    | { readonly kind: 'saved' }
    | { readonly kind: 'syncing' }
    | { readonly kind: 'syncFailed'; readonly failure: FailureClass }
    | { readonly kind: 'keptOnDevice'; readonly store: DraftKeep; readonly awaiting: 'checkpoint' | 'saveChanges' }
    | { readonly kind: 'savingOnDevice' }
    | { readonly kind: 'deviceFailed' }
    | { readonly kind: 'unsaved' };

/**
 * The save status.
 *
 * @param input - The device draft, the outbox and the server.
 * @returns The one status to show. Pure.
 */
export function saveStatusOf(input: SaveStatusInput): SaveStatus {
    const { outbox, memento } = input;

    if (outbox.kind === 'parked') {
        return { kind: 'syncFailed', failure: outbox.failure };
    }

    if (input.serverCurrent) {
        return { kind: 'saved' };
    }

    if (outbox.kind === 'pending') {
        return { kind: 'syncing' };
    }

    switch (memento) {
        case 'failed':
            return { kind: 'deviceFailed' };

        case 'writing':
            return { kind: 'savingOnDevice' };

        case 'written':
            return {
                kind: 'keptOnDevice',
                store: input.durableDevice,
                // ⛔ A published recipe's change waits for the cook's Save changes (owner ruling D1), not for a timer.
                awaiting: input.lifecycle === 'published' ? 'saveChanges' : 'checkpoint',
            };

        case 'none':
            return { kind: 'unsaved' };

        default: {
            const unreachable: never = memento;

            return unreachable;
        }
    }
}

/** What decides whether closing the tab loses the cook's work. */
export interface TabCloseInput {
    readonly keep: DraftKeep;
    readonly status: SaveStatus;
    readonly lifecycle: RecipeLifecycle;
    readonly values: RecipeFormValues;
}

/**
 * Whether closing the browser tab now would lose work: the web's unload prompt arms on it (D7).
 *
 * The web keeps the draft and the outbox journal in the tab's session storage, so everything the server does not hold
 * yet ends with the tab — whatever the recipe's lifecycle. Only `saved` loses nothing, and a new recipe nobody has typed
 * in; an `unsaved` status with typed values is the second before the device copy is written, and loses that typing.
 *
 * @param input - Where the draft is kept, the status, the lifecycle and the draft.
 * @returns Whether to ask before the tab closes. Pure.
 */
export function closingTabLosesWork(input: TabCloseInput): boolean {
    const { keep, status, lifecycle, values } = input;

    if (keep !== 'tabSession' || status.kind === 'saved') {
        return false;
    }

    return !(lifecycle === 'unsaved' && recipeFormValuesEqual(values, defaultRecipeFormValues()));
}
