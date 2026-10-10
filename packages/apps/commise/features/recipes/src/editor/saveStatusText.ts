/**
 * @module @commise/features-recipes/editor — the header's save status in words, and whether it is announced.
 *
 * `saveStatus.ts` says WHERE the draft is; this says it in the cook's words, which depend on that place: "on this
 * device" for a draft on disk (mobile), "in this tab" for one in the tab's session storage (web, owner D7). Copy and the
 * web choices are `staff-ux-engineer`'s (slice 7): on web, a never-published draft's device copy lasts only the second
 * before its checkpoint, so it reads "Saving…" rather than warning about a window that closes by itself.
 *
 * Only failures are announced, politely and once (build spec §7.3, §7.10); a conflict opens its own view instead.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Policy — a pure projection of the status union into copy, exhaustively switched
 */
import type { EditorMessages } from './messages.js';
import type { DraftKeep, SaveStatus } from './saveStatus.js';

/** The status line and whether it is announced. */
export interface SaveStatusLine {
    /** The words, or `undefined` when the header shows nothing (a new recipe with nothing typed). */
    readonly text: string | undefined;
    readonly announced: boolean;
}

/**
 * The header's save status.
 *
 * @param status - The derived status.
 * @param keep - Where this platform keeps the draft.
 * @param m - The editor's copy.
 * @returns The words and whether to announce them. Pure.
 */
export function saveStatusText(status: SaveStatus, keep: DraftKeep, m: EditorMessages): SaveStatusLine {
    const quiet = (text: string | undefined): SaveStatusLine => ({ text, announced: false });
    const told = (text: string): SaveStatusLine => ({ text, announced: true });
    const onDisk = keep === 'disk';

    switch (status.kind) {
        case 'unsaved':
            return quiet(undefined);

        case 'savingOnDevice':
            return quiet(m.status.saving);

        case 'saved':
            return quiet(m.status.saved);

        case 'syncing':
            return quiet(onDisk ? m.status.savedOnDevice : m.status.savedInTab);

        case 'keptOnDevice':
            if (status.awaiting === 'saveChanges') {
                return quiet(status.store === 'disk' ? m.status.changesOnDevice : m.status.changesInTab);
            }

            return quiet(status.store === 'disk' ? m.status.savedOnDevice : m.status.saving);

        case 'deviceFailed':
            return told(onDisk ? m.status.deviceFailed : m.status.tabFailed);

        case 'syncFailed':
            switch (status.failure) {
                case 'transient':
                    return told(m.status.saveFailed);

                case 'conflict':
                    return quiet(m.status.conflict);

                case 'terminal':
                    return told(m.status.notSaved);

                case 'unknown':
                    return told(m.status.unconfirmed);

                default: {
                    const unreachable: never = status.failure;

                    return unreachable;
                }
            }

        default: {
            const unreachable: never = status;

            return unreachable;
        }
    }
}
