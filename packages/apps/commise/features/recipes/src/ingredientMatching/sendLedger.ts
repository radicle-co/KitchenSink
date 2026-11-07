/**
 * @module @commise/features-recipes/ingredientMatching — the ONE record of what each line is sending and what failed,
 * shared by every surface that shows a line's pick (the paste list and pane, the flagged list, the options sheet) and by
 * the bulk-import hosts, so they all render from the same facts.
 *
 * ⛔ WHY IT KEEPS THE PAYLOAD. A bare "this line failed" set (`failed`) cannot say WHICH action failed, so a flagged
 * row's Try again could only be "Use the suggestion" again, even when the failed action was a pick made from the
 * options sheet. Each attempt is kept whole (`SendAttempt`: the {@link PendingSend} kind and the exact food or pick it
 * carried), and {@link retryOf} returns the failed attempt itself, so Try again REPEATS THE ACTION THAT FAILED and
 * nothing else. Replaying a command is safe here because the host's send is idempotent per line (a rebind by key).
 *
 * The existing `pending` and `failed` props are projections of the ledger ({@link pendingOf}, {@link failedOf}), so no
 * surface changes shape. A retry in flight is a line that is BOTH failed and pending, which is what tells a retry from a
 * first attempt (`retryFocus.ts`).
 *
 * Pure and platform-agnostic.
 *
 * @pattern Command — each {@link SendAttempt} is a replayable command object
 * @pattern Reducer — {@link reduceSendLedger}: a pure transition over `started`, `saved` and `failed`
 */
import type { LinePick, PendingSend } from './matchLine.js';

/** A food by the id a send carries and the name the cook saw. */
export interface SentFood {
    readonly foodId: string;
    readonly name: string;
}

/**
 * One send, whole: the {@link PendingSend} kind plus the exact payload that was sent, so it can be sent again. Each
 * member is assignable to its {@link PendingSend}, so a ledger projects into the props the surfaces already take.
 */
export type SendAttempt =
    | { readonly kind: 'pick'; readonly pick: LinePick }
    | { readonly kind: 'searchPick'; readonly food: SentFood }
    | { readonly kind: 'useProposal'; readonly food: SentFood };

/** One line's record: the attempt in flight, and the last attempt that failed and has not saved since. */
interface LedgerEntry {
    readonly pending: SendAttempt | undefined;
    readonly failed: SendAttempt | undefined;
}

/** Every line's record, by key. A line with nothing in flight and nothing failed has no entry. */
export type SendLedger = ReadonlyMap<string, LedgerEntry>;

/** What happens to a line's send. */
export type SendLedgerEvent =
    | { readonly type: 'started'; readonly key: string; readonly attempt: SendAttempt }
    | { readonly type: 'saved'; readonly key: string }
    | { readonly type: 'failed'; readonly key: string };

/** A ledger with nothing in it. */
export const emptySendLedger: SendLedger = new Map();

/** A copy of the ledger with one line's record set (or removed when it holds nothing). Pure. */
function withEntry(ledger: SendLedger, key: string, entry: LedgerEntry): SendLedger {
    const next = new Map(ledger);

    if (entry.pending === undefined && entry.failed === undefined) {
        next.delete(key);
    } else {
        next.set(key, entry);
    }

    return next;
}

/**
 * The ledger after an event. Returns `ledger` itself when the event changes nothing. Pure.
 *
 * - `started`: the attempt is in flight. A line already sending refuses a second start, so a double press cannot send
 *   twice. A failed attempt stays recorded: a retry is a line both failed and pending.
 * - `saved`: the line is clear of both.
 * - `failed`: the attempt in flight becomes the failed one, payload kept. A failure with nothing in flight is ignored.
 *
 * @param ledger - The ledger now.
 * @param event - What happened.
 * @returns The new ledger.
 */
export function reduceSendLedger(ledger: SendLedger, event: SendLedgerEvent): SendLedger {
    const entry = ledger.get(event.key);

    switch (event.type) {
        case 'started':
            return entry?.pending === undefined
                ? withEntry(ledger, event.key, { pending: event.attempt, failed: entry?.failed })
                : ledger;

        case 'saved':
            return entry === undefined
                ? ledger
                : withEntry(ledger, event.key, { pending: undefined, failed: undefined });

        case 'failed':
            return entry?.pending === undefined
                ? ledger
                : withEntry(ledger, event.key, { pending: undefined, failed: entry.pending });
    }
}

/**
 * The sends in flight, as the surfaces' `pending` prop takes them. Pure.
 *
 * @param ledger - The ledger.
 * @returns Each sending line's {@link PendingSend}.
 */
export function pendingOf(ledger: SendLedger): ReadonlyMap<string, PendingSend> {
    return new Map([...ledger].flatMap(([key, entry]) => (entry.pending === undefined ? [] : [[key, entry.pending]])));
}

/**
 * The lines whose last send did not save, as the surfaces' `failed` prop takes them. Pure.
 *
 * @param ledger - The ledger.
 * @returns The failed lines' keys.
 */
export function failedOf(ledger: SendLedger): ReadonlySet<string> {
    return new Set([...ledger].flatMap(([key, entry]) => (entry.failed === undefined ? [] : [key])));
}

/**
 * The attempt Try again repeats: the line's failed one, itself. Pure.
 *
 * @param ledger - The ledger.
 * @param key - The line.
 * @returns The failed attempt, or `undefined` when the line has none.
 */
export function retryOf(ledger: SendLedger, key: string): SendAttempt | undefined {
    return ledger.get(key)?.failed;
}
