/**
 * @module Which document a kept command applies to (ADR-0094 sections 3 and 6). Pure: the store reads storage and
 * holds its state, and this decides from them.
 * @pattern Specification — one rule over what storage, memory and a failed write hold.
 */
import { applyKeptCommand, type KeptCommand } from './keptCommands.js';
import { EMPTY_KEPT_DOCUMENT, type KeptDocument, type ParsedKept } from './keptRecord.js';

/** A command applied in memory while storage could not be read, with the instant the cook made it. */
export interface UnsavedCommand {
    readonly command: KeptCommand;
    readonly at: string;
}

/** The document a failed write left in memory, valid while storage still holds `fromRev`. */
export interface PendingWrite {
    readonly fromRev: number;
    readonly doc: KeptDocument;
}

/**
 * The document after each unsaved command that still applies to it, in the order they were made.
 *
 * @param doc - The document to start from.
 * @param commands - The commands to apply, oldest first.
 * @returns The document after them. Pure.
 */
export const replay = (doc: KeptDocument, commands: readonly UnsavedCommand[]): KeptDocument =>
    commands.reduce((acc, { command, at }) => {
        const next = applyKeptCommand(acc, command, at);

        return next.kind === 'applied' ? next.doc : acc;
    }, doc);

/**
 * Storage is the truth. The one exception is our own failed write while nobody has written since: storage still
 * holds the rev it held then (an absent or unreadable key is rev 0, and every real record is 1 or more). Otherwise an
 * absent key means empty, never memory, or a record another tab cleared would come back.
 *
 * @param input - What storage read (`undefined` when it could not be read), the held write, memory, the unsaved
 *   commands, and whether this dispatch may write.
 * @returns The document to apply to, the rev storage holds, and whether the held write is now stale. Pure.
 */
export function chooseBase({
    stored,
    pending,
    memory,
    unsaved,
    writable,
}: {
    readonly stored: ParsedKept | undefined;
    readonly pending: PendingWrite | undefined;
    readonly memory: KeptDocument;
    readonly unsaved: readonly UnsavedCommand[];
    readonly writable: boolean;
}): { readonly base: KeptDocument; readonly storedRev: number; readonly clearPending: boolean } {
    const storedDoc = stored?.kind === 'ok' ? stored.doc : EMPTY_KEPT_DOCUMENT;
    const heldApplies = pending !== undefined && storedDoc.rev === pending.fromRev;

    let stable = storedDoc;

    if (stored === undefined) {
        stable = memory;
    } else if (heldApplies) {
        stable = pending.doc;
    }

    return {
        base: writable ? replay(stable, unsaved) : stable,
        storedRev: storedDoc.rev,
        clearPending: stored !== undefined && !heldApplies,
    };
}
