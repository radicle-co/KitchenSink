/**
 * A fake {@link VerificationQueuePort} for suites that construct `RecipesService` (plan U11).
 *
 * The port is a REQUIRED constructor parameter rather than one defaulting to a no-op, so every construction
 * site must name it. That is the point: a defaulted collaborator would let a suite silently exercise a
 * service that produces nothing, which is the state U11 shipped in and this unit exists to end.
 */
import { vi, type Mock } from 'vitest';

import type { VerifyIngredientLineMessage } from '@kitchensink/recipe-core/resolution/verification-message';

import type { VerificationQueuePort } from '../verification.queue.js';

/** A verification queue whose `enqueue` records its calls. */
export type FakeVerificationQueue = VerificationQueuePort & {
    readonly enqueue: Mock<(messages: readonly VerifyIngredientLineMessage[]) => Promise<void>>;
};

/**
 * Build a recording verification-queue double.
 *
 * @returns The fake port, with `enqueue` as a vitest mock resolving to `undefined`.
 */
export function fakeVerificationQueue(): FakeVerificationQueue {
    return {
        enqueue: vi.fn<(messages: readonly VerifyIngredientLineMessage[]) => Promise<void>>().mockResolvedValue(),
    };
}
