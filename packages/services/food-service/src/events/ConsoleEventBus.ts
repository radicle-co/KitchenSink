/**
 * `ConsoleEventBus` — the default no-AWS {@link EventBus}: logs each put to the provided sink (or
 * `console.info`) instead of calling EventBridge.
 *
 * Used as a safe fallback in the worker bootstrap when no real bus is wired, so the worker never *requires*
 * AWS. The real EventBridge bus is added with the infra slice.
 */
import type { EventBus, EventBusPutInput } from './eventBus.js';

export class ConsoleEventBus implements EventBus {
    /** @param log - Optional structured log sink; defaults to `console.info`. */
    public constructor(private readonly log: (input: EventBusPutInput) => void = (input) => console.info(input)) {}

    /**
     * Log the event instead of putting it on a real bus.
     *
     * @param input - The event to log.
     * @sideEffect Writes to the log sink.
     */
    public async putEvent(input: EventBusPutInput): Promise<void> {
        this.log(input);
    }
}
