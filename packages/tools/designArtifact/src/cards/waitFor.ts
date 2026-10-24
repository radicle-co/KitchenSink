/**
 * @module cards/waitFor — waiting for a condition on the card page, for `afterRender` code that stages an
 * interaction (open a menu, scroll a host). A card is ready when its interaction is DONE, so the code awaits the
 * observable result instead of sleeping for a guessed time.
 *
 * Runs in the browser. A hand-written probe loop because the condition is arbitrary page state (a node, a scroll
 * offset), and the closest library, Testing Library's `waitFor`, pulls its test-runner timer detection into every card.
 *
 * @pattern Polling Consumer over a MutationObserver — the probe is re-run on every DOM change and on every frame.
 */

/** The condition did not become true in time. */
export class WaitTimeoutError extends Error {
    constructor(description: string, timeoutMs: number) {
        super(`Timed out after ${String(timeoutMs)} ms waiting for ${description}.`);
        this.name = 'WaitTimeoutError';
        Object.setPrototypeOf(this, WaitTimeoutError.prototype);
    }
}

/**
 * Whether a value is a {@link WaitTimeoutError}.
 *
 * @param value - Anything caught.
 * @returns Whether it is that error.
 */
export function isWaitTimeoutError(value: unknown): value is WaitTimeoutError {
    return value instanceof WaitTimeoutError;
}

/** Options of {@link waitFor}. */
export interface WaitForOptions {
    /** Give up after this long. Default 10 000 ms. */
    readonly timeoutMs?: number;
    /** What is awaited, for the timeout message. */
    readonly description?: string;
}

/**
 * Resolves with the first answer the probe gives that is not `null`, `undefined` or `false`.
 *
 * @param probe - Reads the page; returns the awaited thing, or `null`/`undefined`/`false` while it is not there.
 * @param options - Time limit and a description.
 * @returns What the probe found.
 * @throws WaitTimeoutError (as a rejection) when the probe never answers within the limit.
 * @sideEffect Observes the document and polls on animation frames until it settles.
 */
export function waitFor<T>(probe: () => T | null | undefined | false, options: WaitForOptions = {}): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const description = options.description ?? 'a condition';

    return new Promise<T>((resolve, reject) => {
        const observer = new MutationObserver(check);
        let frame = 0;
        let done = false;

        function finish(): void {
            done = true;
            observer.disconnect();
            cancelAnimationFrame(frame);
            clearTimeout(timer);
        }

        function check(): void {
            if (done) {
                return;
            }

            const found = probe();

            if (found !== null && found !== undefined && found !== false) {
                finish();
                resolve(found);
            }
        }

        function poll(): void {
            check();

            if (!done) {
                frame = requestAnimationFrame(poll);
            }
        }

        const timer = setTimeout(() => {
            finish();
            reject(new WaitTimeoutError(description, timeoutMs));
        }, timeoutMs);

        observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
        poll();
    });
}

/**
 * Resolves after the next animation frame, for a handler the page runs per frame.
 *
 * @returns A promise settled on the frame.
 * @sideEffect Schedules an animation frame.
 */
export function nextFrame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}
