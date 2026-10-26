/**
 * @module @commise/features-recipes/ingredientMatching — where focus goes when the cook presses Try again on a failed
 * pick (WCAG 2.2 SC 2.4.3 Focus Order; on native the screen-reader cursor), for every surface that shows one: the
 * matched-line list, the paste pane, the flagged list, and the import options sheet and pane.
 *
 * A retry in flight hides the failure (`lineFailureOf`), so the Try again that held focus unmounts and focus would fall
 * to the page. A single render cannot tell the moments apart (a retry that has failed again looks exactly like a first
 * failure), so the rule reads a line's send state BEFORE and AFTER:
 *
 * - a retry starts (failed, then failed and sending): focus lands on the control the retry made busy (`landing`);
 * - a retry fails again (failed and sending, then failed): focus returns to the new Try again (`tryAgain`);
 * - a retry succeeds (failed, then not failed): nothing is requested; the host's `pickFocusOf` owns what comes next, as
 *   after a first pick;
 * - a first attempt and a first failure request nothing: focus is already on the control the cook pressed, and a failure
 *   that lands later must not pull the cook back from wherever they have gone.
 *
 * Each request is a LEVEL the control lowers once it has taken focus (`useFocusRequest`), so an unrelated render never
 * takes focus back. The memory this needs is one value per line (`RetryMemory`), changed only by the two pure functions
 * here; `useRetryFocus` holds it.
 *
 * ATTENTION. A retry's focus is a promise to the cook who pressed it. Once the cook has acted on ANOTHER line (a row's
 * handler, the pane's Previous or Next, the picker opening, focus entering a line) the promise is void: the memory notes
 * the line they are on (`noteAttention`), drops every standing request that belongs to any other line, and raises none
 * for a line they have left. `ownsFocus` is the same fact for the host's own move after a successful retry
 * (`pickFocusOf`): it may move focus only when the cook is still on that line, or has not acted on any line yet.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Reducer — a pure transition over a line's before and after send state, with the hook as its only holder
 */

/** One line's send, as a surface sees it: whether its last send failed, and whether one is in flight. */
export interface SendState {
    /** The line this is about: the memory keeps one state per key, so a line seen for the first time has no past. */
    readonly key: string;
    /** The line's last send did not save, and nothing has saved since. */
    readonly failed: boolean;
    /** A send for the line is in flight. */
    readonly sending: boolean;
}

/** Where a retry's focus goes: the control the retry made busy, or the new Try again. */
export type RetryFocus = 'landing' | 'tryAgain';

/** What the rule remembers between renders: each line's last send state, and the requests still standing. */
export interface RetryMemory {
    readonly seen: ReadonlyMap<string, SendState>;
    readonly requests: ReadonlyMap<string, RetryFocus>;
    /** The line the cook last acted on, or `undefined` before they have acted on any (then every line owns focus). */
    readonly attention: string | undefined;
}

/**
 * Where focus goes on the change from `before` to `after`. Pure.
 *
 * @param before - The line's state on the previous render, or `undefined` when it was not drawn.
 * @param after - The line's state now.
 * @returns The request the change raises, or `undefined` for none.
 */
export function retryFocusOf(before: SendState | undefined, after: SendState): RetryFocus | undefined {
    if (before === undefined || !before.failed || !after.failed) {
        return undefined;
    }

    if (!before.sending && after.sending) {
        return 'landing';
    }

    return before.sending && !after.sending ? 'tryAgain' : undefined;
}

/** The sends keyed by line. Pure. */
const byKey = (sends: readonly SendState[]): ReadonlyMap<string, SendState> =>
    new Map(sends.map((send) => [send.key, send]));

/** Whether two maps hold the same entries, by the values' own fields. Pure. */
const sameSends = (a: ReadonlyMap<string, SendState>, b: ReadonlyMap<string, SendState>): boolean =>
    a.size === b.size &&
    [...b].every(([key, send]) => {
        const was = a.get(key);

        return was?.failed === send.failed && was.sending === send.sending;
    });

/** Whether two maps hold the same requests. Pure. */
const sameRequests = (a: ReadonlyMap<string, RetryFocus>, b: ReadonlyMap<string, RetryFocus>): boolean =>
    a.size === b.size && [...b].every(([key, request]) => a.get(key) === request);

/**
 * The memory of a surface's first render: every line seen, nothing requested. Pure.
 *
 * @param sends - The lines' states now.
 * @returns The memory.
 */
export function startRetryMemory(sends: readonly SendState[]): RetryMemory {
    return { seen: byKey(sends), requests: new Map(), attention: undefined };
}

/**
 * The memory after a render. A request stands until its control lowers it, or until the line stops failing (a success,
 * after which a control that appears later must not take focus), or until the line is no longer drawn. Nothing is raised
 * or kept for a line other than the one the cook is on, once they are on one. Pure.
 *
 * @param memory - The memory before this render.
 * @param sends - The lines' states now.
 * @returns The new memory, or `memory` itself when nothing changed, so a render-time update cannot loop.
 */
export function stepRetryMemory(memory: RetryMemory, sends: readonly SendState[]): RetryMemory {
    const seen = byKey(sends);
    const requests = new Map<string, RetryFocus>();

    for (const [key, send] of seen) {
        const attended = ownsFocus(memory, key);
        const raised = attended ? retryFocusOf(memory.seen.get(key), send) : undefined;
        const standing = attended ? memory.requests.get(key) : undefined;
        const request = raised ?? (send.failed ? standing : undefined);

        if (request !== undefined) {
            requests.set(key, request);
        }
    }

    return sameSends(memory.seen, seen) && sameRequests(memory.requests, requests)
        ? memory
        : { seen, requests, attention: memory.attention };
}

/**
 * The memory once a control has taken the focus it was asked for. Lowers only the request it names, so the landing
 * control reporting cannot cancel a Try again request raised since. Pure.
 *
 * @param memory - The memory now.
 * @param key - The line.
 * @param request - The request the control took.
 * @returns The memory without that request, or `memory` itself when it held no such request.
 */
export function lowerRetryRequest(memory: RetryMemory, key: string, request: RetryFocus): RetryMemory {
    if (memory.requests.get(key) !== request) {
        return memory;
    }

    const requests = new Map(memory.requests);

    requests.delete(key);

    return { seen: memory.seen, requests, attention: memory.attention };
}

/**
 * Whether a line may take focus from the host: the cook is on it, or has not acted on any line yet. Pure.
 *
 * @param memory - The memory now.
 * @param key - The line.
 * @returns `false` once the cook has acted on another line.
 */
export function ownsFocus(memory: RetryMemory, key: string): boolean {
    return memory.attention === undefined || memory.attention === key;
}

/**
 * The memory once the cook has acted on a line. Drops every standing request that belongs to another line, so no
 * control of a line they have left takes focus from them. Pure.
 *
 * @param memory - The memory now.
 * @param key - The line the cook acted on.
 * @returns The new memory, or `memory` itself when attention already rests on the line and no other request stands.
 */
export function noteAttention(memory: RetryMemory, key: string): RetryMemory {
    const requests = new Map([...memory.requests].filter(([requested]) => requested === key));

    return memory.attention === key && requests.size === memory.requests.size
        ? memory
        : { seen: memory.seen, requests, attention: key };
}
