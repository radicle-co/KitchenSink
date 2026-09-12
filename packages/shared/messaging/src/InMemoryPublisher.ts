/**
 * `InMemoryPublisher` — the capturing adapter every test asserts against (plan U4).
 *
 * It exists to delete hand-rolled doubles. Food-service alone carried five separate ad-hoc bus fakes, each
 * re-deciding what "captured" means; a shared double means a test asserting on published messages is
 * asserting against the same shape the production adapter receives, and a change to the message contract
 * fails every suite at once instead of drifting fake by fake.
 *
 * Order is preserved, because order is a property the substrate itself guarantees (a group's messages sort
 * by `<ISO-8601 ms>#<ULID>`) and therefore something tests are entitled to assert.
 */

import type { MessagePublisher } from './publish.js';
import type { OutboundMessage } from './OutboundMessage.js';

export class InMemoryPublisher implements MessagePublisher {
    private readonly captured: OutboundMessage[] = [];

    /**
     * Capture the message in arrival order.
     *
     * @param message - The validated message.
     * @sideEffect Appends to the in-memory buffer.
     */
    public async send(message: OutboundMessage): Promise<void> {
        this.captured.push(message);
    }

    /**
     * Every message captured so far, in order.
     *
     * Returns a defensive copy: a test that mutated the live buffer would be editing the assertion subject
     * of every later assertion in the same test.
     *
     * @returns The captured messages, oldest first.
     */
    public get messages(): readonly OutboundMessage[] {
        return [...this.captured];
    }

    /**
     * Drop everything captured.
     *
     * @sideEffect Empties the in-memory buffer.
     */
    public clear(): void {
        this.captured.length = 0;
    }
}
