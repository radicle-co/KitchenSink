/**
 * `ConsolePublisher` — the no-AWS default adapter (plan U4), succeeding `ConsoleEventBus`.
 *
 * It is what makes local development and the worker bootstrap require no AWS at all: the worker always has a
 * publisher, so nothing has to branch on "is messaging configured?" and no producer needs a null check. The
 * real DynamoDB adapter (plan U6) replaces it in deployed stages.
 */

import type { MessagePublisher } from './publish.js';
import type { OutboundMessage } from './OutboundMessage.js';

export class ConsolePublisher implements MessagePublisher {
    /** @param log - Structured log sink; defaults to `console.info`. */
    public constructor(private readonly log: (message: OutboundMessage) => void = (m) => console.info(m)) {}

    /**
     * Log the message instead of persisting it.
     *
     * @param message - The validated message.
     * @sideEffect Writes to the log sink.
     */
    public async send(message: OutboundMessage): Promise<void> {
        this.log(message);
    }
}
